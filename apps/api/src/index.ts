import Fastify from "fastify";
import cors from "@fastify/cors";
import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { createTxService } from "./services/tx.service.js";
import { startX402FacilitatorReconciler } from "./services/x402.facilitator-reconciler.js";
import { vaultRoutes } from "./routes/vaults.js";
import { agentRoutes } from "./routes/agent.js";
import { skillRoutes } from "./routes/skills.js";
import { configRoutes } from "./routes/config.js";
import { demoRoutes } from "./routes/demo.js";

async function main() {
  const config = loadConfig();
  const db = createDb(config);
  const txService = createTxService(db, config);

  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
    },
  });

  await app.register(cors, {
    origin: config.ALLOWED_ORIGIN ? config.ALLOWED_ORIGIN.split(",") : true,
  });

  // Health check
  app.get("/health", async () => ({ status: "ok" }));

  // Register routes
  vaultRoutes(app, db, config);
  agentRoutes(app, db, config);
  skillRoutes(app, config);
  configRoutes(app, txService, config);
  demoRoutes(app, config);

  await app.listen({ port: config.API_PORT, host: config.API_HOST });
  console.log(`LobsterPay API running on ${config.API_HOST}:${config.API_PORT}`);

  // Background reconciler that closes the loop on x402 facilitator-mode
  // requests: when the facilitator gateway submits tx2, this worker
  // detects it on-chain and flips the request row from
  // `awaiting_facilitator` to `confirmed`. Without it, those rows would
  // stay pending forever (the facilitator never phones home). See BAT-508.
  startX402FacilitatorReconciler(db, txService, app.log);
}

main().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
