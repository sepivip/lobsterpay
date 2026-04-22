import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import { Connection, PublicKey } from "@solana/web3.js";
import { randomUUID } from "node:crypto";
import { TREASURY_PUBKEY } from "../solana/instructions.js";

// Demo paywall settings.
// Price per call: 10_000 atomic = 0.01 USDC on devnet — cheap enough that a
// single vault deposit covers hundreds of test calls. Recipient is the
// existing treasury pubkey so the demo doesn't require any new keys.
const DEMO_PRICE_ATOMIC = "10000";
// devnet USDC mint (the same one the dashboard + activity feed surface)
const DEMO_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

// In-memory anti-replay cache: once a tx signature has unlocked content, it
// can't be re-used. Bounded so it can't leak forever on long-running
// instances. Railway restarts reset this and that's acceptable at demo
// scale.
const MAX_CLAIMED = 5000;
const claimedSignatures = new Set<string>();
function markClaimed(sig: string) {
  if (claimedSignatures.size >= MAX_CLAIMED) {
    // drop the oldest entry by iterating; Set iteration order is insertion
    const first = claimedSignatures.values().next().value;
    if (first) claimedSignatures.delete(first);
  }
  claimedSignatures.add(sig);
}

// A small pool of paywalled "content" — picked at random so each successful
// call feels different. Kept short + tasteful; this is a demo, not a product.
const FORTUNES = [
  "Agents with limits ship faster than agents with passwords.",
  "The cheapest wallet is the one that can't be drained.",
  "A revocable key is the only key worth issuing.",
  "Settlement finality beats hope every time.",
  "The shortest path from idea to production is a scoped API key.",
  "On-chain constraints are the only constraints that don't drift.",
];

const JOKES = [
  "Why did the agent pay its own invoice? Because the human was AFK and the vault said yes.",
  "A seed phrase walks into a bar. Bartender says 'we don't serve your kind here.' The agent behind it shrugs and swipes its API key.",
  "How many LLMs does it take to bankrupt a vault? Zero, if you set a daily cap.",
  "I gave my AI a wallet. It bought me a subscription I already had. That's when I installed LobsterPay.",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Spec-compliant x402 payment-requirements body. Agent uses these fields
 * when calling pay_x402 — we read them back out of X-PAYMENT on retry.
 */
function buildRequirements(resource: string, paymentId: string, publicApiUrl: string) {
  return {
    scheme: "exact" as const,
    network: "solana",
    asset: DEMO_MINT,
    amount: DEMO_PRICE_ATOMIC,
    recipient: TREASURY_PUBKEY.toString(),
    paymentId,
    description: `LobsterPay demo paywall — unlock ${resource}`,
    resource: `${publicApiUrl}${resource}`,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  };
}

interface ParsedXPayment {
  txSignature: string;
  amount: string;
  asset: string;
  recipient: string;
  paymentId?: string | null;
}

function parseXPayment(header: string | undefined): ParsedXPayment | { error: string } {
  if (!header) return { error: "Missing X-PAYMENT header" };
  let decoded: string;
  try {
    decoded = Buffer.from(header, "base64").toString("utf8");
  } catch {
    return { error: "X-PAYMENT header is not valid base64" };
  }
  let parsed: any;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return { error: "X-PAYMENT header is not valid JSON after base64 decode" };
  }
  if (typeof parsed !== "object" || parsed == null) {
    return { error: "X-PAYMENT header must be a JSON object" };
  }
  if (!parsed.txSignature || typeof parsed.txSignature !== "string") {
    return { error: "X-PAYMENT missing txSignature" };
  }
  if (!parsed.amount || !parsed.asset || !parsed.recipient) {
    return { error: "X-PAYMENT missing amount / asset / recipient" };
  }
  return {
    txSignature: parsed.txSignature,
    amount: String(parsed.amount),
    asset: String(parsed.asset),
    recipient: String(parsed.recipient),
    paymentId: parsed.paymentId ?? null,
  };
}

/**
 * Verify the claimed tx actually lands on-chain, transfers >= the required
 * amount of the required mint, and lists our recipient as a destination
 * token account owner. Keeps the demo honest while staying quick (one RPC
 * round-trip per call).
 */
