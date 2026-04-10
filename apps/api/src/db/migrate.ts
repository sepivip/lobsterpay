import { loadConfig } from "../config.js";
import { createDb } from "./client.js";
import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const config = loadConfig();
  const sql = createDb(config);

  // Create migrations tracking table
  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  const migrationsDir = join(__dirname, "migrations");
  const files = (await readdir(migrationsDir)).filter(f => f.endsWith(".sql")).sort();

  const applied = await sql`SELECT name FROM _migrations`;
  const appliedSet = new Set(applied.map(r => r.name));

  for (const file of files) {
    if (appliedSet.has(file)) continue;
    console.log(`Applying migration: ${file}`);
    const content = await readFile(join(migrationsDir, file), "utf-8");
    await sql.begin(async (tx) => {
      await tx.unsafe(content);
      await tx`INSERT INTO _migrations (name) VALUES (${file})`;
    });
    console.log(`Applied: ${file}`);
  }

  console.log("All migrations applied.");
  await sql.end();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
