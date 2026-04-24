import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { Db } from "../db/client.js";
import type { Config } from "../config.js";
import { createVaultService } from "../services/vault.service.js";
import { createApiKeyService } from "../services/apiKey.service.js";
import { createTxService } from "../services/tx.service.js";
import {
  createApiKeySchema,
  updatePolicySchema,
  depositFeesSchema,
  withdrawFeesSchema,
} from "@lobsterpay/shared";
import { FEE_VAULT_MIN_BALANCE } from "../solana/instructions.js";

// Known SPL mints → display info. Used to turn atomic amounts into human
// strings ("0.10 USDC") on the activity feed.
const MINT_META: Record<string, { symbol: string; decimals: number }> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: "USDC", decimals: 6 },
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU": { symbol: "USDC", decimals: 6 },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: "USDT", decimals: 6 },
  So11111111111111111111111111111111111111112: { symbol: "SOL", decimals: 9 },
};

function formatAtomic(atomic: string | number | null | undefined, mint?: string | null): { amount: string; symbol: string } | null {
  if (atomic == null) return null;
  const meta = mint ? MINT_META[mint] : undefined;
  const symbol = meta?.symbol ?? (mint ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : "");
  const decimals = meta?.decimals ?? 0;
  try {
    const atomicStr = String(atomic);
    if (decimals === 0) return { amount: atomicStr, symbol };
    const big = BigInt(atomicStr);
    const divisor = 10n ** BigInt(decimals);
    const whole = big / divisor;
    const frac = big % divisor;
    const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
    const amount = fracStr ? `${whole}.${fracStr}` : whole.toString();
    return { amount, symbol };
  } catch {
    return { amount: String(atomic), symbol };
  }
}

function shortAddr(addr: string | null | undefined): string {
  if (!addr) return "";
  return addr.length > 12 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr;
}

function buildExplorerUrl(signature: string, cluster: string): string {
  const suffix = cluster === "mainnet-beta" || cluster === "mainnet" ? "" : `?cluster=${cluster}`;
  return `https://explorer.solana.com/tx/${signature}${suffix}`;
}

/**
 * Older INSERTs wrote JSON.stringify(payload) into the JSONB column, which
 * round-trips as a JSON-encoded STRING when read back. Iterating that string
 * with Object.keys() yields character indices ("0", "1", ...) instead of
 * real field names, which used to surface as the infamous
 * "Policy updated: 0, 1, 2, ..." bug. Parse defensively on read so both the
 * legacy rows and any newly-written proper-JSON rows render correctly.
 */
function parsePayload(raw: any): Record<string, any> {
  if (raw == null) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === "object" && parsed !== null ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof raw === "object" ? (raw as Record<string, any>) : {};
}

/**
 * Render a single policy_update field as a human-readable line. Covers the
 * snake_case DB-style keys (allowed_mints) and the camelCase frontend-style
 * keys (allowedMints) because both shapes have been written historically.
 */
