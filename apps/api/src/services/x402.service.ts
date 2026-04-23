import type { Db } from "../db/client.js";
import type { Config } from "../config.js";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  ComputeBudgetProgram,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getMint,
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
  BPS_DENOMINATOR,
  FEE_VAULT_MIN_BALANCE,
} from "../solana/instructions.js";

// Facilitator-mode x402 constants — must match what @x402/svm/exact
// requires on the verify side.
//   https://github.com/coinbase/x402/blob/main/typescript/packages/mechanisms/svm/src/exact/facilitator/scheme.ts
const MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
);
const FACILITATOR_COMPUTE_UNIT_LIMIT = 300_000;
const FACILITATOR_COMPUTE_UNIT_PRICE_MICROLAMPORTS = 1_000_000;

/**
 * Given the amount the facilitator demands (after our SERVICE_FEE_BPS fee
 * has been skimmed), compute the minimum gross amount the vault must
 * send via `execute_pay_exact` so that at least `agonAmount` lands in
 * the relayer's ATA (the rest is the LobsterPay service fee).
 *
 * `execute_pay_exact` computes on-chain:
 *   service_fee = floor(gross * SERVICE_FEE_BPS / BPS_DENOMINATOR)
 *   net = gross - service_fee
 *
 * We need net >= agonAmount, i.e.
 *   gross - floor(gross * SERVICE_FEE_BPS / BPS_DENOMINATOR) >= agonAmount.
 *
 * Start from gross ≈ ceil(agonAmount * BPS_DENOMINATOR / (BPS_DENOMINATOR - SERVICE_FEE_BPS))
 * and bump by 1 until the on-chain-exact invariant holds (covers floor-rounding
 * edge cases).
 */
