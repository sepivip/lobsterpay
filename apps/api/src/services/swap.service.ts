import type { Db } from "../db/client.js";
import type { Config } from "../config.js";
import type { SwapAdapter, SwapQuote } from "../adapters/swap/index.js";
import { createJupiterAdapter } from "../adapters/swap/jupiter.js";
import { createTxService } from "./tx.service.js";
import { VersionedTransaction } from "@solana/web3.js";

export function createSwapService(db: Db, config: Config) {
  const adapter: SwapAdapter = createJupiterAdapter();
  const txService = createTxService(db, config);

  return {
    adapter,

    async getQuote(params: {
      fromMint: string;
      toMint: string;
      amountAtomic: string;
      maxSlippageBps: number;
      vaultId: string;
      apiKeyId: string;
    }): Promise<SwapQuote> {
      // Load policy to check max slippage
      const [policy] = await db`SELECT * FROM vault_policies WHERE vault_id = ${params.vaultId}`;

      const effectiveSlippage = Math.min(
        params.maxSlippageBps,
        policy?.max_slippage_bps || 100,
      );

      const quote = await adapter.getQuote({
        fromMint: params.fromMint,
        toMint: params.toMint,
        amountIn: params.amountAtomic,
        maxSlippageBps: effectiveSlippage,
      });

      return quote;
    },

    async executeSwap(params: {
      fromMint: string;
      toMint: string;
      amountAtomic: string;
      maxSlippageBps: number;
      idempotencyKey: string;
      vaultId: string;
      apiKeyId: string;
      vaultPda: string;
      apiKeyRecord?: any;
    }) {
      // 1. Idempotency check
      const existing = await txService.checkIdempotency(params.vaultId, params.idempotencyKey);
      if (existing) {
        return {
          requestId: existing.id,
          txSignature: existing.tx_signature,
          status: existing.tx_status,
          error: existing.rejection_reason,
        };
      }

      // 2. Load policy
      const [policy] = await db`SELECT * FROM vault_policies WHERE vault_id = ${params.vaultId}`;
      if (!policy) throw new Error("Policy not found");

      // Apply API key overrides where available
      const keyRecord = params.apiKeyRecord;
      const effectiveActions = keyRecord?.allowed_actions_override ?? policy.allowed_actions;
      const effectivePerTx = BigInt(keyRecord?.per_tx_override ?? policy.max_per_tx_amount_atomic);
      const effectiveDaily = BigInt(keyRecord?.daily_limit_override ?? policy.daily_limit_amount_atomic);

      // 3. Check paused
      if (policy.paused) {
        const req = await txService.persistRequest({
          vaultId: params.vaultId,
          apiKeyId: params.apiKeyId,
          actionType: "swap_exact_in",
          idempotencyKey: params.idempotencyKey,
          requestJson: params,
          decision: "rejected",
          rejectionReason: "vault_paused",
        });
        return { requestId: req.id, txSignature: null, status: "failed", error: "Vault is paused" };
      }

      // 4. Check action allowed (bit 1 = swap)
      if ((effectiveActions & 1) === 0) {
        const req = await txService.persistRequest({
          vaultId: params.vaultId,
          apiKeyId: params.apiKeyId,
          actionType: "swap_exact_in",
          idempotencyKey: params.idempotencyKey,
          requestJson: params,
          decision: "rejected",
          rejectionReason: "action_not_allowed",
        });
        return { requestId: req.id, txSignature: null, status: "failed", error: "Swap action not allowed" };
      }

      // 5. Check per-tx limit
      const amount = BigInt(params.amountAtomic);
      if (effectivePerTx > 0n && amount > effectivePerTx) {
        const req = await txService.persistRequest({
          vaultId: params.vaultId,
          apiKeyId: params.apiKeyId,
          actionType: "swap_exact_in",
          idempotencyKey: params.idempotencyKey,
          requestJson: params,
          decision: "rejected",
          rejectionReason: "exceeds_per_tx_limit",
          amountAtomic: params.amountAtomic,
          mint: params.fromMint,
        });
        return { requestId: req.id, txSignature: null, status: "failed", error: "Amount exceeds per-tx limit" };
      }

      // 6. Atomic daily limit check-and-reserve
      if (effectiveDaily > 0n) {
        const reservation = await txService.reserveUsage(params.vaultId, params.apiKeyId, amount, effectiveDaily);
        if (!reservation.allowed) {
          const req = await txService.persistRequest({
            vaultId: params.vaultId,
            apiKeyId: params.apiKeyId,
            actionType: "swap_exact_in",
            idempotencyKey: params.idempotencyKey,
            requestJson: params,
            decision: "rejected",
            rejectionReason: "exceeds_daily_limit",
            amountAtomic: params.amountAtomic,
            mint: params.fromMint,
          });
          return { requestId: req.id, txSignature: null, status: "failed", error: "Amount exceeds daily limit" };
        }
      }

      // 7. Get quote
      const quote = await this.getQuote({
        fromMint: params.fromMint,
        toMint: params.toMint,
        amountAtomic: params.amountAtomic,
        maxSlippageBps: params.maxSlippageBps,
        vaultId: params.vaultId,
        apiKeyId: params.apiKeyId,
      });

      // 8. Build swap transaction — Jupiter builds the full tx with the vault as the user
      const { serializedTransaction } = await adapter.buildSwapTransaction(quote, params.vaultPda);

      // 9. Persist request as approved
      const req = await txService.persistRequest({
        vaultId: params.vaultId,
        apiKeyId: params.apiKeyId,
        actionType: "swap_exact_in",
        idempotencyKey: params.idempotencyKey,
        requestJson: {
          ...params,
          quote: {
            expectedOut: quote.expectedOut,
            minOut: quote.minOut,
            routeSummary: quote.routeSummary,
          },
        },
        decision: "approved",
        amountAtomic: params.amountAtomic,
        mint: params.fromMint,
        txStatus: "created",
      });

      // 10. Submit transaction
      try {
        const txBuffer = Buffer.from(serializedTransaction, "base64");
        const tx = VersionedTransaction.deserialize(txBuffer);

        // Sign with fee payer if available
        if (txService.feePayer) {
          tx.sign([txService.feePayer]);
        }

        const signature = await txService.connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: false,
          maxRetries: 3,
        });

        await txService.updateRequestTx(req.id, signature, "sent");

        // Confirm
        const confirmation = await txService.connection.confirmTransaction(signature, "confirmed");
        const finalStatus = confirmation.value.err ? "failed" : "confirmed";
        await txService.updateRequestTx(req.id, signature, finalStatus);

        // Release usage reservation on definitive failure
        if (finalStatus === "failed" && effectiveDaily > 0n) {
          await txService.releaseUsage(params.vaultId, params.apiKeyId, amount);
        }

        // Log activity
        await txService.logActivity(
          params.vaultId,
          "swap",
          {
            fromMint: params.fromMint,
            toMint: params.toMint,
            amountIn: params.amountAtomic,
            expectedOut: quote.expectedOut,
            routeSummary: quote.routeSummary,
          },
          signature,
          req.id,
        );

        return {
          requestId: req.id,
          txSignature: signature,
          status: finalStatus,
          error: confirmation.value.err ? JSON.stringify(confirmation.value.err) : null,
        };
      } catch (err: any) {
        const isTimeout = err.message?.includes('timeout') || err.message?.includes('expired');
        const status = isTimeout ? 'pending_confirmation' : 'failed';
        await txService.updateRequestTx(req.id, "", status);

        // Release usage reservation on definitive failure
        if (!isTimeout && effectiveDaily > 0n) {
          await txService.releaseUsage(params.vaultId, params.apiKeyId, amount);
        }

        await txService.logActivity(
          params.vaultId,
          "swap",
          {
            error: err.message,
            fromMint: params.fromMint,
            toMint: params.toMint,
            amountIn: params.amountAtomic,
          },
          undefined,
          req.id,
        );
        return {
          requestId: req.id,
          txSignature: null,
          status,
          error: isTimeout ? "Transaction confirmation timed out, status uncertain" : "Swap transaction failed",
        };
      }
    },
  };
}
