import { PublicKey, SystemProgram } from "@solana/web3.js";
import type { Db } from "../db/client.js";
import type { Config } from "../config.js";

const VAULT_SEED = Buffer.from("vault");
const POLICY_SEED = Buffer.from("policy");

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

export function createVaultService(db: Db, config: Config) {
  const programId = new PublicKey(config.LOBSTERPAY_PROGRAM_ID);

  return {
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

      // Check if vault already exists in DB
      const existingVault = await db`SELECT * FROM vaults WHERE owner_id = ${owner.id} AND cluster = ${config.SOLANA_CLUSTER}`;
      if (existingVault.length > 0) {
        return { vault: existingVault[0], isNew: false };
      }

      // Create vault record
      const [vault] = await db`
        INSERT INTO vaults (owner_id, cluster, program_id, vault_pda, policy_pda, status)
        VALUES (${owner.id}, ${config.SOLANA_CLUSTER}, ${programId.toString()}, ${vaultPda.toString()}, ${policyPda.toString()}, 'active')
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
        VALUES (${vault.id}, 'vault_created', ${JSON.stringify({ vaultPda: vaultPda.toString(), policyPda: policyPda.toString() })})
      `;

      return {
        vault,
        isNew: true,
        instructions: {
          programId: programId.toString(),
          vaultPda: vaultPda.toString(),
          policyPda: policyPda.toString(),
        },
      };
    },

    async getVault(vaultId: string) {
      const rows = await db`
        SELECT v.*, vp.paused, vp.allowed_actions, vp.max_per_tx_amount_atomic,
               vp.daily_limit_amount_atomic, vp.max_slippage_bps, vp.config_json,
               o.wallet_address
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
               o.wallet_address
        FROM vaults v
        JOIN vault_policies vp ON vp.vault_id = v.id
        JOIN owners o ON o.id = v.owner_id
        WHERE o.wallet_address = ${walletAddress}
        LIMIT 1
      `;
      return rows[0] || null;
    },

    async updatePolicy(vaultId: string, updates: Record<string, any>) {
      const setClauses: any = { updated_at: new Date() };
      if (updates.paused !== undefined) setClauses.paused = updates.paused;
      if (updates.allowedActions !== undefined) setClauses.allowed_actions = updates.allowedActions;
      if (updates.maxPerTxAmountAtomic !== undefined) setClauses.max_per_tx_amount_atomic = updates.maxPerTxAmountAtomic;
      if (updates.dailyLimitAmountAtomic !== undefined) setClauses.daily_limit_amount_atomic = updates.dailyLimitAmountAtomic;
      if (updates.maxSlippageBps !== undefined) setClauses.max_slippage_bps = updates.maxSlippageBps;
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
