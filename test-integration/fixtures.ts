/**
 * Constants and well-known addresses used across integration tests.
 *
 * No personal information here - every address is either a public Solana
 * primitive (System Program, USDC mint), a documented public test fixture
 * (LobsterPay program ID on devnet), or generated at run time.
 */

/** Devnet USDC mint that LobsterPay test vaults are typically funded with. */
export const USDC_MINT_DEVNET = "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr";

/** Wrapped SOL mint - used as the destination for swap quotes. */
export const WSOL_MINT = "So11111111111111111111111111111111111111112";

/** Solana System Program. Used as a "any valid pubkey" fixture in tests
 *  that need a syntactically correct pubkey but don't actually transact
 *  to it. */
export const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";

/** Default devnet RPC. Override with SOLANA_RPC_URL. */
export const DEFAULT_DEVNET_RPC = "https://api.devnet.solana.com";

/** Default API URL. Override with LOBSTERPAY_API_URL. */
export const DEFAULT_API_URL = "https://api.lobsterpay.xyz";

/** Smallest USDC test amount. 1000 atomic = 0.001 USDC. */
export const TINY_USDC_AMOUNT = "1000";

/** Small USDC test amount. 10000 atomic = 0.01 USDC. */
export const SMALL_USDC_AMOUNT = "10000";

/** A clearly-too-large amount that should always exceed any sane per-tx limit. */
export const HUGE_USDC_AMOUNT = "1000000000000"; // 1 million USDC

/** Max time to wait for a Solana tx to confirm during tests. */
export const CONFIRM_TIMEOUT_MS = 30_000;
