import type { FastifyInstance } from "fastify";
import type { Db } from "../db/client.js";
import type { Config } from "../config.js";
import { createApiKeyAuth } from "../middleware/auth.js";
import { createTxService } from "../services/tx.service.js";
import { createSwapService } from "../services/swap.service.js";
import { createX402Service } from "../services/x402.service.js";
import { payRequestSchema, swapRequestSchema, x402RequestSchema } from "@lobsterpay/shared";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";

// Known SPL mints — used to decorate balances with human-readable symbols.
const KNOWN_MINTS: Record<string, string> = {
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": "USDC",
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU": "USDC",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB": "USDT",
  "So11111111111111111111111111111111111111112": "SOL",
};

async function fetchVaultBalances(connection: Connection, vaultPda: string) {
  try {
    const owner = new PublicKey(vaultPda);
    const resp = await connection.getParsedTokenAccountsByOwner(owner, {
      programId: TOKEN_PROGRAM_ID,
    });
    return resp.value
      .map((ta) => {
        const info = ta.account.data.parsed.info;
        const mint = info.mint as string;
        return {
          mint,
          symbol: KNOWN_MINTS[mint] ?? null,
          amount: info.tokenAmount.amount as string,
          uiAmount: info.tokenAmount.uiAmount as number,
          decimals: info.tokenAmount.decimals as number,
        };
      })
      .filter((b) => b.uiAmount > 0);
  } catch {
    return [];
  }
}
import { createHash, randomUUID } from "node:crypto";

/**
 * A prior request with this idempotency key was persisted as approved but
 * never produced a tx signature (the submit/sign step crashed or hung). If
 * the record is older than this many ms, we treat it as a "zombie" and
 * allow a fresh retry instead of echoing the stuck state back to the agent.
 */
const STUCK_CREATED_TTL_MS = 90_000;

function isStuckCreated(existing: { tx_status?: string | null; tx_signature?: string | null; created_at?: string | Date | null }): boolean {
  if (!existing) return false;
  if (existing.tx_status !== "created") return false;
  if (existing.tx_signature) return false; // real tx landed or was submitted
  if (!existing.created_at) return true;
  const createdAt = typeof existing.created_at === "string" ? Date.parse(existing.created_at) : existing.created_at.getTime();
  return Date.now() - createdAt > STUCK_CREATED_TTL_MS;
}

/**
 * Map Anchor custom error codes from `execute_pay_exact` (programs/lobsterpay/src/errors.rs)
 * to human-readable reasons. Anchor starts user errors at 6000 and increments
 * in declaration order.
 */
const PAY_ANCHOR_ERRORS: Record<number, string> = {
  // Anchor framework errors (2000-4100 range) — the subset that can surface from our ix.
  // Source: https://github.com/coral-xyz/anchor/blob/master/lang/src/error.rs
  2000: "constraint_mut",
  2001: "constraint_has_one",
  2002: "constraint_signer",
  2003: "constraint_raw",
  2004: "constraint_owner",
  2005: "constraint_rent_exempt",
  2006: "constraint_seeds",
  2007: "constraint_executable",
  2008: "constraint_state",
  2009: "constraint_associated",
  2010: "constraint_associated_init",
  2011: "constraint_close",
  2012: "constraint_address",
  2013: "constraint_zero",
  2014: "constraint_token_mint",
  2015: "constraint_token_owner",
  2016: "constraint_mint_mint_authority",
  2017: "constraint_mint_freeze_authority",
  2018: "constraint_mint_decimals",
  2019: "constraint_space",
  3002: "account_discriminator_mismatch",
  3004: "account_not_system_owned",
  3007: "account_owned_by_wrong_program",
  3012: "account_not_initialized",
  3013: "account_owned_by_wrong_program",
  3014: "invalid_program_id",
  // LobsterPay user errors (errors.rs — Anchor starts these at 6000).
  6000: "unauthorized",
  6001: "vault_paused",
  6002: "action_not_allowed",
  6003: "mint_not_in_allowlist",
  6004: "destination_not_in_allowlist",
  6005: "program_not_in_allowlist",
  6006: "amount_exceeds_per_tx_limit",
  6007: "amount_exceeds_daily_limit",
  6008: "invalid_amount",
  6009: "invalid_route",
  6010: "invalid_slippage",
  6011: "invalid_token_program",
  6012: "arithmetic_overflow",
  6013: "stale_window_state",
  6014: "unsupported_feature",
  6015: "mint_allowlist_full",
  6016: "destination_allowlist_full",
  6017: "external_program_allowlist_full",
  6018: "duplicate_allowlist_entry",
  6019: "fee_vault_insufficient_sol",
  6020: "invalid_treasury",
  6021: "invalid_fee_treasury_mint",
  6022: "duplicate_account_aliasing",
};

