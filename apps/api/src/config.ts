import { envSchema } from "@lobsterpay/shared";

export function loadConfig() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("Invalid environment configuration:");
    console.error(result.error.format());
    process.exit(1);
  }
  return result.data;
}

export type Config = ReturnType<typeof loadConfig>;
