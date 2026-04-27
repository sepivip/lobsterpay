import { PublicKey, SystemProgram } from "@solana/web3.js";
import type { Db } from "../db/client.js";
import type { Config } from "../config.js";

const VAULT_SEED = Buffer.from("vault");
const POLICY_SEED = Buffer.from("policy");
const FEE_VAULT_SEED = Buffer.from("fee_vault");

export function deriveVaultPda(ownerPubkey: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, ownerPubkey.toBuffer()],
    programId
  );
}

export function derivePolicyPda(vaultPubkey: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [POLICY_SEED, vaultPubkey.toBuffer()],
    programId
  );
}

export function deriveFeeVaultPda(ownerPubkey: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [FEE_VAULT_SEED, ownerPubkey.toBuffer()],
    programId
  );
}

export function createVaultService(db: Db, config: Config) {
  const programId = new PublicKey(config.LOBSTERPAY_PROGRAM_ID);

  return {
    /**
     * Derives the FeeVault PDA address as a base58 string for a wallet.
     */
    deriveFeeVaultPda(walletAddress: string): string {
      const ownerPubkey = new PublicKey(walletAddress);
      const [pda] = deriveFeeVaultPda(ownerPubkey, programId);
      return pda.toString();
    },

    async getOrCreateOwner(walletAddress: string) {
      const existing = await db`SELECT * FROM owners WHERE wallet_address = ${walletAddress}`;
      if (existing.length > 0) return existing[0];
      const [created] = await db`INSERT INTO owners (wallet_address) VALUES (${walletAddress}) RETURNING *`;
      return created;
    },

    async createVault(walletAddress: string) {
      const owner = await this.getOrCreateOwner(walletAddress);
      const ownerPubkey = new PublicKey(walletAddress);

      const [vaultPda] = deriveVaultPda(ownerPubkey, programId);
      const [policyPda] = derivePolicyPda(vaultPda, programId);
      const [feeVaultPda] = deriveFeeVaultPda(ownerPubkey, programId);

      // Check if vault already exists in DB
      const existingVault = await db`SELECT * FROM vaults WHERE owner_id = ${owner.id} AND cluster = ${config.SOLANA_CLUSTER}`;
      if (existingVault.length > 0) {
        // Backfill fee_vault_pda if missing (for vaults created before migration 009).
        if (!existingVault[0].fee_vault_pda) {
          await db`UPDATE vaults SET fee_vault_pda = ${feeVaultPda.toString()} WHERE id = ${existingVault[0].id}`;
          existingVault[0].fee_vault_pda = feeVaultPda.toString();
        }
        return { vault: existingVault[0], isNew: false };
      }

      // Create vault record
      const [vault] = await db`
        INSERT INTO vaults (owner_id, cluster, program_id, vault_pda, policy_pda, fee_vault_pda, status)
        VALUES (${owner.id}, ${config.SOLANA_CLUSTER}, ${programId.toString()}, ${vaultPda.toString()}, ${policyPda.toString()}, ${feeVaultPda.toString()}, 'active')
        RETURNING *
      `;

      // Create policy record
      await db`
        INSERT INTO vault_policies (vault_id, paused, allowed_actions, max_per_tx_amount_atomic, daily_limit_amount_atomic, max_slippage_bps)
        VALUES (${vault.id}, false, 7, 0, 0, 100)
      `;

      // Log activity
      await db`
        INSERT INTO activities (vault_id, type, payload_json)
        VALUES (${vault.id}, 'vault_created', ${JSON.stringify({ vaultPda: vaultPda.toString(), policyPda: policyPda.toString(), feeVaultPda: feeVaultPda.toString() })})
      `;

      return {
        vault,
        isNew: true,
        instructions: {
          programId: programId.toString(),
          vaultPda: vaultPda.toString(),
          policyPda: policyPda.toString(),
          feeVaultPda: feeVaultPda.toString(),
        },
      };
    },

    async getVault(vaultId: string) {
      const rows = await db`
        SELECT v.*, vp.paused, vp.allowed_actions, vp.max_per_tx_amount_atomic,
               vp.daily_limit_amount_atomic, vp.max_slippage_bps, vp.config_json,
               vp.authorized_agent, o.wallet_address
        FROM vaults v
        JOIN vault_policies vp ON vp.vault_id = v.id
        JOIN owners o ON o.id = v.owner_id
        WHERE v.id = ${vaultId}
      `;
      return rows[0] || null;
    },

    async getVaultByOwner(walletAddress: string) {
      const rows = await db`
        SELECT v.*, vp.paused, vp.allowed_actions, vp.max_per_tx_amount_atomic,
               vp.daily_limit_amount_atomic, vp.max_slippage_bps, vp.config_json,
               vp.authorized_agent, o.wallet_address
        FROM vaults v
        JOIN vault_policies vp ON vp.vault_id = v.id
        JOIN owners o ON o.id = v.owner_id
        WHERE o.wallet_address = ${walletAddress}
        LIMIT 1
      `;
      const row = rows[0];
      if (!row) return null;

      // Aggregate today's spend across every API key for this vault. Mirrors
      // the window-start logic the agent tx service uses so owner-facing
      // totals match what policy enforcement sees.
      const windowStart = new Date();
      windowStart.setUTCHours(0, 0, 0, 0);
      const usageRows = await db`
        SELECT COALESCE(SUM(amount_spent_atomic), 0) AS total
        FROM usage_windows
        WHERE vault_id = ${row.id} AND window_start = ${windowStart}
      `;
      const dailySpentAtomic = BigInt((usageRows[0]?.total ?? 0).toString());
      const maxPerTxAtomic = BigInt((row.max_per_tx_amount_atomic ?? 0).toString());
      const dailyLimitAtomic = BigInt((row.daily_limit_amount_atomic ?? 0).toString());

      // Decoded allowedActions bitmask - 1 swap, 2 pay, 4 x402.
      const actions = Number(row.allowed_actions ?? 0);

      // USDC-denominated convenience values for the dashboard + policy page.
      // Safe because USDC is the only spend mint the UI currently surfaces;
      // atomic values stay on the payload too for anything multi-mint.
      const toUsdc = (atomic: bigint) => Number(atomic) / 1_000_000;

      return {
        ...row,
        policy: {
          paused: row.paused,
          allowedActions: actions,
          allowSwap: (actions & 1) !== 0,
          allowPay: (actions & 2) !== 0,
          allowX402: (actions & 4) !== 0,
          maxPerTxAmountAtomic: maxPerTxAtomic.toString(),
          dailyLimitAmountAtomic: dailyLimitAtomic.toString(),
          maxSlippageBps: Number(row.max_slippage_bps ?? 0),
          authorizedAgent: row.authorized_agent ?? null,
          // USDC decimals (6 decimals). Rounded to 2 places so the dashboard
          // shows "5.00 / 10.00 USDC" rather than "4.999999".
          maxPerTxUsdc: Number(toUsdc(maxPerTxAtomic).toFixed(2)),
          dailyLimitUsdc: Number(toUsdc(dailyLimitAtomic).toFixed(2)),
          dailySpentAmountAtomic: dailySpentAtomic.toString(),
          dailySpent: Number(toUsdc(dailySpentAtomic).toFixed(2)),
        },
      };
    },

    async updatePolicy(vaultId: string, updates: Record<string, any>) {
      const setClauses: any = { updated_at: new Date() };
      if (updates.paused !== undefined) setClauses.paused = updates.paused;
      if (updates.allowedActions !== undefined) setClauses.allowed_actions = updates.allowedActions;
      if (updates.maxPerTxAmountAtomic !== undefined) setClauses.max_per_tx_amount_atomic = updates.maxPerTxAmountAtomic;
      if (updates.dailyLimitAmountAtomic !== undefined) setClauses.daily_limit_amount_atomic = updates.dailyLimitAmountAtomic;
      if (updates.maxSlippageBps !== undefined) setClauses.max_slippage_bps = updates.maxSlippageBps;
      if (updates.authorizedAgent !== undefined) setClauses.authorized_agent = updates.authorizedAgent;
      if (updates.configJson !== undefined) setClauses.config_json = JSON.stringify(updates.configJson);

      await db`UPDATE vault_policies SET ${db(setClauses)} WHERE vault_id = ${vaultId}`;

      // Log activity
      await db`
        INSERT INTO activities (vault_id, type, payload_json)
        VALUES (${vaultId}, 'policy_update', ${JSON.stringify(updates)})
      `;
    },
  };
}
