#!/usr/bin/env node
// End-to-end test of paying an agonx402 route, matching the x402 SVM exact
// spec as implemented by @x402/svm/exact (the reference used by agon).
//
// Required tx shape (from x402 facilitator verify code):
//   - Versioned transaction v0
//   - 3-6 instructions, in exact order:
//       [0] ComputeBudget.setComputeUnitLimit
//       [1] ComputeBudget.setComputeUnitPrice
//       [2] Token.transferChecked (SPL or Token-2022)
//       [3..5] optional: Memo and/or Lighthouse
//   - feePayer = paymentRequirements.extra.feePayer (agon's pubkey)
//   - Partial-signed by authority (client); facilitator co-signs and submits
//
// Wallet stored at $TMP/agon-test-wallet.json (NOT committed).
// Run: node scripts/agon-x402-test.mjs

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  TransactionInstruction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createTransferCheckedInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

const WALLET_PATH = path.join(os.tmpdir(), "agon-test-wallet.json");
const RPC = "https://api.devnet.solana.com";
const AGON_ENDPOINT =
  "https://gateway.agonx402.com/v1/x402/solana/devnet/helius/rpc/getBalance";
const RPC_BODY = { params: ["GQUtvPx89ZNCwmvQqFmH59bJcU8fW8siETpaxod7Aydz"] };
const MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
);

// Reference client defaults for compute budget.
const COMPUTE_UNIT_LIMIT = 300_000;
const COMPUTE_UNIT_PRICE_MICROLAMPORTS = 1_000_000;

function hr(title) {
  console.log(`\n=== ${title} ===`);
}

// ── 0. Load or generate wallet ────────────────────────────────────────────
let keypair;
if (fs.existsSync(WALLET_PATH)) {
  const data = JSON.parse(fs.readFileSync(WALLET_PATH, "utf8"));
  keypair = Keypair.fromSecretKey(new Uint8Array(data));
  console.log("Loaded test wallet:", keypair.publicKey.toBase58());
} else {
  keypair = Keypair.generate();
  fs.writeFileSync(WALLET_PATH, JSON.stringify([...keypair.secretKey]));
  console.log("Generated test wallet:", keypair.publicKey.toBase58());
  console.log("Saved to:", WALLET_PATH);
}

const connection = new Connection(RPC, "confirmed");

// ── 1. Probe for 402 challenge ────────────────────────────────────────────
hr("1. GET 402 challenge");
const res402 = await fetch(AGON_ENDPOINT, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(RPC_BODY),
});
console.log("Status:", res402.status);
const challenge = JSON.parse(
  Buffer.from(res402.headers.get("payment-required"), "base64").toString(),
);
const accept = challenge.accepts[0];
console.log("accepts[0]:", JSON.stringify(accept, null, 2));

const MINT = new PublicKey(accept.asset);
const PAY_TO = new PublicKey(accept.payTo);
const FEE_PAYER = new PublicKey(accept.extra.feePayer);
const AMOUNT = BigInt(accept.amount);
const DECIMALS = 6;

// ── 2. Check USDC balance ─────────────────────────────────────────────────
hr("2. Check balances");
const payerAta = getAssociatedTokenAddressSync(MINT, keypair.publicKey);
let usdcAtomic = 0n;
try {
  const info = await connection.getTokenAccountBalance(payerAta);
  usdcAtomic = BigInt(info.value.amount);
} catch {}
console.log("Test wallet:", keypair.publicKey.toBase58());
console.log("USDC ATA:  ", payerAta.toBase58());
console.log("USDC atomic:", usdcAtomic.toString(), "(need:", AMOUNT.toString(), ")");
if (usdcAtomic < AMOUNT) {
  console.log(
    `\n⚠️  Underfunded. Send at least ${AMOUNT} atomic USDC at mint ${MINT.toBase58()} to ${keypair.publicKey.toBase58()}`,
  );
  process.exit(0);
}

