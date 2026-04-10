import type { FastifyInstance } from "fastify";
import type { Db } from "../db/client.js";
import { createApiKeyAuth } from "../middleware/auth.js";

export function agentRoutes(app: FastifyInstance, db: Db) {
  const auth = createApiKeyAuth(db);

  app.get("/v1/agent/vault", { preHandler: auth }, async (request) => {
    const vaultId = (request as any).vaultId;
    const rows = await db`
      SELECT v.vault_pda, vp.paused, vp.allowed_actions, vp.max_per_tx_amount_atomic,
             vp.daily_limit_amount_atomic, vp.max_slippage_bps
      FROM vaults v
      JOIN vault_policies vp ON vp.vault_id = v.id
      WHERE v.id = ${vaultId}
    `;
    return {
      vaultPda: rows[0].vault_pda,
      balances: {},
      permissions: {
        allowedActions: rows[0].allowed_actions,
        maxPerTxAmountAtomic: String(rows[0].max_per_tx_amount_atomic),
        dailyLimitAmountAtomic: String(rows[0].daily_limit_amount_atomic),
        dailySpentAmountAtomic: "0",
        maxSlippageBps: rows[0].max_slippage_bps,
      },
    };
  });

  app.post("/v1/agent/quotes/swap", { preHandler: auth }, async (_request, reply) => {
    return reply.status(501).send({ message: "Swap quotes not implemented yet" });
  });

  app.post("/v1/agent/actions/pay", { preHandler: auth }, async (_request, reply) => {
    return reply.status(501).send({ message: "Pay action not implemented yet" });
  });

  app.post("/v1/agent/actions/swap", { preHandler: auth }, async (_request, reply) => {
    return reply.status(501).send({ message: "Swap action not implemented yet" });
  });

  app.post("/v1/agent/actions/x402", { preHandler: auth }, async (_request, reply) => {
    return reply.status(501).send({ message: "x402 action not implemented yet" });
  });
}
