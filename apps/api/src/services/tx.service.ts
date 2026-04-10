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
      const [request] = await db`
        INSERT INTO requests (vault_id, api_key_id, action_type, idempotency_key, request_json, decision, rejection_reason, tx_signature, tx_status, amount_atomic, mint)
        VALUES (
          ${params.vaultId}, ${params.apiKeyId}, ${params.actionType},
          ${params.idempotencyKey}, ${JSON.stringify(params.requestJson)},
          ${params.decision}, ${params.rejectionReason || null},
          ${params.txSignature || null}, ${params.txStatus || 'created'},
          ${params.amountAtomic ? BigInt(params.amountAtomic) : null},
          ${params.mint || null}
        )
        RETURNING *
      `;
      return request;
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
      await db`
        INSERT INTO usage_windows (vault_id, api_key_id, window_start, amount_spent_atomic, request_count)
        VALUES (${vaultId}, ${apiKeyId}, ${windowStart}, ${amountAtomic}, 1)
        ON CONFLICT (vault_id, api_key_id, window_start)
        DO UPDATE SET
          amount_spent_atomic = usage_windows.amount_spent_atomic + ${amountAtomic},
          request_count = usage_windows.request_count + 1,
          updated_at = NOW()
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
