import postgres from "postgres";
import type { Config } from "../config.js";

export function createDb(config: Config) {
  return postgres(config.DATABASE_URL, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });
}

export type Db = ReturnType<typeof createDb>;
