import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  Keypair,
  sendAndConfirmTransaction,
  type Commitment,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import bs58 from "bs58";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";

export function createTxService(db: Db, config: Config) {
  const connection = new Connection(config.SOLANA_RPC_URL, {
    commitment: "confirmed" as Commitment,
    confirmTransactionInitialTimeout: 60_000,
  });

  const programId = new PublicKey(config.LOBSTERPAY_PROGRAM_ID);

  // Fee payer keypair — loaded from env
  let feePayer: Keypair | null = null;
  if (config.FEE_PAYER_SECRET_KEY) {
    try {
      const decoded = bs58.decode(config.FEE_PAYER_SECRET_KEY);
      feePayer = Keypair.fromSecretKey(decoded);
    } catch {
      console.warn("Invalid FEE_PAYER_SECRET_KEY, some operations will require client signing");
    }
  }

  return {
    connection,
    programId,
    feePayer,

    getAssociatedTokenAddress(owner: PublicKey, mint: PublicKey): PublicKey {
      return getAssociatedTokenAddressSync(mint, owner, true); // allowOwnerOffCurve for PDAs
    },

    async getTokenBalance(tokenAccount: PublicKey): Promise<string> {
      try {
        const info = await connection.getTokenAccountBalance(tokenAccount);
        return info.value.amount;
      } catch {
        return "0";
      }
    },

    async simulateTransaction(tx: Transaction): Promise<{ success: boolean; unitsConsumed?: number; error?: string }> {
      try {
        const result = await connection.simulateTransaction(tx);
        if (result.value.err) {
          return { success: false, error: JSON.stringify(result.value.err) };
        }
        return { success: true, unitsConsumed: result.value.unitsConsumed || undefined };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },

    async sendAndConfirm(tx: Transaction, signers: Keypair[]): Promise<string> {
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      tx.lastValidBlockHeight = lastValidBlockHeight;

      const signature = await sendAndConfirmTransaction(connection, tx, signers, {
        commitment: "confirmed",
        maxRetries: 3,
      });
      return signature;
    },

    async persistRequest(params: {
      vaultId: string;
      apiKeyId: string;
      actionType: string;
      idempotencyKey: string;
      requestJson: any;
      decision: "approved" | "rejected";
      rejectionReason?: string;
      txSignature?: string;
      txStatus?: string;
      amountAtomic?: string;
      mint?: string;
    }) {
      // Try insert, handle conflict gracefully (idempotency race)
      const rows = await db`
        INSERT INTO requests (vault_id, api_key_id, action_type, idempotency_key, request_json, decision, rejection_reason, tx_signature, tx_status, amount_atomic, mint)
        VALUES (
          ${params.vaultId}, ${params.apiKeyId}, ${params.actionType},
          ${params.idempotencyKey}, ${JSON.stringify(params.requestJson)},
          ${params.decision}, ${params.rejectionReason || null},
          ${params.txSignature || null}, ${params.txStatus || 'created'},
          ${params.amountAtomic ? params.amountAtomic : null},
          ${params.mint || null}
        )
        ON CONFLICT (vault_id, idempotency_key) DO NOTHING
        RETURNING *
      `;
      if (rows.length > 0) return rows[0];

      // Conflict — return existing row
      const [existing] = await db`SELECT * FROM requests WHERE vault_id = ${params.vaultId} AND idempotency_key = ${params.idempotencyKey}`;
      return existing;
    },

    async updateRequestTx(requestId: string, txSignature: string, txStatus: string) {
      await db`
        UPDATE requests SET tx_signature = ${txSignature}, tx_status = ${txStatus}, updated_at = NOW()
        WHERE id = ${requestId}
      `;
    },

    async checkIdempotency(vaultId: string, idempotencyKey: string) {
      const rows = await db`
        SELECT * FROM requests WHERE vault_id = ${vaultId} AND idempotency_key = ${idempotencyKey}
      `;
      return rows[0] || null;
    },

    async trackUsage(vaultId: string, apiKeyId: string, amountAtomic: bigint) {
      const windowStart = new Date();
      windowStart.setUTCHours(0, 0, 0, 0);

      // Upsert usage window
      const amountStr = amountAtomic.toString();
      await db`
        INSERT INTO usage_windows (vault_id, api_key_id, window_start, amount_spent_atomic, request_count)
        VALUES (${vaultId}, ${apiKeyId}, ${windowStart}, ${amountStr}, 1)
        ON CONFLICT (vault_id, api_key_id, window_start)
        DO UPDATE SET
          amount_spent_atomic = usage_windows.amount_spent_atomic + ${amountStr},
          request_count = usage_windows.request_count + 1,
          updated_at = NOW()
      `;
    },

    async reserveUsage(vaultId: string, apiKeyId: string, amountAtomic: bigint, dailyLimit: bigint): Promise<{ allowed: boolean; newTotal: bigint }> {
      const windowStart = new Date();
      windowStart.setUTCHours(0, 0, 0, 0);

      const amountStr = amountAtomic.toString();

      // Atomic: upsert the window and check limit in one statement
      const rows = await db`
        WITH upserted AS (
          INSERT INTO usage_windows (vault_id, api_key_id, window_start, amount_spent_atomic, request_count)
          VALUES (${vaultId}, ${apiKeyId}, ${windowStart}, ${amountStr}, 1)
          ON CONFLICT (vault_id, api_key_id, window_start)
          DO UPDATE SET
            amount_spent_atomic = usage_windows.amount_spent_atomic + ${amountStr},
            request_count = usage_windows.request_count + 1,
            updated_at = NOW()
          RETURNING amount_spent_atomic
        )
        SELECT amount_spent_atomic FROM upserted
      `;

      const newTotal = BigInt(rows[0].amount_spent_atomic);

      // If over limit, roll back by subtracting
      if (dailyLimit > 0n && newTotal > dailyLimit) {
        await db`
          UPDATE usage_windows
          SET amount_spent_atomic = amount_spent_atomic - ${amountStr},
              request_count = request_count - 1,
              updated_at = NOW()
          WHERE vault_id = ${vaultId} AND api_key_id = ${apiKeyId} AND window_start = ${windowStart}
        `;
        return { allowed: false, newTotal };
      }

      return { allowed: true, newTotal };
    },

    async releaseUsage(vaultId: string, apiKeyId: string, amountAtomic: bigint) {
      const windowStart = new Date();
      windowStart.setUTCHours(0, 0, 0, 0);

      const amountStr = amountAtomic.toString();
      await db`
        UPDATE usage_windows
        SET amount_spent_atomic = GREATEST(amount_spent_atomic - ${amountStr}, 0),
            request_count = GREATEST(request_count - 1, 0),
            updated_at = NOW()
        WHERE vault_id = ${vaultId} AND api_key_id = ${apiKeyId} AND window_start = ${windowStart}
      `;
    },

    async getDailyUsage(vaultId: string, apiKeyId?: string): Promise<bigint> {
      const windowStart = new Date();
      windowStart.setUTCHours(0, 0, 0, 0);

      const rows = apiKeyId
        ? await db`SELECT COALESCE(SUM(amount_spent_atomic), 0) as total FROM usage_windows WHERE vault_id = ${vaultId} AND api_key_id = ${apiKeyId} AND window_start = ${windowStart}`
        : await db`SELECT COALESCE(SUM(amount_spent_atomic), 0) as total FROM usage_windows WHERE vault_id = ${vaultId} AND window_start = ${windowStart}`;

      return BigInt(rows[0].total);
    },

    async logActivity(vaultId: string, type: string, payload: any, txSignature?: string, requestId?: string) {
      await db`
        INSERT INTO activities (vault_id, type, tx_signature, reference_request_id, payload_json)
        VALUES (${vaultId}, ${type}, ${txSignature || null}, ${requestId || null}, ${JSON.stringify(payload)})
      `;
    },
  };
}
