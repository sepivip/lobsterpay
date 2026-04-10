import { createHash } from "node:crypto";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { Db } from "../db/client.js";

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function createApiKeyAuth(db: Db) {
  return async function authenticateApiKey(request: FastifyRequest, reply: FastifyReply) {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return reply.status(401).send({ code: "unauthorized", message: "Missing API key" });
    }

    const rawKey = authHeader.slice(7);
    const keyHash = hashApiKey(rawKey);

    const rows = await db`
      SELECT ak.*, v.vault_pda, v.status as vault_status, v.id as vault_uuid
      FROM api_keys ak
      JOIN vaults v ON ak.vault_id = v.id
      WHERE ak.key_hash = ${keyHash}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return reply.status(401).send({ code: "unauthorized", message: "Invalid API key" });
    }

    const apiKey = rows[0];

    if (apiKey.status !== "active") {
      return reply.status(401).send({ code: "unauthorized", message: "API key revoked" });
    }

    if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) {
      return reply.status(401).send({ code: "unauthorized", message: "API key expired" });
    }

    if (apiKey.vault_status !== "active") {
      return reply.status(403).send({ code: "vault_paused", message: "Vault is paused" });
    }

    // Update last_used_at (fire-and-forget)
    db`UPDATE api_keys SET last_used_at = NOW() WHERE id = ${apiKey.id}`.catch(() => {});

    // Attach to request for downstream use
    (request as any).apiKeyRecord = apiKey;
    (request as any).vaultId = apiKey.vault_uuid;
  };
}
