import { randomBytes, createHash } from "node:crypto";
import type { Db } from "../db/client.js";
import { API_KEY_PREFIX_LENGTH } from "@lobsterpay/shared";

function generateApiKey(): { rawKey: string; prefix: string; hash: string } {
  const bytes = randomBytes(32);
  const rawKey = `lp_live_${bytes.toString("base64url")}`;
  const prefix = rawKey.slice(0, API_KEY_PREFIX_LENGTH + 8); // "lp_live_" + 8 chars
  const hash = createHash("sha256").update(rawKey).digest("hex");
  return { rawKey, prefix, hash };
}

export function createApiKeyService(db: Db) {
  return {
    async create(vaultId: string, params: {
      label: string;
      expiresAt?: string;
      allowedActionsOverride?: number;
      perTxOverride?: string;
      dailyLimitOverride?: string;
    }) {
      const { rawKey, prefix, hash } = generateApiKey();

      const [apiKey] = await db`
        INSERT INTO api_keys (vault_id, label, key_hash, prefix, status, expires_at, allowed_actions_override, per_tx_override, daily_limit_override)
        VALUES (
          ${vaultId},
          ${params.label},
          ${hash},
          ${prefix},
          'active',
          ${params.expiresAt || null},
          ${params.allowedActionsOverride ?? null},
          ${params.perTxOverride ?? null},
          ${params.dailyLimitOverride ?? null}
        )
        RETURNING id, vault_id, label, prefix, status, expires_at, allowed_actions_override, per_tx_override, daily_limit_override, created_at
      `;

      // Log activity
      await db`
        INSERT INTO activities (vault_id, type, payload_json)
        VALUES (${vaultId}, 'key_created', ${JSON.stringify({ keyId: apiKey.id, label: params.label, prefix })})
      `;

      return { ...apiKey, rawKey };
    },

    async list(vaultId: string) {
      return db`
        SELECT id, vault_id, label, prefix, status, expires_at, allowed_actions_override,
               per_tx_override, daily_limit_override, created_at, last_used_at
        FROM api_keys
        WHERE vault_id = ${vaultId}
        ORDER BY created_at DESC
      `;
    },

    async revoke(vaultId: string, keyId: string) {
      const [key] = await db`
        UPDATE api_keys
        SET status = 'revoked'
        WHERE id = ${keyId} AND vault_id = ${vaultId} AND status = 'active'
        RETURNING id, label, prefix
      `;
      if (!key) return null;

      // Log activity
      await db`
        INSERT INTO activities (vault_id, type, payload_json)
        VALUES (${vaultId}, 'key_revoked', ${JSON.stringify({ keyId: key.id, label: key.label, prefix: key.prefix })})
      `;

      return key;
    },

    async getByHash(keyHash: string) {
      const rows = await db`
        SELECT ak.*, v.vault_pda, v.status as vault_status, v.id as vault_uuid
        FROM api_keys ak
        JOIN vaults v ON ak.vault_id = v.id
        WHERE ak.key_hash = ${keyHash}
        LIMIT 1
      `;
      return rows[0] || null;
    },
  };
}
