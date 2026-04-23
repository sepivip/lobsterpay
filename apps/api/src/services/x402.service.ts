import type { Db } from "../db/client.js";
import type { Config } from "../config.js";
import { createHash, randomUUID } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import {
  parsePaymentRequirements,
  validateRequirements,
  type SolanaCluster,
  type X402PaymentRequirements,
} from "../adapters/x402/index.js";
import { createTxService } from "./tx.service.js";
import {
  buildExecutePayExactIx,
  buildTransaction,
  deriveFeeVaultPda,
  getVaultTokenAccount,
  getTreasuryTokenAccount,
  TREASURY_PUBKEY,
  SERVICE_FEE_BPS,
  FEE_VAULT_MIN_BALANCE,
} from "../solana/instructions.js";

/**
 * A zombie idempotency record: approved + persisted but no tx signature
 * after 90s. Same recovery semantics as the pay endpoint — let the retry
 * through instead of echoing a stuck "created" status forever.
 */
const STUCK_CREATED_TTL_MS = 90_000;

function isStuckCreated(existing: { tx_status?: string | null; tx_signature?: string | null; created_at?: string | Date | null }): boolean {
  if (!existing) return false;
  if (existing.tx_status !== "created") return false;
  if (existing.tx_signature) return false;
  if (!existing.created_at) return true;
  const createdAt = typeof existing.created_at === "string" ? Date.parse(existing.created_at) : existing.created_at.getTime();
  return Date.now() - createdAt > STUCK_CREATED_TTL_MS;
}

/**
 * Map the app config's cluster token (shared/constants SOLANA_CLUSTERS:
 * "devnet" | "mainnet-beta" | "localnet") to the x402 adapter's canonical
 * form ("devnet" | "mainnet"). `localnet` intentionally returns null -
 * there is no x402 spec value for local-only clusters, so we just skip
 * the mismatch check in that mode (localnet is dev-only, not a customer
 * surface).
 */
function adapterClusterFromConfig(c: Config["SOLANA_CLUSTER"]): SolanaCluster | null {
  if (c === "mainnet-beta") return "mainnet";
  if (c === "devnet") return "devnet";
  return null;
}

