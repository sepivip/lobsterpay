import { Connection, type Commitment } from "@solana/web3.js";
import type { Config } from "../config.js";

export function createRpcClient(config: Config) {
  return new Connection(config.SOLANA_RPC_URL, {
    commitment: "confirmed" as Commitment,
    confirmTransactionInitialTimeout: 60_000,
  });
}