/**
 * Extract a human-readable reason from a sendAndConfirmTransaction rejection.
 * Checks `logs` for "Error Code: Name. Error Number: N" or "custom program error: 0xN",
 * falling back to the raw message.
 */
function diagnoseTxError(err: any): { reason: string; anchorCode?: number; logs?: string[]; raw: string } {
  const raw = err?.message || String(err);
  const logs: string[] | undefined = err?.logs || err?.transactionLogs;

  // Anchor emits "Error Code: FooBar. Error Number: 6004" in tx logs.
  if (Array.isArray(logs)) {
    for (const line of logs) {
      const anchorMatch = /Error Number:\s*(\d+)/.exec(line);
      if (anchorMatch) {
        const code = Number(anchorMatch[1]);
        const label = PAY_ANCHOR_ERRORS[code];
        return { reason: label ?? `anchor_error_${code}`, anchorCode: code, logs, raw };
      }
    }
  }

  // Fallback: "custom program error: 0x1774"
  const hexMatch = /custom program error:\s*0x([0-9a-fA-F]+)/.exec(raw);
  if (hexMatch) {
    const code = parseInt(hexMatch[1], 16);
    const label = PAY_ANCHOR_ERRORS[code];
    return { reason: label ?? `anchor_error_${code}`, anchorCode: code, logs, raw };
  }

  if (/timeout|expired|not confirmed/i.test(raw)) {
    return { reason: "timeout", logs, raw };
  }

  return { reason: raw.slice(0, 180), logs, raw };
}
import {
  buildExecutePayExactIx,
  buildEnsureVaultTokenAccountIx,
  buildTransaction,
  deriveVaultPda,
  derivePolicyPda,
  deriveFeeVaultPda,
  getVaultTokenAccount,
  getTreasuryTokenAccount,
  SERVICE_FEE_BPS,
  FEE_VAULT_MIN_BALANCE,
} from "../solana/instructions.js";