export function createX402Service(db: Db, config: Config) {
  const txService = createTxService(db, config);
  const serverCluster = adapterClusterFromConfig(config.SOLANA_CLUSTER);

  return {
    async processX402Payment(params: {
      paymentRequirements: unknown;
      originalRequestUrl: string;
      idempotencyKey?: string;
      vaultId: string;
      apiKeyId: string;
      vaultPda: string;
    }) {
      const idempotencyKey = params.idempotencyKey ?? `auto-${randomUUID()}`;

      // 1. Idempotency check — honour zombie recovery so a crashed prior
      // submit doesn't permanently stick the record at "created".
      const existing = await txService.checkIdempotency(params.vaultId, idempotencyKey);
      if (existing && !isStuckCreated(existing)) {
        return {
          requestId: existing.id,
          txSignature: existing.tx_signature,
          status: existing.tx_status,
          error: existing.rejection_reason,
          paymentId: null as string | null,
        };
      }

      // 2. Parse + validate the 402's payment requirements.
      let requirements: X402PaymentRequirements;
      try {
        requirements = parsePaymentRequirements(params.paymentRequirements, serverCluster);
      } catch (err: any) {
        const req = await txService.persistRequest({
          vaultId: params.vaultId, apiKeyId: params.apiKeyId,
          actionType: "x402_exact", idempotencyKey,
          requestJson: params, decision: "rejected",
          rejectionReason: `Invalid payment requirements: ${err.message}`,
        });
        return { requestId: req.id, txSignature: null, status: "failed", error: err.message, paymentId: null };
      }

      // 3. Dedup by paymentId (the 402 server's nonce) so retries against
      // the same paywall don't double-charge even across idempotencyKey
      // churn.
      if (requirements.paymentId) {
        const [existingPayment] = await db`
          SELECT xp.*, r.tx_signature, r.tx_status
          FROM x402_payments xp
          JOIN requests r ON r.id = xp.request_id
          WHERE xp.payment_id = ${requirements.paymentId}
        `;
        if (existingPayment) {
          return {
            requestId: existingPayment.request_id,
            txSignature: existingPayment.tx_signature,
            status: existingPayment.tx_status === "confirmed" ? "duplicate" : existingPayment.tx_status,
            error: "Payment already processed for this payment_id",
            paymentId: requirements.paymentId,
          };
        }
      }

      // 4. Load policy + enforce paused / action / limits offchain.
      const [policy] = await db`SELECT * FROM vault_policies WHERE vault_id = ${params.vaultId}`;
      if (!policy) {
        return { requestId: null, txSignature: null, status: "failed", error: "Policy not found", paymentId: null };
      }

      if (policy.paused) {
        const req = await txService.persistRequest({
          vaultId: params.vaultId, apiKeyId: params.apiKeyId,
          actionType: "x402_exact", idempotencyKey,
          requestJson: params, decision: "rejected", rejectionReason: "vault_paused",
        });
        return { requestId: req.id, txSignature: null, status: "failed", error: "Vault is paused", paymentId: null };
      }

      // bit 4 = x402
      if ((policy.allowed_actions & 4) === 0) {
        const req = await txService.persistRequest({
          vaultId: params.vaultId, apiKeyId: params.apiKeyId,
          actionType: "x402_exact", idempotencyKey,
          requestJson: params, decision: "rejected", rejectionReason: "action_not_allowed",
        });
        return { requestId: req.id, txSignature: null, status: "failed", error: "x402 action not allowed", paymentId: null };
      }

      let domain = "";
      try {
        domain = new URL(params.originalRequestUrl).hostname;
      } catch {
        const req = await txService.persistRequest({
          vaultId: params.vaultId, apiKeyId: params.apiKeyId,
          actionType: "x402_exact", idempotencyKey,
          requestJson: params, decision: "rejected", rejectionReason: "invalid_original_url",
        });
        return { requestId: req.id, txSignature: null, status: "failed", error: "Invalid originalRequestUrl", paymentId: null };
      }

      const validationError = validateRequirements(requirements, undefined, domain);
      if (validationError) {
        const req = await txService.persistRequest({
          vaultId: params.vaultId, apiKeyId: params.apiKeyId,
          actionType: "x402_exact", idempotencyKey,
          requestJson: params, decision: "rejected", rejectionReason: validationError,
        });
        return { requestId: req.id, txSignature: null, status: "failed", error: validationError, paymentId: null };
      }

      // 5. Per-tx + daily-limit enforcement. Daily uses the atomic
      // reserve-and-check (same primitive as pay) so a burst of concurrent
      // x402 calls can't overspend the cap.
      const amount = BigInt(requirements.amount);
      const perTxLimit = BigInt(policy.max_per_tx_amount_atomic);
      if (perTxLimit > 0n && amount > perTxLimit) {
        const req = await txService.persistRequest({
          vaultId: params.vaultId, apiKeyId: params.apiKeyId,
          actionType: "x402_exact", idempotencyKey,
          requestJson: params, decision: "rejected", rejectionReason: "exceeds_per_tx_limit",
          amountAtomic: requirements.amount, mint: requirements.asset,
        });
        return { requestId: req.id, txSignature: null, status: "failed", error: "Amount exceeds per-tx limit", paymentId: null };
      }

      const dailyLimit = BigInt(policy.daily_limit_amount_atomic);
      let reserved = false;
      if (dailyLimit > 0n) {
        const reservation = await txService.reserveUsage(params.vaultId, params.apiKeyId, amount, dailyLimit);
        if (!reservation.allowed) {
          const req = await txService.persistRequest({
            vaultId: params.vaultId, apiKeyId: params.apiKeyId,
            actionType: "x402_exact", idempotencyKey,
            requestJson: params, decision: "rejected", rejectionReason: "exceeds_daily_limit",
            amountAtomic: requirements.amount, mint: requirements.asset,
          });
          return { requestId: req.id, txSignature: null, status: "failed", error: "Amount exceeds daily limit", paymentId: null };
        }
        reserved = true;
      }

      // Compute the 1.5% service fee for auditing (the on-chain program
      // enforces the actual split).
      const grossAmount = amount;
      const serviceFee = (grossAmount * SERVICE_FEE_BPS) / 10000n;
      const netAmount = grossAmount - serviceFee;

      // 6. Persist the request as approved, BEFORE tx submission so the
      // idempotency + zombie-recovery logic has something to echo if we
      // crash mid-submit.
      const req = await txService.persistRequest({
        vaultId: params.vaultId, apiKeyId: params.apiKeyId,
        actionType: "x402_exact", idempotencyKey,
        requestJson: {
          requirements,
          originalRequestUrl: params.originalRequestUrl,
          grossAmount: grossAmount.toString(),
          netAmount: netAmount.toString(),
          serviceFee: serviceFee.toString(),
        },
        decision: "approved",
        amountAtomic: requirements.amount,
        mint: requirements.asset,
        txStatus: "created",
      });

      // 7. Pre-reserve the x402_payments row so the paymentId unique index
      // catches concurrent retries. Settlement JSON gets filled in after
      // the on-chain tx lands.
      if (requirements.paymentId) {
        try {
          await db`
            INSERT INTO x402_payments (request_id, payment_id, domain, payment_requirements_json)
            VALUES (${req.id}, ${requirements.paymentId}, ${domain}, ${JSON.stringify(requirements)})
          `;
        } catch {
          // Unique-index collision — another request already claimed this
          // paymentId. Roll back + return duplicate.
          if (reserved) await txService.releaseUsage(params.vaultId, params.apiKeyId, amount);
          await txService.updateRequestTx(req.id, "", "failed");
          return {
            requestId: req.id,
            txSignature: null,
            status: "duplicate",
            error: "Concurrent payment already processed for this paymentId",
            paymentId: requirements.paymentId,
          };
        }
      } else {
        await db`
          INSERT INTO x402_payments (request_id, payment_id, domain, payment_requirements_json)
          VALUES (${req.id}, NULL, ${domain}, ${JSON.stringify(requirements)})
        `;
      }

      // 8. Build + submit the on-chain SPL transfer via execute_pay_exact.
      // The program enforces policy again on-chain, so even if our off-chain
      // checks have a bug the vault is still safe.
      if (!txService.feePayer) {
        if (reserved) await txService.releaseUsage(params.vaultId, params.apiKeyId, amount);
        await txService.updateRequestTx(req.id, "", "failed");
        return { requestId: req.id, txSignature: null, status: "failed", error: "Fee payer not configured", paymentId: requirements.paymentId || null };
      }

      try {
        const [vault] = await db`SELECT vault_pda, policy_pda, fee_vault_pda FROM vaults WHERE id = ${params.vaultId}`;
        const vaultPubkey = new PublicKey(vault.vault_pda);
        const policyPubkey = new PublicKey(vault.policy_pda);
        const mintPubkey = new PublicKey(requirements.asset);
        const vaultTokenAcct = getVaultTokenAccount(vaultPubkey, mintPubkey, TOKEN_PROGRAM_ID);

        // Fee vault PDA (cache-backed; derive if missing)
        let feeVaultPubkey: PublicKey;
        if (vault.fee_vault_pda) {
          feeVaultPubkey = new PublicKey(vault.fee_vault_pda);
        } else {
          const [ownerRow] = await db`
            SELECT o.wallet_address FROM vaults v
            JOIN owners o ON o.id = v.owner_id
            WHERE v.id = ${params.vaultId}
          `;
          if (!ownerRow) throw new Error("Vault owner not found");
          const ownerPubkey = new PublicKey(ownerRow.wallet_address);
          [feeVaultPubkey] = deriveFeeVaultPda(ownerPubkey, txService.programId);
          await db`UPDATE vaults SET fee_vault_pda = ${feeVaultPubkey.toString()} WHERE id = ${params.vaultId}`;
        }

        // Pre-flight: fee vault has enough SOL to reimburse the relayer
        const feeVaultBalance = await txService.getFeeVaultBalance(feeVaultPubkey.toString());
        if (feeVaultBalance < FEE_VAULT_MIN_BALANCE) {
          if (reserved) await txService.releaseUsage(params.vaultId, params.apiKeyId, amount);
          await txService.updateRequestTx(req.id, "", "failed");
          return {
            requestId: req.id,
            txSignature: null,
            status: "failed",
            error: `Fee vault below minimum balance (${feeVaultBalance.toString()} < ${FEE_VAULT_MIN_BALANCE.toString()} lamports).`,
            paymentId: requirements.paymentId || null,
          };
        }

        // Pre-flight: vault holds enough of the token
        const vaultBalance = await txService.getTokenBalance(vaultTokenAcct);
        if (BigInt(vaultBalance) < grossAmount) {
          if (reserved) await txService.releaseUsage(params.vaultId, params.apiKeyId, amount);
          await txService.updateRequestTx(req.id, "", "failed");
          return {
            requestId: req.id,
            txSignature: null,
            status: "failed",
            error: "Insufficient vault balance",
            paymentId: requirements.paymentId || null,
          };
        }

        // Destination ATA from the 402's recipient wallet
        const recipientPubkey = new PublicKey(requirements.recipient);
        const destTokenAcct = getAssociatedTokenAddressSync(mintPubkey, recipientPubkey);

        // Treasury ATA for the 1.5% service fee
        const treasuryTokenAcct = getTreasuryTokenAccount(mintPubkey, TOKEN_PROGRAM_ID);

        // Pre-create dest + treasury ATAs if missing (same as pay route)
        const preIxs = [];
        try {
          const treasuryAcctInfo = await txService.connection.getAccountInfo(treasuryTokenAcct);
          if (!treasuryAcctInfo) {
            preIxs.push(
              createAssociatedTokenAccountIdempotentInstruction(
                txService.feePayer.publicKey,
                treasuryTokenAcct,
                TREASURY_PUBKEY,
                mintPubkey,
                TOKEN_PROGRAM_ID,
              ),
            );
          }
          const destAcctInfo = await txService.connection.getAccountInfo(destTokenAcct);
          if (!destAcctInfo) {
            preIxs.push(
              createAssociatedTokenAccountIdempotentInstruction(
                txService.feePayer.publicKey,
                destTokenAcct,
                recipientPubkey,
                mintPubkey,
                TOKEN_PROGRAM_ID,
              ),
            );
          }
        } catch {
          // non-fatal; if we can't check, fall through and let the program
          // surface the AccountNotInitialized error on failed retries
        }

        // Hash the idempotency key as the on-chain request hash so the
        // same key reuses the same nonce if retried (matches pay route).
        const requestHash = createHash("sha256").update(idempotencyKey).digest();

        const payIx = buildExecutePayExactIx({
          authority: txService.feePayer.publicKey,
          vault: vaultPubkey,
          policy: policyPubkey,
          feeVault: feeVaultPubkey,
          mint: mintPubkey,
          vaultTokenAccount: vaultTokenAcct,
          destinationTokenAccount: destTokenAcct,
          treasuryTokenAccount: treasuryTokenAcct,
          tokenProgramId: TOKEN_PROGRAM_ID,
          params: {
            amount: grossAmount,
            requestHash,
          },
        });

        const tx = await buildTransaction([...preIxs, payIx], txService.feePayer.publicKey, txService.connection);
        const signature = await txService.sendAndConfirm(tx, [txService.feePayer]);

        // 9. Persist the settlement + mark the request confirmed. This is
        // the signature the agent puts in its X-PAYMENT header on the
        // retry against originalRequestUrl.
        await txService.updateRequestTx(req.id, signature, "confirmed");
        await db`
          UPDATE x402_payments
          SET settlement_json = ${JSON.stringify({
            paymentId: requirements.paymentId ?? null,
            txSignature: signature,
            status: "confirmed",
            amount: requirements.amount,
            asset: requirements.asset,
            network: requirements.network,
          })}
          WHERE request_id = ${req.id}
        `;
        await txService.logActivity(params.vaultId, "x402", {
          domain,
          amount: requirements.amount,
          asset: requirements.asset,
          recipient: requirements.recipient,
          paymentId: requirements.paymentId,
          originalUrl: params.originalRequestUrl,
          grossAmount: grossAmount.toString(),
          netAmount: netAmount.toString(),
          serviceFee: serviceFee.toString(),
        }, signature, req.id);

        // X-PAYMENT header value the agent sends on its retry against
        // originalRequestUrl. Spec-compliant shape: base64-encoded JSON
        // with the settlement details. Upstream API verifies the
        // signature against its configured recipient + amount.
        const xPaymentHeader = Buffer.from(
          JSON.stringify({
            scheme: "exact",
            network: requirements.network,
            txSignature: signature,
            amount: requirements.amount,
            asset: requirements.asset,
            recipient: requirements.recipient,
            paymentId: requirements.paymentId ?? null,
          }),
        ).toString("base64");

        return {
          requestId: req.id,
          txSignature: signature,
          status: "confirmed" as const,
          paymentId: requirements.paymentId || null,
          xPaymentHeader,
          grossAmount: grossAmount.toString(),
          netAmount: netAmount.toString(),
          serviceFee: serviceFee.toString(),
          error: null,
        };
      } catch (err: any) {
        const isTimeout = /timeout|expired|not confirmed/i.test(err?.message ?? "");
        const finalStatus = isTimeout ? "pending_confirmation" : "failed";
        await txService.updateRequestTx(req.id, "", finalStatus);
        if (!isTimeout && reserved) {
          await txService.releaseUsage(params.vaultId, params.apiKeyId, amount);
        }
        await txService.logActivity(params.vaultId, "x402", {
          domain,
          amount: requirements.amount,
          asset: requirements.asset,
          recipient: requirements.recipient,
          paymentId: requirements.paymentId,
          error: String(err?.message ?? err).slice(0, 400),
        }, undefined, req.id);
        return {
          requestId: req.id,
          txSignature: null,
          status: finalStatus,
          paymentId: requirements.paymentId || null,
          error: isTimeout
            ? "Transaction confirmation timed out; status uncertain"
            : `x402 settlement failed: ${String(err?.message ?? err).slice(0, 200)}`,
        };
      }
    },
  };
}