// ── 3. Build v0 tx with required ix order ─────────────────────────────────
hr("3. Build versioned tx (v0)");
const destAta = getAssociatedTokenAddressSync(MINT, PAY_TO);
const destInfo = await connection.getAccountInfo(destAta);
console.log("Destination ATA:", destAta.toBase58(), "exists:", !!destInfo);

const limitIx = ComputeBudgetProgram.setComputeUnitLimit({
  units: COMPUTE_UNIT_LIMIT,
});
const priceIx = ComputeBudgetProgram.setComputeUnitPrice({
  microLamports: COMPUTE_UNIT_PRICE_MICROLAMPORTS,
});
const transferIx = createTransferCheckedInstruction(
  payerAta,
  MINT,
  destAta,
  keypair.publicKey, // authority = test wallet
  AMOUNT,
  DECIMALS,
);
// Random 16-byte hex nonce for replay protection (matches ref client)
const nonce = Buffer.from(crypto.randomBytes(16)).toString("hex");
const memoIx = new TransactionInstruction({
  programId: MEMO_PROGRAM_ID,
  keys: [],
  data: Buffer.from(nonce, "utf8"),
});

const { blockhash } = await connection.getLatestBlockhash("confirmed");
const msg = new TransactionMessage({
  payerKey: FEE_PAYER,
  recentBlockhash: blockhash,
  instructions: [limitIx, priceIx, transferIx, memoIx],
}).compileToV0Message();

const vtx = new VersionedTransaction(msg);
vtx.sign([keypair]); // partial-sign as authority; fee-payer slot stays empty

console.log("Instructions in order:");
console.log("  [0] ComputeBudget.setComputeUnitLimit(", COMPUTE_UNIT_LIMIT, ")");
console.log("  [1] ComputeBudget.setComputeUnitPrice(", COMPUTE_UNIT_PRICE_MICROLAMPORTS, "μlamports)");
console.log("  [2] Token.transferChecked(", AMOUNT.toString(), "→ payTo)");
console.log("  [3] Memo.memo(", nonce, ")");
console.log("feePayer:", FEE_PAYER.toBase58());
console.log("authority (signed by test wallet):", keypair.publicKey.toBase58());

const txBase64 = Buffer.from(vtx.serialize()).toString("base64");
console.log("Serialized v0 tx:", vtx.serialize().length, "bytes");

// ── 4. Wrap in x402 v2 envelope ───────────────────────────────────────────
// Spec (PaymentPayload from @x402/core/types/payments): envelope contains
// the FULL matched requirement as `accepted`, not just scheme+network.
hr("4. Wrap in x402 envelope");
const envelope = {
  x402Version: 2,
  accepted: accept,
  payload: { transaction: txBase64 },
};
const envelopeB64 = Buffer.from(JSON.stringify(envelope)).toString("base64");

// ── 5. Retry with PAYMENT-SIGNATURE ───────────────────────────────────────
hr("5. Retry via PAYMENT-SIGNATURE");
const res = await fetch(AGON_ENDPOINT, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "PAYMENT-SIGNATURE": envelopeB64,
  },
  body: JSON.stringify(RPC_BODY),
});
console.log("Status:", res.status);
for (const [k, v] of res.headers.entries()) {
  const short = v.length > 200 ? v.slice(0, 200) + "…" : v;
  console.log(`  ${k}: ${short}`);
}
const body = await res.text();
console.log("\nBody:", body);

// Decode any settlement header
const settleB64 =
  res.headers.get("x-payment-response") || res.headers.get("payment-response");
if (settleB64) {
  try {
    const settled = JSON.parse(Buffer.from(settleB64, "base64").toString());
    hr("6. X-PAYMENT-RESPONSE decoded");
    console.log(JSON.stringify(settled, null, 2));
  } catch {}
}

// If a new Payment-Required came back, decode its error
const newChallenge = res.headers.get("payment-required");
if (newChallenge && res.status === 402) {
  try {
    const c = JSON.parse(Buffer.from(newChallenge, "base64").toString());
    hr("6. Payment-Required (new) decoded");
    console.log("error:", c.error);
  } catch {}
}

hr("done");