async function verifyOnChainTransfer(
  connection: Connection,
  claimed: ParsedXPayment,
  expectedRecipient: string,
  expectedAssetMint: string,
  expectedMinAmount: bigint,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (claimed.asset !== expectedAssetMint) {
    return { ok: false, reason: `Asset mismatch: expected ${expectedAssetMint}, got ${claimed.asset}` };
  }
  if (claimed.recipient !== expectedRecipient) {
    return { ok: false, reason: `Recipient mismatch: expected ${expectedRecipient}, got ${claimed.recipient}` };
  }
  let tx;
  try {
    tx = await connection.getParsedTransaction(claimed.txSignature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
  } catch (err: any) {
    return { ok: false, reason: `RPC error fetching tx: ${err?.message ?? err}` };
  }
  if (!tx) {
    return { ok: false, reason: "Tx not found on-chain (confirmed commitment)" };
  }
  if (tx.meta?.err) {
    return { ok: false, reason: `Tx failed on-chain: ${JSON.stringify(tx.meta.err).slice(0, 120)}` };
  }

  // Walk the parsed instructions for any SPL transfer_checked to the
  // expected recipient's ATA with >= expectedMinAmount. The agent may
  // transfer more than required (ours always transfers the exact gross
  // and splits inside the program), so >= is the right comparison.
  const expectedRecipientAta = (await import("@solana/spl-token")).getAssociatedTokenAddressSync(
    new PublicKey(expectedAssetMint),
    new PublicKey(expectedRecipient),
    true,
  ).toString();

  const allInstructions = [
    ...(tx.transaction.message.instructions ?? []),
    ...(tx.meta?.innerInstructions?.flatMap((ii) => ii.instructions) ?? []),
  ];

  for (const ix of allInstructions) {
    if ("parsed" in ix && ix.parsed?.type && ix.program === "spl-token") {
      const info = ix.parsed.info as any;
      const typ = ix.parsed.type;
      // transfer / transferChecked both work; transferChecked carries mint info
      if (typ === "transferChecked" || typ === "transfer") {
        const dest = info?.destination;
        const raw = info?.tokenAmount?.amount ?? info?.amount;
        if (!dest || !raw) continue;
        if (dest !== expectedRecipientAta) continue;
        try {
          if (BigInt(raw) >= expectedMinAmount) {
            return { ok: true };
          }
        } catch {
          // amount not parseable — skip
        }
      }
    }
  }
  return {
    ok: false,
    reason: `No SPL transfer found of >= ${expectedMinAmount.toString()} to ${expectedRecipientAta}`,
  };
}

/**
 * Handle the paywall flow for a single resource path. On 402, build fresh
 * payment requirements. On X-PAYMENT, verify + serve.
 */
async function handlePaywall(opts: {
  request: any;
  reply: any;
  connection: Connection;
  publicApiUrl: string;
  resource: string;
  respond: () => unknown;
}) {
  const xPayment = opts.request.headers["x-payment"] as string | undefined;
  if (!xPayment) {
    const paymentId = randomUUID();
    const requirements = buildRequirements(opts.resource, paymentId, opts.publicApiUrl);
    return opts.reply
      .status(402)
      .header("X-PAYMENT-REQUIRED", JSON.stringify(requirements))
      .send({
        error: "Payment Required",
        x402Version: 1,
        paymentRequirements: requirements,
        instructions: [
          `1. POST ${opts.publicApiUrl}/v1/agent/actions/x402 with { paymentRequirements, originalRequestUrl: "${opts.publicApiUrl}${opts.resource}" }`,
          "2. On status: confirmed, retry the original URL with header 'X-PAYMENT: <xPaymentHeader from the response>'",
          "3. You will receive 200 + the paywalled content",
        ],
      });
  }

  const claimed = parseXPayment(xPayment);
  if ("error" in claimed) {
    return opts.reply.status(400).send({ error: claimed.error });
  }

  if (claimedSignatures.has(claimed.txSignature)) {
    return opts.reply.status(409).send({
      error: "X-PAYMENT signature already used for a prior request (anti-replay)",
      txSignature: claimed.txSignature,
    });
  }

  const verdict = await verifyOnChainTransfer(
    opts.connection,
    claimed,
    TREASURY_PUBKEY.toString(),
    DEMO_MINT,
    BigInt(DEMO_PRICE_ATOMIC),
  );
  if (!verdict.ok) {
    return opts.reply.status(402).send({
      error: "Payment verification failed",
      reason: verdict.reason,
      txSignature: claimed.txSignature,
    });
  }

  markClaimed(claimed.txSignature);
  const payload = opts.respond();
  return opts.reply
    .status(200)
    .header("X-PAYMENT-VERIFIED", claimed.txSignature)
    .send({
      verified: true,
      txSignature: claimed.txSignature,
      paidBy: claimed.recipient,
      amount: DEMO_PRICE_ATOMIC,
      asset: DEMO_MINT,
      ...payload as any,
    });
}

export function demoRoutes(app: FastifyInstance, config: Config) {
  const connection = new Connection(config.SOLANA_RPC_URL, "confirmed");
  const publicApiUrl = (config.PUBLIC_API_URL ?? "").replace(/\/$/, "") || "";

  // Index — human-readable doc for anyone curling the demo bundle.
  app.get("/v1/demo/x402", async () => ({
    resources: [
      { path: "/v1/demo/x402/fortune", description: "One paywalled fortune per payment." },
      { path: "/v1/demo/x402/joke", description: "One paywalled joke per payment." },
    ],
    price: {
      amountAtomic: DEMO_PRICE_ATOMIC,
      mint: DEMO_MINT,
      humanReadable: "0.01 USDC (devnet)",
    },
    recipient: TREASURY_PUBKEY.toString(),
    notes: [
      "Each resource returns 402 on first call with paymentRequirements.",
      "Settle via POST /v1/agent/actions/x402, then retry with the X-PAYMENT header.",
      "Each Solana tx signature can unlock content exactly once (anti-replay).",
    ],
  }));

  // Paywalled fortune
  app.get("/v1/demo/x402/fortune", async (request, reply) =>
    handlePaywall({
      request, reply, connection, publicApiUrl,
      resource: "/v1/demo/x402/fortune",
      respond: () => ({ fortune: pick(FORTUNES) }),
    }),
  );

  // Paywalled joke
  app.get("/v1/demo/x402/joke", async (request, reply) =>
    handlePaywall({
      request, reply, connection, publicApiUrl,
      resource: "/v1/demo/x402/joke",
      respond: () => ({ joke: pick(JOKES) }),
    }),
  );
}
