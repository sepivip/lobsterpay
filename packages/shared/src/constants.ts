// PDA seeds
export const VAULT_SEED = "vault";
export const POLICY_SEED = "policy";

// Action bitmask values
export const ACTION_SWAP_EXACT_IN = 1;
export const ACTION_PAY_EXACT = 2;
export const ACTION_X402_EXACT = 4;
export const ACTION_ALL = 7;

// Limits
export const MAX_ALLOWED_MINTS = 8;
export const MAX_ALLOWED_DESTINATIONS = 8;
export const MAX_ALLOWED_EXTERNAL_PROGRAMS = 4;

// API key
export const API_KEY_PREFIX_LENGTH = 8;

// Time
export const SECONDS_PER_DAY = 86400;

// Action type mapping
export type ActionType = "swap_exact_in" | "pay_exact" | "x402_exact";

export const ACTION_TYPE_MAP: Record<ActionType, number> = {
  swap_exact_in: ACTION_SWAP_EXACT_IN,
  pay_exact: ACTION_PAY_EXACT,
  x402_exact: ACTION_X402_EXACT,
};

// Solana clusters
export const SOLANA_CLUSTERS = ["devnet", "mainnet-beta", "localnet"] as const;
export type SolanaCluster = (typeof SOLANA_CLUSTERS)[number];
