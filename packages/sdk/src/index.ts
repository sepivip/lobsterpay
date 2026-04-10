import { LobsterPayClient } from "./client.js";

export { LobsterPayClient };
export type { LobsterPayClientOptions } from "./client.js";
export * from "./types.js";

export function createClient(apiKey: string, baseUrl: string) {
  return new LobsterPayClient({ apiKey, baseUrl });
}
