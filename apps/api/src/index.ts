import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
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

  // Global rate limit. Applies to every route unless an opt-out is set
  // per-route via { config: { rateLimit: false } }. Authenticated agent
  // endpoints (Bearer API key) are still bounded by this IP-level cap as
  // a coarse abuse guard; per-key budgeting lives in the on-chain policy.
  await app.register(rateLimit, {
    global: true,
    max: 120,
    timeWindow: "1 minute",
    cache: 10_000,
    skipOnError: true,
  });

  // Health check (skip rate limit so monitoring probes never get throttled).
  app.get("/health", { config: { rateLimit: false } }, async () => ({ status: "ok" }));

  // Register routes
  vaultRoutes(app, db, config);
  agentRoutes(app, db, config);
  skillRoutes(app, config);
  configRoutes(app, txService, config);
  demoRoutes(app, config);

  await app.listen({ port: config.API_PORT, host: config.API_HOST });
  app.log.info({ host: config.API_HOST, port: config.API_PORT }, "LobsterPay API listening");

  // Background reconciler that closes the loop on x402 facilitator-mode
  // requests: when the facilitator gateway submits tx2, this worker
  // detects it on-chain and flips the request row from
  // `awaiting_facilitator` to `confirmed`. Without it, those rows would
  // stay pending forever (the facilitator never phones home).
  startX402FacilitatorReconciler(db, txService, app.log);
}

main().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
