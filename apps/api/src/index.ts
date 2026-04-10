import Fastify from "fastify";
import cors from "@fastify/cors";
import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { vaultRoutes } from "./routes/vaults.js";
import { agentRoutes } from "./routes/agent.js";

async function main() {
  const config = loadConfig();
  const db = createDb(config);

  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
    },
  });

  await app.register(cors, { origin: true });

  // Health check
  app.get("/health", async () => ({ status: "ok" }));

  // Register routes
  vaultRoutes(app, db);
  agentRoutes(app, db);

  await app.listen({ port: config.API_PORT, host: config.API_HOST });
  console.log(`LobsterPay API running on ${config.API_HOST}:${config.API_PORT}`);
}

main().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
