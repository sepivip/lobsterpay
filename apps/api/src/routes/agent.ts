import type { FastifyInstance } from "fastify";
import type { Db } from "../db/client.js";
import type { Config } from "../config.js";
import { createApiKeyAuth } from "../middleware/auth.js";
import { createTxService } from "../services/tx.service.js";
import { payRequestSchema } from "@lobsterpay/shared";
import { PublicKey } from "@solana/web3.js";

export function agentRoutes(app: FastifyInstance, db: Db, config: Config) {
  const auth = createApiKeyAuth(db);
  const txService = createTxService(db, config);

  // GET /v1/agent/vault
  app.get("/v1/agent/vault", { preHandler: auth }, async (request) => {
    const vaultId = (request as any).vaultId;
    const apiKey = (request as any).apiKeyRecord;

    const rows = await db`
      SELECT v.vault_pda, vp.paused, vp.allowed_actions, vp.max_per_tx_amount_atomic,
             vp.daily_limit_amount_atomic, vp.max_slippage_bps
      FROM vaults v
      JOIN vault_policies vp ON vp.vault_id = v.id
      WHERE v.id = ${vaultId}
    `;

    const policy = rows[0];
    const dailySpent = await txService.getDailyUsage(vaultId, apiKey.id);

    // Compute effective limits (key overrides take precedence)
    const effectivePerTx = apiKey.per_tx_override ?? policy.max_per_tx_amount_atomic;
    const effectiveDaily = apiKey.daily_limit_override ?? policy.daily_limit_amount_atomic;
    const effectiveActions = apiKey.allowed_actions_override ?? policy.allowed_actions;

    return {
      vaultPda: policy.vault_pda,
      balances: {},
      permissions: {
        allowedActions: effectiveActions,
        maxPerTxAmountAtomic: String(effectivePerTx),
        dailyLimitAmountAtomic: String(effectiveDaily),
        dailySpentAmountAtomic: String(dailySpent),
        maxSlippageBps: policy.max_slippage_bps,
      },
    };
  });

  // POST /v1/agent/actions/pay
  app.post("/v1/agent/actions/pay", { preHandler: auth }, async (request, reply) => {
    const vaultId = (request as any).vaultId;
    const apiKey = (request as any).apiKeyRecord;
    const parsed = payRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({ code: "invalid_request", message: parsed.error.message });
    }

    const { mint, amountAtomic, destinationOwner, destinationTokenAccount, idempotencyKey, memo } = parsed.data;

    // 1. Idempotency check
    const existing = await txService.checkIdempotency(vaultId, idempotencyKey);
    if (existing) {
      return { requestId: existing.id, txSignature: existing.tx_signature, status: existing.tx_status, error: existing.rejection_reason };
    }

    // 2. Load policy
    const [policy] = await db`SELECT * FROM vault_policies WHERE vault_id = ${vaultId}`;
    if (!policy) {
      return reply.status(500).send({ code: "internal_error", message: "Policy not found" });
    }

    // 3. Check paused
    if (policy.paused) {
      const req = await txService.persistRequest({
        vaultId, apiKeyId: apiKey.id, actionType: "pay_exact", idempotencyKey,
        requestJson: parsed.data, decision: "rejected", rejectionReason: "vault_paused",
      });
      return reply.status(403).send({ requestId: req.id, txSignature: null, status: "failed", error: "Vault is paused" });
    }

    // 4. Check action allowed (bit 2 = pay_exact)
    const effectiveActions = apiKey.allowed_actions_override ?? policy.allowed_actions;
    if ((effectiveActions & 2) === 0) {
      const req = await txService.persistRequest({
        vaultId, apiKeyId: apiKey.id, actionType: "pay_exact", idempotencyKey,
        requestJson: parsed.data, decision: "rejected", rejectionReason: "action_not_allowed",
      });
      return reply.status(403).send({ requestId: req.id, txSignature: null, status: "failed", error: "Pay action not allowed" });
    }

    // 5. Check per-tx limit
    const amount = BigInt(amountAtomic);
    const effectivePerTx = BigInt(apiKey.per_tx_override ?? policy.max_per_tx_amount_atomic);
    if (effectivePerTx > 0n && amount > effectivePerTx) {
      const req = await txService.persistRequest({
        vaultId, apiKeyId: apiKey.id, actionType: "pay_exact", idempotencyKey,
        requestJson: parsed.data, decision: "rejected", rejectionReason: "exceeds_per_tx_limit",
        amountAtomic: amountAtomic, mint,
      });
      return reply.status(403).send({ requestId: req.id, txSignature: null, status: "failed", error: "Amount exceeds per-tx limit" });
    }

    // 6. Check daily limit
    const effectiveDaily = BigInt(apiKey.daily_limit_override ?? policy.daily_limit_amount_atomic);
    if (effectiveDaily > 0n) {
      const dailySpent = await txService.getDailyUsage(vaultId, apiKey.id);
      if (dailySpent + amount > effectiveDaily) {
        const req = await txService.persistRequest({
          vaultId, apiKeyId: apiKey.id, actionType: "pay_exact", idempotencyKey,
          requestJson: parsed.data, decision: "rejected", rejectionReason: "exceeds_daily_limit",
          amountAtomic: amountAtomic, mint,
        });
        return reply.status(403).send({ requestId: req.id, txSignature: null, status: "failed", error: "Amount exceeds daily limit" });
      }
    }

    // 7. Persist as approved
    const req = await txService.persistRequest({
      vaultId, apiKeyId: apiKey.id, actionType: "pay_exact", idempotencyKey,
      requestJson: parsed.data, decision: "approved",
      amountAtomic: amountAtomic, mint, txStatus: "created",
    });

    // 8. Build + submit transaction (placeholder — full anchor CPI in next iteration)
    // For now, return the request info. Actual tx submission needs the Anchor IDL client.
    await txService.logActivity(vaultId, "payment", {
      requestId: req.id, mint, amountAtomic, destination: destinationOwner || destinationTokenAccount, memo,
    }, null, req.id);

    await txService.trackUsage(vaultId, apiKey.id, amount);

    return {
      requestId: req.id,
      txSignature: null,
      status: "created",
      error: null,
      message: "Payment validated and recorded. Transaction submission requires Anchor client integration.",
    };
  });

  // POST /v1/agent/quotes/swap
  app.post("/v1/agent/quotes/swap", { preHandler: auth }, async (_request, reply) => {
    return reply.status(501).send({ message: "Swap quotes not implemented yet (Phase 3)" });
  });

  // POST /v1/agent/actions/swap
  app.post("/v1/agent/actions/swap", { preHandler: auth }, async (_request, reply) => {
    return reply.status(501).send({ message: "Swap action not implemented yet (Phase 3)" });
  });

  // POST /v1/agent/actions/x402
  app.post("/v1/agent/actions/x402", { preHandler: auth }, async (_request, reply) => {
    return reply.status(501).send({ message: "x402 action not implemented yet (Phase 4)" });
  });
}