export function agentRoutes(app: FastifyInstance, db: Db, config: Config) {
  const auth = createApiKeyAuth(db);
  const txService = createTxService(db, config);
  const swapService = createSwapService(db, config);
  const x402Service = createX402Service(db, config);
  const connection = new Connection(config.SOLANA_RPC_URL, "confirmed");

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

    const balances = await fetchVaultBalances(connection, policy.vault_pda);

    return {
      vaultPda: policy.vault_pda,
      balances,
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

    const { mint, amountAtomic, destinationOwner, destinationTokenAccount, memo } = parsed.data;
    // Auto-generate an idempotency key if the agent didn't supply one. Makes
    // the field truly optional from the caller's perspective while still
    // giving us a per-request identifier for dedup + logging.
    const idempotencyKey = parsed.data.idempotencyKey ?? `auto-${randomUUID()}`;

    // 1. Idempotency check — return the cached result unless the prior record
    // is a "zombie" (approved + persisted but no tx signature after 90s),
    // in which case let the retry through instead of silently echoing a
    // stuck status.
    const existing = await txService.checkIdempotency(vaultId, idempotencyKey);
    if (existing && !isStuckCreated(existing)) {
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

    // 6. Atomic daily limit check-and-reserve
    const effectiveDaily = BigInt(apiKey.daily_limit_override ?? policy.daily_limit_amount_atomic);
    if (effectiveDaily > 0n) {
      const reservation = await txService.reserveUsage(vaultId, apiKey.id, amount, effectiveDaily);
      if (!reservation.allowed) {
        const req = await txService.persistRequest({
          vaultId, apiKeyId: apiKey.id, actionType: "pay_exact", idempotencyKey,
          requestJson: parsed.data, decision: "rejected", rejectionReason: "exceeds_daily_limit",
          amountAtomic: amountAtomic, mint,
        });
        return reply.status(403).send({ requestId: req.id, txSignature: null, status: "failed", error: "Amount exceeds daily limit" });
      }
    }

    // Compute the 1.5% service fee offchain (mirrors the on-chain calc).
    // Gross = amount. Net = gross - fee. Fee = gross * 150 / 10000.
    const grossAmount = amount;
    const serviceFee = (grossAmount * SERVICE_FEE_BPS) / 10000n;
    const netAmount = grossAmount - serviceFee;

    // 7. Persist as approved
    const req = await txService.persistRequest({
      vaultId, apiKeyId: apiKey.id, actionType: "pay_exact", idempotencyKey,
      requestJson: { ...parsed.data, grossAmount: grossAmount.toString(), netAmount: netAmount.toString(), serviceFee: serviceFee.toString() },
      decision: "approved",
      amountAtomic: amountAtomic, mint, txStatus: "created",
    });

    // 8. Build + submit onchain transaction
    if (!txService.feePayer) {
      return reply.status(500).send({ code: "config_error", message: "Fee payer not configured" });
    }

    try {
      // Derive accounts
      const [vault] = await db`SELECT vault_pda, policy_pda, fee_vault_pda FROM vaults WHERE id = ${vaultId}`;
      const vaultPubkey = new PublicKey(vault.vault_pda);
      const policyPubkey = new PublicKey(vault.policy_pda);
      const mintPubkey = new PublicKey(mint);
      const vaultTokenAcct = getVaultTokenAccount(vaultPubkey, mintPubkey, TOKEN_PROGRAM_ID);

      // Resolve the fee vault PDA. Prefer the cached value; derive it from
      // the owner wallet if missing (pre-migration vaults).
      let feeVaultPubkey: PublicKey;
      if (vault.fee_vault_pda) {
        feeVaultPubkey = new PublicKey(vault.fee_vault_pda);
      } else {
        const [ownerRow] = await db`
          SELECT o.wallet_address FROM vaults v
          JOIN owners o ON o.id = v.owner_id
          WHERE v.id = ${vaultId}
        `;
        if (!ownerRow) {
          throw new Error("Vault owner not found");
        }
        const ownerPubkey = new PublicKey(ownerRow.wallet_address);
        [feeVaultPubkey] = deriveFeeVaultPda(ownerPubkey, txService.programId);
        await db`UPDATE vaults SET fee_vault_pda = ${feeVaultPubkey.toString()} WHERE id = ${vaultId}`;
      }

      // Pre-flight: fee vault must have enough SOL to fund agent-signed txs.
      const feeVaultBalance = await txService.getFeeVaultBalance(feeVaultPubkey.toString());
      if (feeVaultBalance < FEE_VAULT_MIN_BALANCE) {
        if (effectiveDaily > 0n) {
          await txService.releaseUsage(vaultId, apiKey.id, amount);
        }
        const feeReq = await txService.persistRequest({
          vaultId, apiKeyId: apiKey.id, actionType: "pay_exact", idempotencyKey,
          requestJson: parsed.data, decision: "rejected",
          rejectionReason: "insufficient_fee_vault_balance",
          amountAtomic, mint,
        });
        return reply.status(403).send({
          requestId: feeReq.id,
          txSignature: null,
          status: "failed",
          error: `Fee vault below minimum balance (${feeVaultBalance.toString()} < ${FEE_VAULT_MIN_BALANCE.toString()} lamports). Owner must deposit more SOL.`,
        });
      }

      // Fee payer drain protection: check vault balance before submitting
      const vaultBalance = await txService.getTokenBalance(vaultTokenAcct);
      if (BigInt(vaultBalance) < grossAmount) {
        // Release the daily limit reservation if we made one
        if (effectiveDaily > 0n) {
          await txService.releaseUsage(vaultId, apiKey.id, amount);
        }
        const balReq = await txService.persistRequest({
          vaultId, apiKeyId: apiKey.id, actionType: "pay_exact", idempotencyKey,
          requestJson: parsed.data, decision: "rejected", rejectionReason: "insufficient_vault_balance",
          amountAtomic, mint,
        });
        return reply.status(403).send({ requestId: balReq.id, txSignature: null, status: "failed", error: "Insufficient vault balance" });
      }

      // Resolve destination token account
      let destTokenAcct: PublicKey;
      let derivedDestOwner: PublicKey | null = null;
      if (destinationTokenAccount) {
        destTokenAcct = new PublicKey(destinationTokenAccount);
      } else if (destinationOwner) {
        derivedDestOwner = new PublicKey(destinationOwner);
        destTokenAcct = getAssociatedTokenAddressSync(mintPubkey, derivedDestOwner);
      } else {
        return reply.status(400).send({ code: "invalid_request", message: "destinationOwner or destinationTokenAccount required" });
      }

      // Treasury ATA for the service fee.
      const treasuryTokenAcct = getTreasuryTokenAccount(mintPubkey, TOKEN_PROGRAM_ID);

      // Pre-create destination + treasury ATAs when missing. execute_pay_exact
      // does a transfer_checked CPI that anchor rejects with error 3012
      // (AccountNotInitialized) if either account has never been touched.
      // createAssociatedTokenAccountIdempotentInstruction is a no-op when the
      // account already exists, so it's always safe to prepend.
      const preIxs = [];
      try {
        // Treasury ATA — the treasury pubkey is fixed in program constants,
        // its ATA for arbitrary mints may not exist on devnet yet.
        const treasuryAcctInfo = await txService.connection.getAccountInfo(treasuryTokenAcct);
        if (!treasuryAcctInfo) {
          const { TREASURY_PUBKEY } = await import("../solana/instructions.js");
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
        // Destination ATA — only pre-create if we derived it from a wallet
        // owner. If the caller supplied a raw destinationTokenAccount, trust
        // them (might be a non-ATA token account).
        if (derivedDestOwner) {
          const destAcctInfo = await txService.connection.getAccountInfo(destTokenAcct);
          if (!destAcctInfo) {
            preIxs.push(
              createAssociatedTokenAccountIdempotentInstruction(
                txService.feePayer.publicKey,
                destTokenAcct,
                derivedDestOwner,
                mintPubkey,
                TOKEN_PROGRAM_ID,
              ),
            );
          }
        }
      } catch (preErr) {
        app.log.warn({ err: preErr }, "ATA pre-flight check failed, continuing without pre-create");
      }

      // Build request hash from idempotency key
      const requestHash = createHash("sha256").update(idempotencyKey).digest();

      // Build execute_pay_exact instruction
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

      // Build and send transaction (ATA creates, if any, run before the pay ix)
      const tx = await buildTransaction([...preIxs, payIx], txService.feePayer.publicKey, txService.connection);
      const signature = await txService.sendAndConfirm(tx, [txService.feePayer]);

      // Update request with signature — usage was already reserved atomically
      await txService.updateRequestTx(req.id, signature, "confirmed");
      await txService.logActivity(vaultId, "payment", {
        requestId: req.id, mint,
        amountAtomic,
        grossAmount: grossAmount.toString(),
        netAmount: netAmount.toString(),
        serviceFee: serviceFee.toString(),
        destination: destinationOwner || destinationTokenAccount, memo,
      }, signature, req.id);

      return {
        requestId: req.id,
        txSignature: signature,
        status: "confirmed",
        grossAmount: grossAmount.toString(),
        netAmount: netAmount.toString(),
        serviceFee: serviceFee.toString(),
        error: null,
      };
    } catch (err: any) {
      const diag = diagnoseTxError(err);
      const isTimeout = diag.reason === "timeout";
      const status = isTimeout ? "pending_confirmation" : "failed";
      await txService.updateRequestTx(req.id, "", status);

      // Release usage reservation on definitive failure
      if (!isTimeout && effectiveDaily > 0n) {
        await txService.releaseUsage(vaultId, apiKey.id, amount);
      }

      app.log.error(
        { err, requestId: req.id, vaultId, reason: diag.reason, anchorCode: diag.anchorCode, logs: diag.logs },
        "Pay transaction failed",
      );
      // Use a distinct activity type so failed attempts don't masquerade as
      // successful payments in the owner's activity feed.
      await txService.logActivity(vaultId, "payment_failed", {
        requestId: req.id, mint, amountAtomic,
        reason: diag.reason,
        anchorCode: diag.anchorCode,
        error: diag.raw,
      }, undefined, req.id);

      return reply.status(500).send({
        requestId: req.id,
        txSignature: null,
        status,
        reason: diag.reason,
        anchorCode: diag.anchorCode,
        error: isTimeout
          ? "Transaction confirmation timed out, status uncertain"
          : `Transaction failed: ${diag.reason}`,
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
      app.log.error({ err, vaultId }, "Swap quote failed");
      return reply.status(502).send({ code: "swap_quote_error", message: "Failed to fetch swap quote" });
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

    const { fromMint, toMint, amountAtomic, maxSlippageBps } = parsed.data;
    const idempotencyKey = parsed.data.idempotencyKey ?? `auto-${randomUUID()}`;

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
        apiKeyRecord: apiKey,
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
      app.log.error({ err, vaultId }, "Swap execution failed");
      return reply.status(500).send({ code: "swap_error", message: "Swap execution failed" });
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

    const { paymentRequirements, originalRequestUrl } = parsed.data;
    const idempotencyKey = parsed.data.idempotencyKey ?? `auto-${randomUUID()}`;

    const [vault] = await db`SELECT vault_pda FROM vaults WHERE id = ${vaultId}`;

    const result = await x402Service.processX402Payment({
      paymentRequirements,
      originalRequestUrl,
      idempotencyKey,
      vaultId,
      apiKeyId: apiKey.id,
      vaultPda: vault.vault_pda,
    });

    // Status mapping:
    //  confirmed              → 200 (on-chain tx landed, agent has xPaymentHeader)
    //  pending_confirmation   → 202 (tx submitted, confirmation timed out)
    //  duplicate              → 409 (payment_id or concurrent retry)
    //  failed (policy reject) → 403 (paused, over-limit, action disallowed)
    //  failed (tx / infra)    → 500
    if (result.status === "confirmed") return reply.status(200).send(result);
    if (result.status === "pending_confirmation") return reply.status(202).send(result);
    if (result.status === "duplicate") return reply.status(409).send(result);

    // Treat a failure as a policy rejection if the reason is one of our
    // known offchain-rejection slugs; otherwise it's an on-chain / infra
    // error and should surface as 500.
    const rejectionSlugs = [
      "Vault is paused",
      "x402 action not allowed",
      "Amount exceeds per-tx limit",
      "Amount exceeds daily limit",
      "Insufficient vault balance",
      "Fee payer not configured",
      "Invalid originalRequestUrl",
    ];
    const err = String(result.error ?? "");
    const isPolicyReject = rejectionSlugs.some((slug) => err.startsWith(slug)) ||
      err.startsWith("Invalid payment requirements") ||
      err.startsWith("Fee vault below minimum balance");
    return reply.status(isPolicyReject ? 403 : 500).send(result);
  });
}