function describePolicyField(key: string, value: any): string {
  if (value == null) return `${key}: null`;
  switch (key) {
    case "paused":
      return value ? "Paused" : "Unpaused";
    case "allowedActions":
    case "allowed_actions": {
      const bits = Number(value);
      const labels: string[] = [];
      if (bits & 1) labels.push("swap");
      if (bits & 2) labels.push("pay");
      if (bits & 4) labels.push("x402");
      return `Actions: ${labels.length ? labels.join(", ") : "none"}`;
    }
    case "maxPerTxAmountAtomic":
    case "max_per_tx_amount_atomic": {
      const usdc = formatAtomic(value, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
      return `Max per tx: ${usdc?.amount ?? value} USDC`;
    }
    case "dailyLimitAmountAtomic":
    case "daily_limit_amount_atomic": {
      const usdc = formatAtomic(value, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
      return `Daily limit: ${usdc?.amount ?? value} USDC`;
    }
    case "maxSlippageBps":
    case "max_slippage_bps":
      return `Max slippage: ${(Number(value) / 100).toFixed(2)}%`;
    case "allowedMints":
    case "allowed_mints":
      if (Array.isArray(value)) {
        return `Allowed mints (${value.length}): ${value.slice(0, 3).map(shortAddr).join(", ")}${value.length > 3 ? "…" : ""}`;
      }
      return `Allowed mints: ${String(value).slice(0, 60)}`;
    case "allowedDestinations":
    case "allowed_destinations":
      if (Array.isArray(value)) {
        return `Allowed destinations (${value.length}): ${value.slice(0, 3).map(shortAddr).join(", ")}${value.length > 3 ? "…" : ""}`;
      }
      return `Allowed destinations: ${String(value).slice(0, 60)}`;
    case "allowedExternalPrograms":
    case "allowed_external_programs":
      if (Array.isArray(value)) {
        return `Allowed programs (${value.length}): ${value.slice(0, 3).map(shortAddr).join(", ")}${value.length > 3 ? "…" : ""}`;
      }
      return `Allowed programs: ${String(value).slice(0, 60)}`;
    case "authorizedAgent":
    case "authorized_agent":
      return `Authorized agent: ${shortAddr(String(value))}`;
    case "vaultId":
    case "vault_id":
      return ""; // redundant; the row already belongs to this vault
    default:
      if (Array.isArray(value)) return `${key} (${value.length})`;
      if (typeof value === "object") return `${key}: ${JSON.stringify(value).slice(0, 80)}`;
      return `${key}: ${String(value).slice(0, 80)}`;
  }
}

/**
 * Turn a raw activity row into a rich shape the UI can render without
 * guessing at payload keys. Returns description, amount, tx link, etc.
 */
function transformActivity(
  row: any,
  cluster: string,
  requestByRefId: Map<string, { tx_status: string | null; tx_signature: string | null; rejection_reason: string | null; amount_atomic: string | null; mint: string | null }>,
): any {
  const payload = parsePayload(row.payload_json);
  const refRequest = row.reference_request_id ? requestByRefId.get(row.reference_request_id) : undefined;

  // Prefer the row's tx_signature; fall back to the linked request (e.g.
  // swap rows store signature in the payload/request, not on the row).
  const txSignature: string | null = row.tx_signature ?? refRequest?.tx_signature ?? payload.txSignature ?? null;
  const explorerUrl = txSignature ? buildExplorerUrl(txSignature, cluster) : null;

  const rawStatus = refRequest?.tx_status ?? null;
  const status = rawStatus === "created" ? null : rawStatus;

  let title = row.type;
  const metaLines: string[] = [];
  let amountDisplay: { amount: string; symbol: string } | null = null;

  switch (row.type) {
    case "payment": {
      const mint = payload.mint ?? refRequest?.mint ?? null;
      const gross = payload.grossAmount ?? payload.amountAtomic ?? refRequest?.amount_atomic;
      amountDisplay = formatAtomic(gross, mint);
      const dest = payload.destination ? shortAddr(payload.destination) : null;
      title = dest ? `Paid ${amountDisplay?.amount ?? ""} ${amountDisplay?.symbol ?? ""} to ${dest}`.trim() : "Payment";
      if (payload.netAmount && payload.serviceFee) {
        const net = formatAtomic(payload.netAmount, mint);
        const fee = formatAtomic(payload.serviceFee, mint);
        if (net && fee) metaLines.push(`net ${net.amount} · fee ${fee.amount} ${fee.symbol}`);
      }
      if (payload.memo) metaLines.push(`memo: ${payload.memo}`);
      break;
    }
    case "payment_failed": {
      const mint = payload.mint ?? refRequest?.mint ?? null;
      amountDisplay = formatAtomic(payload.amountAtomic ?? refRequest?.amount_atomic, mint);
      const reason = payload.reason ?? refRequest?.rejection_reason ?? "unknown_error";
      title = `Payment failed: ${reason}`;
      if (payload.anchorCode != null) metaLines.push(`anchor error ${payload.anchorCode}`);
      if (payload.error) metaLines.push(String(payload.error).slice(0, 200));
      break;
    }
    case "swap": {
      const fromMint = payload.fromMint ?? null;
      const toMint = payload.toMint ?? null;
      const fromAmt = formatAtomic(payload.amountIn, fromMint);
      const outAmt = formatAtomic(payload.expectedOut, toMint);
      if (payload.error) {
        title = `Swap failed: ${String(payload.error).slice(0, 120)}`;
      } else if (fromAmt && outAmt) {
        title = `Swapped ${fromAmt.amount} ${fromAmt.symbol} → ${outAmt.amount} ${outAmt.symbol}`;
      } else {
        title = "Swap";
      }
      if (payload.routeSummary) metaLines.push(`route: ${payload.routeSummary}`);
      amountDisplay = fromAmt;
      break;
    }
    case "x402": {
      const mint = payload.asset ?? null;
      amountDisplay = formatAtomic(payload.amount, mint);
      const domain = payload.domain ?? "endpoint";
      title = `x402 paid ${amountDisplay?.amount ?? ""} ${amountDisplay?.symbol ?? ""} to ${domain}`.trim();
      if (payload.recipient) metaLines.push(`to ${shortAddr(payload.recipient)}`);
      break;
    }
    case "x402_siwx_authorized": {
      const domain = payload.domain ?? "endpoint";
      title = `Authorized agent for ${domain}`;
      if (payload.address) metaLines.push(`signed as ${shortAddr(payload.address)}`);
      break;
    }
    case "policy_update": {
      const entries = Object.entries(payload).filter(([k]) => k !== "vaultId" && k !== "vault_id");
      if (entries.length === 0) {
        title = "Policy updated";
      } else if (entries.length === 1) {
        title = `Policy updated · ${describePolicyField(entries[0][0], entries[0][1])}`;
      } else {
        title = `Policy updated (${entries.length} fields)`;
        for (const [k, v] of entries) {
          const line = describePolicyField(k, v);
          if (line) metaLines.push(line);
        }
      }
      break;
    }
    case "key_created":
      title = `API key created: ${payload.label ?? "(unlabeled)"}`;
      if (payload.prefix) metaLines.push(`prefix ${payload.prefix}…`);
      break;
    case "key_revoked":
      title = `API key revoked: ${payload.label ?? payload.prefix ?? payload.keyId}`;
      break;
    case "vault_created":
      title = "Vault created";
      if (payload.vaultPda) metaLines.push(`vault ${shortAddr(payload.vaultPda)}`);
      break;
    case "fee_vault_initialize_intent":
      title = "Fee vault initialized";
      break;
    case "fee_vault_deposit_intent":
      title = `Fee vault deposit ${payload.amount ?? ""} SOL`.trim();
      break;
    case "fee_vault_withdraw_intent":
      title = `Fee vault withdraw ${payload.amount ?? ""} SOL`.trim();
      break;
    default:
      title = row.type;
  }

  return {
    id: row.id,
    type: row.type,
    title,
    description: title, // legacy alias for older UI copies
    metaLines,
    amount: amountDisplay?.amount ?? null,
    mint: amountDisplay?.symbol ?? null,
    txSignature,
    explorerUrl,
    status,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    payload,
  };
}

// TODO: Replace with proper wallet signature verification (e.g. verify ed25519 signed message)
function ownerAuth(db: Db) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const walletAddress = request.headers['x-wallet-address'] as string;
    if (!walletAddress) {
      return reply.status(401).send({ code: 'unauthorized', message: 'X-Wallet-Address header required' });
    }
    (request as any).ownerWallet = walletAddress;
  };
}

