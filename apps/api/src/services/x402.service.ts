import type { Db } from "../db/client.js";
import type { Config } from "../config.js";
import { parsePaymentRequirements, validateRequirements, type X402PaymentRequirements } from "../adapters/x402/index.js";
import { createTxService } from "./tx.service.js";

export function createX402Service(db: Db, config: Config) {
  const txService = createTxService(db, config);

  return {
    async processX402Payment(params: {
      paymentRequirements: unknown;
      originalRequestUrl: string;
      idempotencyKey: string;
      vaultId: string;
      apiKeyId: string;
      vaultPda: string;
    }) {
      // 1. Idempotency check
      const existing = await txService.checkIdempotency(params.vaultId, params.idempotencyKey);
      if (existing) {
        return {
          requestId: existing.id,
          txSignature: existing.tx_signature,
          status: existing.tx_status,
          error: existing.rejection_reason,
          paymentId: null,
        };
      }

      // 2. Parse payment requirements
      let requirements: X402PaymentRequirements;
      try {
        requirements = parsePaymentRequirements(params.paymentRequirements);
      } catch (err: any) {
        const req = await txService.persistRequest({
          vaultId: params.vaultId, apiKeyId: params.apiKeyId,
          actionType: "x402_exact", idempotencyKey: params.idempotencyKey,
          requestJson: params, decision: "rejected",
          rejectionReason: `Invalid payment requirements: ${err.message}`,
        });
        return { requestId: req.id, txSignature: null, status: "failed", error: err.message, paymentId: null };
      }

      // 3. Check for duplicate payment ID
      if (requirements.paymentId) {
        const [existingPayment] = await db`
          SELECT * FROM x402_payments WHERE payment_id = ${requirements.paymentId}
        `;
        if (existingPayment) {
          return {
            requestId: existingPayment.request_id,
            txSignature: null,
            status: "duplicate",
            error: "Payment already processed for this payment_id",
            paymentId: requirements.paymentId,
          };
        }
      }

      // 4. Load policy
      const [policy] = await db`SELECT * FROM vault_policies WHERE vault_id = ${params.vaultId}`;
      if (!policy) {
        return { requestId: null, txSignature: null, status: "failed", error: "Policy not found", paymentId: null };
      }

      // 5. Check paused
      if (policy.paused) {
        const req = await txService.persistRequest({
          vaultId: params.vaultId, apiKeyId: params.apiKeyId,
          actionType: "x402_exact", idempotencyKey: params.idempotencyKey,
          requestJson: params, decision: "rejected", rejectionReason: "vault_paused",
        });
        return { requestId: req.id, txSignature: null, status: "failed", error: "Vault is paused", paymentId: null };
      }

      // 6. Check action allowed (bit 4 = x402)
      if ((policy.allowed_actions & 4) === 0) {
        const req = await txService.persistRequest({
          vaultId: params.vaultId, apiKeyId: params.apiKeyId,
          actionType: "x402_exact", idempotencyKey: params.idempotencyKey,
          requestJson: params, decision: "rejected", rejectionReason: "action_not_allowed",
        });
        return { requestId: req.id, txSignature: null, status: "failed", error: "x402 action not allowed", paymentId: null };
      }

      // 7. Validate requirements
      const domain = new URL(params.originalRequestUrl).hostname;
      const validationError = validateRequirements(requirements, undefined, domain);
      if (validationError) {
        const req = await txService.persistRequest({
          vaultId: params.vaultId, apiKeyId: params.apiKeyId,
          actionType: "x402_exact", idempotencyKey: params.idempotencyKey,
          requestJson: params, decision: "rejected", rejectionReason: validationError,
        });
        return { requestId: req.id, txSignature: null, status: "failed", error: validationError, paymentId: null };
      }

      // 8. Check per-tx limit
      const amount = BigInt(requirements.amount);
      const perTxLimit = BigInt(policy.max_per_tx_amount_atomic);
      if (perTxLimit > 0n && amount > perTxLimit) {
        const req = await txService.persistRequest({
          vaultId: params.vaultId, apiKeyId: params.apiKeyId,
          actionType: "x402_exact", idempotencyKey: params.idempotencyKey,
          requestJson: params, decision: "rejected", rejectionReason: "exceeds_per_tx_limit",
          amountAtomic: requirements.amount, mint: requirements.asset,
        });
        return { requestId: req.id, txSignature: null, status: "failed", error: "Amount exceeds per-tx limit", paymentId: null };
      }

      // 9. Check daily limit
      const dailyLimit = BigInt(policy.daily_limit_amount_atomic);
      if (dailyLimit > 0n) {
        const dailySpent = await txService.getDailyUsage(params.vaultId, params.apiKeyId);
        if (dailySpent + amount > dailyLimit) {
          const req = await txService.persistRequest({
            vaultId: params.vaultId, apiKeyId: params.apiKeyId,
            actionType: "x402_exact", idempotencyKey: params.idempotencyKey,
            requestJson: params, decision: "rejected", rejectionReason: "exceeds_daily_limit",
            amountAtomic: requirements.amount, mint: requirements.asset,
          });
          return { requestId: req.id, txSignature: null, status: "failed", error: "Amount exceeds daily limit", paymentId: null };
        }
      }

      // 10. Persist request as approved
      const req = await txService.persistRequest({
        vaultId: params.vaultId, apiKeyId: params.apiKeyId,
        actionType: "x402_exact", idempotencyKey: params.idempotencyKey,
        requestJson: { requirements, originalRequestUrl: params.originalRequestUrl },
        decision: "approved", amountAtomic: requirements.amount, mint: requirements.asset,
        txStatus: "created",
      });

      // 11. Record x402 payment
      await db`
        INSERT INTO x402_payments (request_id, payment_id, domain, payment_requirements_json)
        VALUES (${req.id}, ${requirements.paymentId || null}, ${domain}, ${JSON.stringify(requirements)})
      `;

      // 12. Execute payment (reuse pay logic — x402 is just a directed payment)
      // For MVP, record the payment intent. Full tx execution follows the same
      // pattern as execute_pay_exact (the onchain instruction).
      await txService.trackUsage(params.vaultId, params.apiKeyId, amount);

      await txService.logActivity(params.vaultId, "x402", {
        domain,
        amount: requirements.amount,
        asset: requirements.asset,
        recipient: requirements.recipient,
        paymentId: requirements.paymentId,
        originalUrl: params.originalRequestUrl,
      }, undefined, req.id);

      return {
        requestId: req.id,
        txSignature: null,
        status: "created",
        error: null,
        paymentId: requirements.paymentId || null,
        requirements,
        message: "x402 payment validated and recorded. Onchain execution pending Anchor client integration.",
      };
    },
  };
}