function computeGrossFromAgonAmount(agonAmount: bigint): bigint {
  const netBps = BPS_DENOMINATOR - SERVICE_FEE_BPS; // e.g. 10000 - 150 = 9850
  const num = agonAmount * BPS_DENOMINATOR;
  let gross = num / netBps;
  if (gross * netBps !== num) gross += 1n;
  while (gross - (gross * SERVICE_FEE_BPS) / BPS_DENOMINATOR < agonAmount) {
    gross += 1n;
  }
  return gross;
}

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

        // Payment header value the agent sends on its retry against
        // originalRequestUrl. Shape is the x402 v2 envelope:
        //   { x402Version, scheme, network, payload: { ...settlement } }
        // The `payload` itself carries both the v2 field names (payTo,
        // maxAmountRequired) AND our legacy aliases (recipient, amount)
        // so upstream verifiers that read either get what they need.
        //
        // Note: this header is usable by upstream paywalls that verify
        // by on-chain tx-signature lookup (like our /v1/demo/x402/*).
        // It is NOT compatible with spec-conformant x402 facilitator
        // gateways (agonx402, Coinbase reference facilitator) - those
        // expect a pre-signed UNSUBMITTED transaction that they will
        // submit themselves, which the LobsterPay vault-PDA model
        // cannot produce. See the skill docs' "compatibility" note.
        const xPaymentHeader = Buffer.from(
          JSON.stringify({
            x402Version: 2,
            scheme: "exact",
            network: requirements.network,
            payload: {
              txSignature: signature,
              // v2 field names
              maxAmountRequired: requirements.amount,
              payTo: requirements.recipient,
              asset: requirements.asset,
              // Back-compat aliases (what the flat pre-v2 header used)
              amount: requirements.amount,
              recipient: requirements.recipient,
              paymentId: requirements.paymentId ?? null,
            },
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

    /**
     * Facilitator-mode x402 — for spec-conformant x402 SVM gateways
     * (agonx402, Coinbase reference facilitator, etc.) that expect a
     * pre-signed unsubmitted v0 transferChecked tx in PAYMENT-SIGNATURE.
     *
     * Two txs per call:
     *   tx1 (LobsterPay-submitted): execute_pay_exact(vault → relayer's
     *        USDC ATA, grossAmount). Pulls exactly `agonAmount + 1.5%`
     *        out of the user's vault; 98.5% lands in the relayer's ATA,
     *        1.5% routes to the LobsterPay treasury. Relayer pays SOL
     *        fee (reimbursed from user's fee_vault).
     *   tx2 (facilitator-submitted): v0 tx with feePayer=facilitator and
     *        instruction order [setComputeUnitLimit, setComputeUnitPrice,
     *        transferChecked(relayer_ata → facilitator_payTo_ata, amount=
     *        agonAmount), memo(random nonce)] — matches what @x402/svm/exact
     *        verifier accepts. Relayer partial-signs as authority. Returned
     *        to the agent wrapped in the x402 v2 envelope
     *        { x402Version: 2, accepted: <requirements>, payload:
     *        { transaction: <base64> } } for PAYMENT-SIGNATURE.
     *
     * The relayer's USDC ATA is a per-call passthrough — no shared pool
     * across users. Each call funds its own tx2 from the specific user's
     * vault via tx1.
     */
    async buildX402FacilitatorPayment(params: {
      paymentRequirements: unknown;
      originalRequestUrl: string;
      idempotencyKey?: string;
      vaultId: string;
      apiKeyId: string;
    }) {
      const idempotencyKey = params.idempotencyKey ?? `auto-${randomUUID()}`;

      // 1. Idempotency short-circuit — zombie-recovery respected.
      const existing = await txService.checkIdempotency(params.vaultId, idempotencyKey);
      if (existing && !isStuckCreated(existing)) {
        return {
          requestId: existing.id,
          status: existing.tx_status,
          error: existing.rejection_reason ??
            (existing.tx_status === "awaiting_facilitator"
              ? "Partial tx already issued for this idempotencyKey; blockhash may have expired. Use a new idempotencyKey."
              : null),
          paymentId: null as string | null,
          paymentSignatureHeader: null as string | null,
          partialTransactionBase64: null as string | null,
          tx1Signature: existing.tx_signature ?? null,
        };
      }

      // 2. Parse + validate requirements.
      let requirements: X402PaymentRequirements;
      try {
        requirements = parsePaymentRequirements(params.paymentRequirements, serverCluster);
      } catch (err: any) {
        const req = await txService.persistRequest({
          vaultId: params.vaultId, apiKeyId: params.apiKeyId,
          actionType: "x402_facilitator", idempotencyKey,
          requestJson: params, decision: "rejected",
          rejectionReason: `Invalid payment requirements: ${err.message}`,
        });
        return { requestId: req.id, status: "failed", error: err.message, paymentId: null, paymentSignatureHeader: null, partialTransactionBase64: null, tx1Signature: null };
      }

      // Facilitator mode requires an advertised fee payer (the facilitator's
      // pubkey). It goes into tx2's feePayer slot; the facilitator co-signs.
      // Reference 402: the field lives at `accepted.extra.feePayer`.
      const rawRequirements = params.paymentRequirements as Record<string, unknown> | null | undefined;
      const extra = (rawRequirements?.extra ?? {}) as Record<string, unknown>;
      const facilitatorFeePayerStr =
        (extra.feePayer as string | undefined) ?? (extra.fee_payer as string | undefined);
      if (!facilitatorFeePayerStr) {
        const req = await txService.persistRequest({
          vaultId: params.vaultId, apiKeyId: params.apiKeyId,
          actionType: "x402_facilitator", idempotencyKey,
          requestJson: params, decision: "rejected",
          rejectionReason: "missing_extra_feepayer",
        });
        return { requestId: req.id, status: "failed", error: "paymentRequirements.extra.feePayer is required for facilitator-mode x402", paymentId: null, paymentSignatureHeader: null, partialTransactionBase64: null, tx1Signature: null };
      }
      let facilitatorFeePayer: PublicKey;
      try {
        facilitatorFeePayer = new PublicKey(facilitatorFeePayerStr);
      } catch {
        const req = await txService.persistRequest({
          vaultId: params.vaultId, apiKeyId: params.apiKeyId,
          actionType: "x402_facilitator", idempotencyKey,
          requestJson: params, decision: "rejected",
          rejectionReason: "invalid_extra_feepayer",
        });
        return { requestId: req.id, status: "failed", error: "paymentRequirements.extra.feePayer is not a valid Solana pubkey", paymentId: null, paymentSignatureHeader: null, partialTransactionBase64: null, tx1Signature: null };
      }

      // 3. Dedup by paymentId (if provided).
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
            status: existingPayment.tx_status === "confirmed" ? "duplicate" : existingPayment.tx_status,
            error: "Payment already processed for this payment_id",
            paymentId: requirements.paymentId,
            paymentSignatureHeader: null,
            partialTransactionBase64: null,
            tx1Signature: existingPayment.tx_signature ?? null,
          };
        }
      }

      // 4. Load policy + offchain guards.
      const [policy] = await db`SELECT * FROM vault_policies WHERE vault_id = ${params.vaultId}`;
      if (!policy) {
        return { requestId: null, status: "failed", error: "Policy not found", paymentId: null, paymentSignatureHeader: null, partialTransactionBase64: null, tx1Signature: null };
      }
      if (policy.paused) {
        const req = await txService.persistRequest({
          vaultId: params.vaultId, apiKeyId: params.apiKeyId,
          actionType: "x402_facilitator", idempotencyKey,
          requestJson: params, decision: "rejected", rejectionReason: "vault_paused",
        });
        return { requestId: req.id, status: "failed", error: "Vault is paused", paymentId: null, paymentSignatureHeader: null, partialTransactionBase64: null, tx1Signature: null };
      }
      // bit 4 = x402
      if ((policy.allowed_actions & 4) === 0) {
        const req = await txService.persistRequest({
          vaultId: params.vaultId, apiKeyId: params.apiKeyId,
          actionType: "x402_facilitator", idempotencyKey,
          requestJson: params, decision: "rejected", rejectionReason: "action_not_allowed",
        });
        return { requestId: req.id, status: "failed", error: "x402 action not allowed", paymentId: null, paymentSignatureHeader: null, partialTransactionBase64: null, tx1Signature: null };
      }

      let domain = "";
      try {
        domain = new URL(params.originalRequestUrl).hostname;
      } catch {
        const req = await txService.persistRequest({
          vaultId: params.vaultId, apiKeyId: params.apiKeyId,
          actionType: "x402_facilitator", idempotencyKey,
          requestJson: params, decision: "rejected", rejectionReason: "invalid_original_url",
        });
        return { requestId: req.id, status: "failed", error: "Invalid originalRequestUrl", paymentId: null, paymentSignatureHeader: null, partialTransactionBase64: null, tx1Signature: null };
      }

      const validationError = validateRequirements(requirements, undefined, domain);
      if (validationError) {
        const req = await txService.persistRequest({
          vaultId: params.vaultId, apiKeyId: params.apiKeyId,
          actionType: "x402_facilitator", idempotencyKey,
          requestJson: params, decision: "rejected", rejectionReason: validationError,
        });
        return { requestId: req.id, status: "failed", error: validationError, paymentId: null, paymentSignatureHeader: null, partialTransactionBase64: null, tx1Signature: null };
      }

      // 5. Compute gross and enforce per-tx + daily limits against gross
      // (what actually leaves the user's vault).
      //
      // Accounting semantics, matched to on-chain execute_pay_exact:
      //   serviceFee = floor(gross * SERVICE_FEE_BPS / BPS_DENOMINATOR)  — routes to treasury
      //   netToRelayer = gross - serviceFee                               — lands in relayer ATA
      //   relayerDust = netToRelayer - agonAmount                         — leftover after tx2 pays facilitator
      // (relayerDust is 0 in the happy case; can be 1 atomic at fee-rounding edges.)
      const agonAmount = BigInt(requirements.amount);
      const grossAmount = computeGrossFromAgonAmount(agonAmount);
      const serviceFee = (grossAmount * SERVICE_FEE_BPS) / BPS_DENOMINATOR;
      const netToRelayer = grossAmount - serviceFee;
      const relayerDust = netToRelayer - agonAmount;

      const perTxLimit = BigInt(policy.max_per_tx_amount_atomic);
      if (perTxLimit > 0n && grossAmount > perTxLimit) {
        const req = await txService.persistRequest({
          vaultId: params.vaultId, apiKeyId: params.apiKeyId,
          actionType: "x402_facilitator", idempotencyKey,
          requestJson: params, decision: "rejected", rejectionReason: "exceeds_per_tx_limit",
          amountAtomic: grossAmount.toString(), mint: requirements.asset,
        });
        return { requestId: req.id, status: "failed", error: "Amount exceeds per-tx limit", paymentId: null, paymentSignatureHeader: null, partialTransactionBase64: null, tx1Signature: null };
      }

      const dailyLimit = BigInt(policy.daily_limit_amount_atomic);
      let reserved = false;
      if (dailyLimit > 0n) {
        const reservation = await txService.reserveUsage(params.vaultId, params.apiKeyId, grossAmount, dailyLimit);
        if (!reservation.allowed) {
          const req = await txService.persistRequest({
            vaultId: params.vaultId, apiKeyId: params.apiKeyId,
            actionType: "x402_facilitator", idempotencyKey,
            requestJson: params, decision: "rejected", rejectionReason: "exceeds_daily_limit",
            amountAtomic: grossAmount.toString(), mint: requirements.asset,
          });
          return { requestId: req.id, status: "failed", error: "Amount exceeds daily limit", paymentId: null, paymentSignatureHeader: null, partialTransactionBase64: null, tx1Signature: null };
        }
        reserved = true;
      }

      // 6. Persist request + reserve paymentId row.
      const req = await txService.persistRequest({
        vaultId: params.vaultId, apiKeyId: params.apiKeyId,
        actionType: "x402_facilitator", idempotencyKey,
        requestJson: {
          requirements,
          originalRequestUrl: params.originalRequestUrl,
          facilitatorFeePayer: facilitatorFeePayerStr,
          agonAmount: agonAmount.toString(),
          grossAmount: grossAmount.toString(),
          serviceFee: serviceFee.toString(),
        },
        decision: "approved",
        amountAtomic: grossAmount.toString(),
        mint: requirements.asset,
        txStatus: "created",
      });

      if (requirements.paymentId) {
        try {
          await db`
            INSERT INTO x402_payments (request_id, payment_id, domain, payment_requirements_json)
            VALUES (${req.id}, ${requirements.paymentId}, ${domain}, ${JSON.stringify(requirements)})
          `;
        } catch {
          if (reserved) await txService.releaseUsage(params.vaultId, params.apiKeyId, grossAmount);
          await txService.updateRequestTx(req.id, "", "failed");
          return {
            requestId: req.id,
            status: "duplicate",
            error: "Concurrent payment already processed for this paymentId",
            paymentId: requirements.paymentId,
            paymentSignatureHeader: null,
            partialTransactionBase64: null,
            tx1Signature: null,
          };
        }
      } else {
        await db`
          INSERT INTO x402_payments (request_id, payment_id, domain, payment_requirements_json)
          VALUES (${req.id}, NULL, ${domain}, ${JSON.stringify(requirements)})
        `;
      }

      // 7. Relayer must be configured — it's both authority on tx1 and
      // source/authority on tx2.
      if (!txService.feePayer) {
        if (reserved) await txService.releaseUsage(params.vaultId, params.apiKeyId, grossAmount);
        await txService.updateRequestTx(req.id, "", "failed");
        return { requestId: req.id, status: "failed", error: "Fee payer not configured", paymentId: requirements.paymentId || null, paymentSignatureHeader: null, partialTransactionBase64: null, tx1Signature: null };
      }

      // Declared outside the try/catch so the error handler can tell
      // "crashed before tx1 landed" from "crashed after tx1 landed" and
      // avoid clearing an authoritative settlement signature from the
      // request row (or releasing daily-limit reservation for funds
      // that already left the vault).
      let tx1Signature: string | null = null;

      try {
        const [vault] = await db`SELECT vault_pda, policy_pda, fee_vault_pda FROM vaults WHERE id = ${params.vaultId}`;
        const vaultPubkey = new PublicKey(vault.vault_pda);
        const policyPubkey = new PublicKey(vault.policy_pda);
        const mintPubkey = new PublicKey(requirements.asset);
        const vaultTokenAcct = getVaultTokenAccount(vaultPubkey, mintPubkey, TOKEN_PROGRAM_ID);

        // Fee vault PDA (cache-backed).
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

        // Pre-flight: fee vault SOL + vault USDC
        const feeVaultBalance = await txService.getFeeVaultBalance(feeVaultPubkey.toString());
        if (feeVaultBalance < FEE_VAULT_MIN_BALANCE) {
          if (reserved) await txService.releaseUsage(params.vaultId, params.apiKeyId, grossAmount);
          await txService.updateRequestTx(req.id, "", "failed");
          return {
            requestId: req.id,
            status: "failed",
            error: `Fee vault below minimum balance (${feeVaultBalance.toString()} < ${FEE_VAULT_MIN_BALANCE.toString()} lamports).`,
            paymentId: requirements.paymentId || null,
            paymentSignatureHeader: null,
            partialTransactionBase64: null,
            tx1Signature: null,
          };
        }
        const vaultUsdc = await txService.getTokenBalance(vaultTokenAcct);
        if (BigInt(vaultUsdc) < grossAmount) {
          if (reserved) await txService.releaseUsage(params.vaultId, params.apiKeyId, grossAmount);
          await txService.updateRequestTx(req.id, "", "failed");
          return {
            requestId: req.id,
            status: "failed",
            error: `Insufficient vault balance (have ${vaultUsdc}, need ${grossAmount.toString()} including 1.5% service fee)`,
            paymentId: requirements.paymentId || null,
            paymentSignatureHeader: null,
            partialTransactionBase64: null,
            tx1Signature: null,
          };
        }

        // ATAs: relayer's USDC ATA (tx1 destination + tx2 source),
        // treasury's USDC ATA (tx1 service-fee destination), facilitator's
        // payTo USDC ATA (tx2 destination).
        const relayerPubkey = txService.feePayer.publicKey;
        const relayerAta = getAssociatedTokenAddressSync(mintPubkey, relayerPubkey);
        const treasuryAta = getTreasuryTokenAccount(mintPubkey, TOKEN_PROGRAM_ID);
        const facilitatorPayToPubkey = new PublicKey(requirements.recipient);
        const facilitatorPayToAta = getAssociatedTokenAddressSync(mintPubkey, facilitatorPayToPubkey);

        // Pre-create any missing ATAs as pre-ixs on tx1 — all paid by the
        // relayer (so the facilitator never pays rent).
        //
        // Cost note: each ATA rent is ~0.00203 SOL, paid from the relayer's
        // own SOL balance. The FeeVault's FEE_REIMBURSEMENT_LAMPORTS (10_000)
        // only covers the tx fee, not ATA rent. So the first call that
        // targets a brand-new (facilitator, mint) pair eats ~0.002 SOL of
        // uncovered relayer SOL. Amortizes to zero across subsequent calls
        // against the same facilitator + mint. Acceptable for hackathon;
        // post-launch, consider rolling rent into `grossAmount` or having
        // the user's fee_vault top up the relayer's ATA-creation budget.
        const preIxs: TransactionInstruction[] = [];
        try {
          const [relayerAtaInfo, treasuryAtaInfo, facilitatorAtaInfo] = await Promise.all([
            txService.connection.getAccountInfo(relayerAta),
            txService.connection.getAccountInfo(treasuryAta),
            txService.connection.getAccountInfo(facilitatorPayToAta),
          ]);
          if (!relayerAtaInfo) {
            preIxs.push(
              createAssociatedTokenAccountIdempotentInstruction(
                relayerPubkey, relayerAta, relayerPubkey, mintPubkey, TOKEN_PROGRAM_ID,
              ),
            );
          }
          if (!treasuryAtaInfo) {
            preIxs.push(
              createAssociatedTokenAccountIdempotentInstruction(
                relayerPubkey, treasuryAta, TREASURY_PUBKEY, mintPubkey, TOKEN_PROGRAM_ID,
              ),
            );
          }
          if (!facilitatorAtaInfo) {
            preIxs.push(
              createAssociatedTokenAccountIdempotentInstruction(
                relayerPubkey, facilitatorPayToAta, facilitatorPayToPubkey, mintPubkey, TOKEN_PROGRAM_ID,
              ),
            );
          }
        } catch {
          // non-fatal; downstream ixs will surface AccountNotInitialized if any are missing
        }

        // ── tx1: vault → relayer via execute_pay_exact ────────────────
        const requestHash = createHash("sha256").update(idempotencyKey).digest();
        const payIx = buildExecutePayExactIx({
          authority: relayerPubkey,
          vault: vaultPubkey,
          policy: policyPubkey,
          feeVault: feeVaultPubkey,
          mint: mintPubkey,
          vaultTokenAccount: vaultTokenAcct,
          destinationTokenAccount: relayerAta, // NOTE: destination owner = relayer
          treasuryTokenAccount: treasuryAta,
          tokenProgramId: TOKEN_PROGRAM_ID,
          params: { amount: grossAmount, requestHash },
        });
        // Real mint decimals — transferChecked validates amount_decimals
        // against on-chain mint. Hardcoding 6 would fail for any non-USDC
        // mint. Fetch once before tx1 so we can fail fast without spending
        // vault USDC on a tx we can't complete.
        const mintInfo = await getMint(txService.connection, mintPubkey, "confirmed", TOKEN_PROGRAM_ID);
        const decimals = mintInfo.decimals;

        const tx1 = await buildTransaction([...preIxs, payIx], relayerPubkey, txService.connection);
        // Past this point tx1Sig is authoritative — the settlement has
        // landed on-chain. Error handler must preserve it (not clear).
        // Assign to both the outer `tx1Signature` (visible to catch) and a
        // local `tx1Sig` const — the const's narrower `string` type avoids
        // the TS null-widening across subsequent awaits.
        const tx1Sig = await txService.sendAndConfirm(tx1, [txService.feePayer]);
        tx1Signature = tx1Sig;

        // ── tx2: relayer → facilitator, agon-spec v0 tx ───────────────
        const limitIx = ComputeBudgetProgram.setComputeUnitLimit({
          units: FACILITATOR_COMPUTE_UNIT_LIMIT,
        });
        const priceIx = ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: FACILITATOR_COMPUTE_UNIT_PRICE_MICROLAMPORTS,
        });
        const transferIx = createTransferCheckedInstruction(
          relayerAta,
          mintPubkey,
          facilitatorPayToAta,
          relayerPubkey,
          agonAmount,
          decimals,
        );
        const memoData = Buffer.from(randomBytes(16).toString("hex"), "utf8");
        const memoIx = new TransactionInstruction({
          programId: MEMO_PROGRAM_ID,
          keys: [],
          data: memoData,
        });

        const { blockhash, lastValidBlockHeight } = await txService.connection.getLatestBlockhash("confirmed");
        const msg = new TransactionMessage({
          payerKey: facilitatorFeePayer,
          recentBlockhash: blockhash,
          instructions: [limitIx, priceIx, transferIx, memoIx],
        }).compileToV0Message();
        const vtx = new VersionedTransaction(msg);
        vtx.sign([txService.feePayer]); // partial-sign as authority; facilitator co-signs as feePayer

        const partialTransactionBase64 = Buffer.from(vtx.serialize()).toString("base64");

        // x402 v2 envelope for PAYMENT-SIGNATURE header — shape per
        // @x402/core/types PaymentPayload: uses `accepted` with the FULL
        // original requirements object the facilitator advertised (must
        // deep-equal one entry of the route's `accepts` array, including
        // `extra.feePayer`, `payTo`, etc). Using the adapter's normalized
        // shape here would rename payTo→recipient and drop extra, causing
        // the facilitator to reject with "No matching payment requirements".
        const envelope = {
          x402Version: 2,
          accepted: params.paymentRequirements,
          payload: { transaction: partialTransactionBase64 },
        };
        const paymentSignatureHeader = Buffer.from(JSON.stringify(envelope)).toString("base64");

        // Conservative client-side hint — lastValidBlockHeight is authoritative.
        const expiresAt = new Date(Date.now() + 60_000).toISOString();

        // 8. Persist tx1 sig + settlement metadata. Request stays
        // `awaiting_facilitator` until the facilitator submits tx2.
        await txService.updateRequestTx(req.id, tx1Sig, "awaiting_facilitator");
        await db`
          UPDATE x402_payments
          SET settlement_json = ${JSON.stringify({
            paymentId: requirements.paymentId ?? null,
            mode: "facilitator",
            tx1Signature: tx1Sig,
            grossAmount: grossAmount.toString(),
            agonAmount: agonAmount.toString(),
            serviceFee: serviceFee.toString(),
            netToRelayer: netToRelayer.toString(),
            relayerDust: relayerDust.toString(),
            asset: requirements.asset,
            network: requirements.network,
            facilitatorFeePayer: facilitatorFeePayerStr,
            envelopeBlockhash: blockhash,
            envelopeLastValidBlockHeight: lastValidBlockHeight,
          })}
          WHERE request_id = ${req.id}
        `;
        await txService.logActivity(params.vaultId, "x402_facilitator", {
          domain,
          agonAmount: agonAmount.toString(),
          grossAmount: grossAmount.toString(),
          serviceFee: serviceFee.toString(),
          netToRelayer: netToRelayer.toString(),
          relayerDust: relayerDust.toString(),
          asset: requirements.asset,
          recipient: requirements.recipient,
          paymentId: requirements.paymentId,
          originalUrl: params.originalRequestUrl,
          facilitatorFeePayer: facilitatorFeePayerStr,
          tx1Signature: tx1Sig,
        }, tx1Sig, req.id);

        return {
          requestId: req.id,
          status: "awaiting_facilitator" as const,
          paymentId: requirements.paymentId || null,
          paymentSignatureHeader,
          partialTransactionBase64,
          tx1Signature: tx1Sig,
          feePayer: facilitatorFeePayerStr,
          authority: relayerPubkey.toBase58(),
          blockhash,
          lastValidBlockHeight,
          expiresAt,
          grossAmount: grossAmount.toString(),
          agonAmount: agonAmount.toString(),
          serviceFee: serviceFee.toString(),
          netToRelayer: netToRelayer.toString(),
          relayerDust: relayerDust.toString(),
          error: null,
        };
      } catch (err: any) {
        const isTimeout = /timeout|expired|not confirmed/i.test(err?.message ?? "");
        // If tx1 already landed, funds have left the vault — we must
        // preserve tx1Signature, keep the daily-limit reservation, and
        // surface a distinct "tx1 confirmed but tx2 build failed" status
        // instead of wiping the record. Otherwise (crash before tx1), it
        // is safe to clear the signature and refund usage.
        const tx1Already = tx1Signature !== null;
        const finalStatus = tx1Already
          ? "tx1_confirmed_tx2_build_failed"
          : isTimeout
            ? "pending_confirmation"
            : "failed";
        await txService.updateRequestTx(
          req.id,
          tx1Already ? tx1Signature! : "",
          finalStatus,
        );
        if (!tx1Already && !isTimeout && reserved) {
          await txService.releaseUsage(params.vaultId, params.apiKeyId, grossAmount);
        }
        await txService.logActivity(params.vaultId, "x402_facilitator", {
          domain,
          agonAmount: agonAmount.toString(),
          grossAmount: grossAmount.toString(),
          asset: requirements.asset,
          recipient: requirements.recipient,
          paymentId: requirements.paymentId,
          facilitatorFeePayer: facilitatorFeePayerStr,
          tx1Signature,
          error: String(err?.message ?? err).slice(0, 400),
        }, tx1Signature ?? undefined, req.id);
        return {
          requestId: req.id,
          status: finalStatus,
          paymentId: requirements.paymentId || null,
          paymentSignatureHeader: null,
          partialTransactionBase64: null,
          tx1Signature,
          error: tx1Already
            ? `tx1 (vault → relayer) landed at ${tx1Signature} but tx2 build failed: ${String(err?.message ?? err).slice(0, 160)}. Funds reached the relayer; call again with a new idempotencyKey to resume, or withdraw dust from the relayer's ATA manually.`
            : isTimeout
              ? "Transaction 1 (vault → relayer) confirmation timed out; status uncertain"
              : `x402 facilitator settlement failed: ${String(err?.message ?? err).slice(0, 200)}`,
        };
      }
    },
  };
}
