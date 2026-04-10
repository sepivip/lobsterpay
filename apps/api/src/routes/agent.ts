import type { FastifyInstance } from "fastify";
import type { Db } from "../db/client.js";
import type { Config } from "../config.js";
import { createApiKeyAuth } from "../middleware/auth.js";
import { createTxService } from "../services/tx.service.js";
import { createSwapService } from "../services/swap.service.js";
import { createX402Service } from "../services/x402.service.js";
import { payRequestSchema, swapRequestSchema, x402RequestSchema } from "@lobsterpay/shared";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { createHash } from "node:crypto";
import {
  buildExecutePayExactIx,
  buildEnsureVaultTokenAccountIx,
  buildTransaction,
  deriveVaultPda,
  derivePolicyPda,
  getVaultTokenAccount,
} from "../solana/instructions.js";

export function agentRoutes(app: FastifyInstance, db: Db, config: Config) {
  const auth = createApiKeyAuth(db);
  const txService = createTxService(db, config);
  const swapService = createSwapService(db, config);

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

    // 8. Build + submit onchain transaction
    if (!txService.feePayer) {
      return reply.status(500).send({ code: "config_error", message: "Fee payer not configured" });
    }

    try {
      // Derive accounts
      const [vault] = await db`SELECT vault_pda, policy_pda FROM vaults WHERE id = ${vaultId}`;
      const vaultPubkey = new PublicKey(vault.vault_pda);
      const policyPubkey = new PublicKey(vault.policy_pda);
      const mintPubkey = new PublicKey(mint);
      const vaultTokenAcct = getVaultTokenAccount(vaultPubkey, mintPubkey, TOKEN_PROGRAM_ID);

      // Resolve destination token account
      let destTokenAcct: PublicKey;
      if (destinationTokenAccount) {
        destTokenAcct = new PublicKey(destinationTokenAccount);
      } else if (destinationOwner) {
        destTokenAcct = getAssociatedTokenAddressSync(mintPubkey, new PublicKey(destinationOwner));
      } else {
        return reply.status(400).send({ code: "invalid_request", message: "destinationOwner or destinationTokenAccount required" });
      }

      // Build request hash from idempotency key
      const requestHash = createHash("sha256").update(idempotencyKey).digest();

      // Build execute_pay_exact instruction
      const payIx = buildExecutePayExactIx({
        authority: txService.feePayer.publicKey,
        vault: vaultPubkey,
        policy: policyPubkey,
        mint: mintPubkey,
        vaultTokenAccount: vaultTokenAcct,
        destinationTokenAccount: destTokenAcct,
        tokenProgramId: TOKEN_PROGRAM_ID,
        params: {
          amount: BigInt(amountAtomic),
          requestHash,
        },
      });

      // Build and send transaction
      const tx = await buildTransaction([payIx], txService.feePayer.publicKey, txService.connection);
      const signature = await txService.sendAndConfirm(tx, [txService.feePayer]);

      // Update request with signature
      await txService.updateRequestTx(req.id, signature, "confirmed");
      await txService.trackUsage(vaultId, apiKey.id, amount);
      await txService.logActivity(vaultId, "payment", {
        requestId: req.id, mint, amountAtomic,
        destination: destinationOwner || destinationTokenAccount, memo,
      }, signature, req.id);

      return {
        requestId: req.id,
        txSignature: signature,
        status: "confirmed",
        error: null,
      };
    } catch (err: any) {
      await txService.updateRequestTx(req.id, "", "failed");
      await txService.logActivity(vaultId, "payment", {
        requestId: req.id, mint, amountAtomic, error: err.message,
      }, null, req.id);

      return reply.status(500).send({
        requestId: req.id,
        txSignature: null,
        status: "failed",
        error: err.message,
      });
    }
  });

  // POST /v1/agent/quotes/swap
  app.post("/v1/agent/quotes/swap", { preHandler: auth }, async (request, reply) => {
    const vaultId = (request as any).vaultId;
    const apiKey = (request as any).apiKeyRecord;
    const body = request.body as Record<string, unknown>;

    const fromMint = body.fromMint as string;
    const toMint = body.toMint as string;
    const amountAtomic = body.amountAtomic as string;
    const maxSlippageBps = (body.maxSlippageBps as number) || 100;

    if (!fromMint || !toMint || !amountAtomic) {
      return reply.status(400).send({ code: "invalid_request", message: "fromMint, toMint, and amountAtomic are required" });
    }

    try {
      const quote = await swapService.getQuote({
        fromMint,
        toMint,
        amountAtomic,
        maxSlippageBps,
        vaultId,
        apiKeyId: apiKey.id,
      });

      return {
        fromMint: quote.fromMint,
        toMint: quote.toMint,
        amountIn: quote.amountIn,
        expectedOut: quote.expectedOut,
        minOut: quote.minOut,
        priceImpactPct: quote.priceImpactPct,
        maxSlippageBps: quote.maxSlippageBps,
        expiresAt: quote.expiresAt,
        routeSummary: quote.routeSummary,
      };
    } catch (err: any) {
      return reply.status(502).send({ code: "swap_quote_error", message: err.message });
    }
  });

  // POST /v1/agent/actions/swap
  app.post("/v1/agent/actions/swap", { preHandler: auth }, async (request, reply) => {
    const vaultId = (request as any).vaultId;
    const apiKey = (request as any).apiKeyRecord;
    const parsed = swapRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({ code: "invalid_request", message: parsed.error.message });
    }

    const { fromMint, toMint, amountAtomic, maxSlippageBps, idempotencyKey } = parsed.data;

    // Load vault PDA
    const [vault] = await db`SELECT vault_pda FROM vaults WHERE id = ${vaultId}`;
    if (!vault) {
      return reply.status(500).send({ code: "internal_error", message: "Vault not found" });
    }

    try {
      const result = await swapService.executeSwap({
        fromMint,
        toMint,
        amountAtomic,
        maxSlippageBps,
        idempotencyKey,
        vaultId,
        apiKeyId: apiKey.id,
        vaultPda: vault.vault_pda,
      });

      if (result.status === "failed" && result.error) {
        const isRejection = [
          "Vault is paused",
          "Swap action not allowed",
          "Amount exceeds per-tx limit",
          "Amount exceeds daily limit",
        ].includes(result.error);

        if (isRejection) {
          return reply.status(403).send(result);
        }
      }

      return result;
    } catch (err: any) {
      return reply.status(500).send({ code: "swap_error", message: err.message });
    }
  });

  // POST /v1/agent/actions/x402
  app.post("/v1/agent/actions/x402", { preHandler: auth }, async (request, reply) => {
    const vaultId = (request as any).vaultId;
    const apiKey = (request as any).apiKeyRecord;
    const parsed = x402RequestSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({ code: "invalid_request", message: parsed.error.message });
    }

    const { paymentRequirements, originalRequestUrl, idempotencyKey } = parsed.data;

    const [vault] = await db`SELECT vault_pda FROM vaults WHERE id = ${vaultId}`;

    const x402Service = createX402Service(db, config);
    const result = await x402Service.processX402Payment({
      paymentRequirements,
      originalRequestUrl,
      idempotencyKey,
      vaultId,
      apiKeyId: apiKey.id,
      vaultPda: vault.vault_pda,
    });

    if (result.error) {
      return reply.status(result.status === "duplicate" ? 409 : 403).send(result);
    }

    return result;
  });
}