async function verifyVaultOwnership(db: Db, vaultId: string, walletAddress: string): Promise<boolean> {
  const rows = await db`
    SELECT o.wallet_address
    FROM vaults v
    JOIN owners o ON v.owner_id = o.id
    WHERE v.id = ${vaultId}
  `;
  if (rows.length === 0) return false;
  return rows[0].wallet_address === walletAddress;
}

export function vaultRoutes(app: FastifyInstance, db: Db, config: Config) {
  const vaultService = createVaultService(db, config);
  const apiKeyService = createApiKeyService(db);
  const txService = createTxService(db, config);
  const ownerMiddleware = ownerAuth(db);

  async function loadVaultForOwner(vaultId: string) {
    const rows = await db`SELECT * FROM vaults WHERE id = ${vaultId}`;
    return rows[0] || null;
  }

  // POST /v1/vaults
  app.post("/v1/vaults", async (request, reply) => {
    const { walletAddress } = request.body as { walletAddress: string };
    if (!walletAddress) {
      return reply.status(400).send({ code: "invalid_request", message: "walletAddress required" });
    }

    const result = await vaultService.createVault(walletAddress);
    return reply.status(result.isNew ? 201 : 200).send(result);
  });

  // GET /v1/vaults/:vaultId
  app.get("/v1/vaults/:vaultId", { preHandler: ownerMiddleware }, async (request, reply) => {
    const { vaultId } = request.params as { vaultId: string };
    const ownerWallet = (request as any).ownerWallet;

    const vault = await vaultService.getVault(vaultId);
    if (!vault) {
      return reply.status(404).send({ code: "not_found", message: "Vault not found" });
    }

    if (!(await verifyVaultOwnership(db, vaultId, ownerWallet))) {
      return reply.status(403).send({ code: "forbidden", message: "Wallet does not own this vault" });
    }

    return vault;
  });

  // GET /v1/vaults/by-owner/:walletAddress
  app.get("/v1/vaults/by-owner/:walletAddress", async (request, reply) => {
    const { walletAddress } = request.params as { walletAddress: string };
    const vault = await vaultService.getVaultByOwner(walletAddress);
    if (!vault) {
      return reply.status(404).send({ code: "not_found", message: "No vault for this owner" });
    }
    return vault;
  });

  // PATCH /v1/vaults/:vaultId/policy
  app.patch("/v1/vaults/:vaultId/policy", { preHandler: ownerMiddleware }, async (request, reply) => {
    const { vaultId } = request.params as { vaultId: string };
    const ownerWallet = (request as any).ownerWallet;

    if (!(await verifyVaultOwnership(db, vaultId, ownerWallet))) {
      return reply.status(403).send({ code: "forbidden", message: "Wallet does not own this vault" });
    }

    const parsed = updatePolicySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: "invalid_request", message: parsed.error.message });
    }
    await vaultService.updatePolicy(vaultId, parsed.data);
    return { success: true };
  });

  // POST /v1/vaults/:vaultId/fee-vault/initialize
  app.post("/v1/vaults/:vaultId/fee-vault/initialize", { preHandler: ownerMiddleware }, async (request, reply) => {
    const { vaultId } = request.params as { vaultId: string };
    const ownerWallet = (request as any).ownerWallet;

    if (!(await verifyVaultOwnership(db, vaultId, ownerWallet))) {
      return reply.status(403).send({ code: "forbidden", message: "Wallet does not own this vault" });
    }

    const vault = await loadVaultForOwner(vaultId);
    if (!vault) {
      return reply.status(404).send({ code: "not_found", message: "Vault not found" });
    }

    // Compute the fee vault PDA deterministically from the owner wallet.
    const feeVaultPda = vaultService.deriveFeeVaultPda(ownerWallet);

    // Ensure the DB has it cached.
    if (!vault.fee_vault_pda) {
      await db`UPDATE vaults SET fee_vault_pda = ${feeVaultPda} WHERE id = ${vaultId}`;
    }

    await db`
      INSERT INTO activities (vault_id, type, payload_json)
      VALUES (${vaultId}, 'fee_vault_initialize_intent', ${JSON.stringify({ feeVaultPda })})
    `;

    return {
      programId: config.LOBSTERPAY_PROGRAM_ID,
      vaultPda: vault.vault_pda,
      feeVaultPda,
      owner: ownerWallet,
    };
  });

  // POST /v1/vaults/:vaultId/fee-vault/deposit
  app.post("/v1/vaults/:vaultId/fee-vault/deposit", { preHandler: ownerMiddleware }, async (request, reply) => {
    const { vaultId } = request.params as { vaultId: string };
    const ownerWallet = (request as any).ownerWallet;

    if (!(await verifyVaultOwnership(db, vaultId, ownerWallet))) {
      return reply.status(403).send({ code: "forbidden", message: "Wallet does not own this vault" });
    }

    const parsed = depositFeesSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: "invalid_request", message: parsed.error.message });
    }

    const vault = await loadVaultForOwner(vaultId);
    if (!vault) {
      return reply.status(404).send({ code: "not_found", message: "Vault not found" });
    }

    const feeVaultPda = vault.fee_vault_pda || vaultService.deriveFeeVaultPda(ownerWallet);

    await db`
      INSERT INTO activities (vault_id, type, payload_json)
      VALUES (${vaultId}, 'fee_vault_deposit_intent', ${JSON.stringify({ feeVaultPda, amount: parsed.data.amount })})
    `;

    return {
      programId: config.LOBSTERPAY_PROGRAM_ID,
      feeVaultPda,
      owner: ownerWallet,
      amount: parsed.data.amount,
    };
  });

  // POST /v1/vaults/:vaultId/fee-vault/withdraw
  app.post("/v1/vaults/:vaultId/fee-vault/withdraw", { preHandler: ownerMiddleware }, async (request, reply) => {
    const { vaultId } = request.params as { vaultId: string };
    const ownerWallet = (request as any).ownerWallet;

    if (!(await verifyVaultOwnership(db, vaultId, ownerWallet))) {
      return reply.status(403).send({ code: "forbidden", message: "Wallet does not own this vault" });
    }

    const parsed = withdrawFeesSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: "invalid_request", message: parsed.error.message });
    }

    const vault = await loadVaultForOwner(vaultId);
    if (!vault) {
      return reply.status(404).send({ code: "not_found", message: "Vault not found" });
    }

    const feeVaultPda = vault.fee_vault_pda || vaultService.deriveFeeVaultPda(ownerWallet);

    await db`
      INSERT INTO activities (vault_id, type, payload_json)
      VALUES (${vaultId}, 'fee_vault_withdraw_intent', ${JSON.stringify({ feeVaultPda, amount: parsed.data.amount })})
    `;

    return {
      programId: config.LOBSTERPAY_PROGRAM_ID,
      feeVaultPda,
      owner: ownerWallet,
      amount: parsed.data.amount,
    };
  });

  // GET /v1/vaults/:vaultId/fee-vault
  app.get("/v1/vaults/:vaultId/fee-vault", { preHandler: ownerMiddleware }, async (request, reply) => {
    const { vaultId } = request.params as { vaultId: string };
    const ownerWallet = (request as any).ownerWallet;

    if (!(await verifyVaultOwnership(db, vaultId, ownerWallet))) {
      return reply.status(403).send({ code: "forbidden", message: "Wallet does not own this vault" });
    }

    const vault = await loadVaultForOwner(vaultId);
    if (!vault) {
      return reply.status(404).send({ code: "not_found", message: "Vault not found" });
    }

    const feeVaultPda = vault.fee_vault_pda || vaultService.deriveFeeVaultPda(ownerWallet);
    const balanceLamports = await txService.getFeeVaultBalance(feeVaultPda);
    const belowThreshold = balanceLamports < FEE_VAULT_MIN_BALANCE;

    // Keep the cached fee balance in sync so dashboards can read it without
    // hitting the RPC.
    await db`
      UPDATE vault_policies
      SET fee_balance_lamports = ${balanceLamports.toString()}, updated_at = NOW()
      WHERE vault_id = ${vaultId}
    `;

    return {
      feeVaultPda,
      balanceLamports: balanceLamports.toString(),
      minBalanceLamports: FEE_VAULT_MIN_BALANCE.toString(),
      belowThreshold,
    };
  });

  // POST /v1/vaults/:vaultId/api-keys
  app.post("/v1/vaults/:vaultId/api-keys", { preHandler: ownerMiddleware }, async (request, reply) => {
    const { vaultId } = request.params as { vaultId: string };
    const ownerWallet = (request as any).ownerWallet;

    if (!(await verifyVaultOwnership(db, vaultId, ownerWallet))) {
      return reply.status(403).send({ code: "forbidden", message: "Wallet does not own this vault" });
    }

    const parsed = createApiKeySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: "invalid_request", message: parsed.error.message });
    }
    const result = await apiKeyService.create(vaultId, parsed.data);
    return reply.status(201).send(result);
  });

  // POST /v1/vaults/:vaultId/api-keys/:keyId/revoke
  app.post("/v1/vaults/:vaultId/api-keys/:keyId/revoke", { preHandler: ownerMiddleware }, async (request, reply) => {
    const { vaultId, keyId } = request.params as { vaultId: string; keyId: string };
    const ownerWallet = (request as any).ownerWallet;

    if (!(await verifyVaultOwnership(db, vaultId, ownerWallet))) {
      return reply.status(403).send({ code: "forbidden", message: "Wallet does not own this vault" });
    }

    const result = await apiKeyService.revoke(vaultId, keyId);
    if (!result) {
      return reply.status(404).send({ code: "not_found", message: "Key not found or already revoked" });
    }
    return { success: true, revoked: result };
  });

  // GET /v1/vaults/:vaultId/api-keys
  app.get("/v1/vaults/:vaultId/api-keys", { preHandler: ownerMiddleware }, async (request, reply) => {
    const { vaultId } = request.params as { vaultId: string };
    const ownerWallet = (request as any).ownerWallet;

    if (!(await verifyVaultOwnership(db, vaultId, ownerWallet))) {
      return reply.status(403).send({ code: "forbidden", message: "Wallet does not own this vault" });
    }

    const keys = await apiKeyService.list(vaultId);
    // Map snake_case Postgres rows -> camelCase for the frontend. Without
    // this, fields like `created_at` and `last_used_at` go through as-is
    // and the dashboard reads `key.createdAt` / `key.lastUsedAt` -> undefined,
    // which shows as a dash / "Never" forever (BAT-504).
    const items = keys.map((row: any) => ({
      id: row.id,
      vaultId: row.vault_id,
      label: row.label,
      prefix: row.prefix,
      status: row.status,
      expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : row.expires_at,
      allowedActionsOverride: row.allowed_actions_override,
      perTxOverride: row.per_tx_override,
      dailyLimitOverride: row.daily_limit_override,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      lastUsedAt: row.last_used_at instanceof Date ? row.last_used_at.toISOString() : row.last_used_at,
    }));
    return { items };
  });

  // GET /v1/vaults/:vaultId/activity
  app.get("/v1/vaults/:vaultId/activity", { preHandler: ownerMiddleware }, async (request, reply) => {
    const { vaultId } = request.params as { vaultId: string };
    const ownerWallet = (request as any).ownerWallet;

    if (!(await verifyVaultOwnership(db, vaultId, ownerWallet))) {
      return reply.status(403).send({ code: "forbidden", message: "Wallet does not own this vault" });
    }

    const { cursor, limit } = (request.query as any) || {};
    const pageLimit = Math.min(Number(limit) || 50, 100);

    const rows = cursor
      ? await db`SELECT * FROM activities WHERE vault_id = ${vaultId} AND created_at < ${cursor} ORDER BY created_at DESC LIMIT ${pageLimit}`
      : await db`SELECT * FROM activities WHERE vault_id = ${vaultId} ORDER BY created_at DESC LIMIT ${pageLimit}`;

    // Batch-load the referenced requests so payment/swap rows show the
    // authoritative on-chain status + signature instead of whatever was
    // captured at log time.
    const refIds = rows.map((r: any) => r.reference_request_id).filter(Boolean) as string[];
    const requestByRefId = new Map<string, any>();
    if (refIds.length > 0) {
      const reqRows = await db`
        SELECT id, tx_status, tx_signature, rejection_reason, amount_atomic, mint
        FROM requests
        WHERE id IN ${db(refIds)}
      `;
      for (const r of reqRows) requestByRefId.set(r.id, r);
    }

    const items = rows.map((row: any) => transformActivity(row, config.SOLANA_CLUSTER, requestByRefId));

    return {
      items,
      nextCursor: rows.length === pageLimit ? rows[rows.length - 1].created_at : null,
    };
  });
}
