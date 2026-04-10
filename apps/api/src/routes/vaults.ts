import type { FastifyInstance } from "fastify";
import type { Db } from "../db/client.js";

export function vaultRoutes(app: FastifyInstance, db: Db) {
  // POST /v1/vaults — Create vault
  app.post("/v1/vaults", async (request, reply) => {
    // TODO: wallet auth for owner
    return reply.status(501).send({ message: "Not implemented yet" });
  });

  // GET /v1/vaults/:vaultId
  app.get("/v1/vaults/:vaultId", async (request, reply) => {
    const { vaultId } = request.params as { vaultId: string };
    const rows = await db`
      SELECT v.*, vp.paused, vp.allowed_actions, vp.max_per_tx_amount_atomic,
             vp.daily_limit_amount_atomic, vp.max_slippage_bps, vp.config_json
      FROM vaults v
      LEFT JOIN vault_policies vp ON vp.vault_id = v.id
      WHERE v.id = ${vaultId}
    `;
    if (rows.length === 0) {
      return reply.status(404).send({ code: "not_found", message: "Vault not found" });
    }
    return rows[0];
  });

  // PATCH /v1/vaults/:vaultId/policy
  app.patch("/v1/vaults/:vaultId/policy", async (request, reply) => {
    return reply.status(501).send({ message: "Not implemented yet" });
  });

  // POST /v1/vaults/:vaultId/api-keys
  app.post("/v1/vaults/:vaultId/api-keys", async (request, reply) => {
    return reply.status(501).send({ message: "Not implemented yet" });
  });

  // POST /v1/vaults/:vaultId/api-keys/:keyId/revoke
  app.post("/v1/vaults/:vaultId/api-keys/:keyId/revoke", async (request, reply) => {
    return reply.status(501).send({ message: "Not implemented yet" });
  });

  // GET /v1/vaults/:vaultId/activity
  app.get("/v1/vaults/:vaultId/activity", async (request, reply) => {
    const { vaultId } = request.params as { vaultId: string };
    const rows = await db`
      SELECT * FROM activities
      WHERE vault_id = ${vaultId}
      ORDER BY created_at DESC
      LIMIT 50
    `;
    return { items: rows };
  });
}
