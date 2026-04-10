pub const VAULT_SEED: &[u8] = b"vault";
pub const POLICY_SEED: &[u8] = b"policy";
pub const FEE_VAULT_SEED: &[u8] = b"fee_vault";

pub const MAX_ALLOWED_MINTS: usize = 8;
pub const MAX_ALLOWED_DESTINATIONS: usize = 8;
pub const MAX_ALLOWED_EXTERNAL_PROGRAMS: usize = 4;

pub const SECONDS_PER_DAY: i64 = 86400;

// Action flags (bitmask)
pub const ACTION_SWAP_EXACT_IN: u64 = 1;
pub const ACTION_PAY_EXACT: u64 = 2;
pub const ACTION_X402_EXACT: u64 = 4;
pub const ACTION_ALL: u64 = 7;

// ── LobsterPay revenue model ──

/// Service fee in basis points (150 = 1.5%).
/// Applied to every execute_pay_exact and execute_swap_exact_in.
pub const SERVICE_FEE_BPS: u64 = 150;
pub const BPS_DENOMINATOR: u64 = 10_000;

/// Minimum SOL balance the fee vault must hold before agent actions
/// are allowed. Covers rent exemption + buffer for ~100 transactions.
/// (Rent exempt for SOL-only account ≈ 890_880 lamports)
pub const FEE_VAULT_MIN_BALANCE: u64 = 1_500_000; // 0.0015 SOL

/// LobsterPay treasury address — all service fees accrue here.
/// NOTE: Replace with production treasury pubkey before mainnet deploy.
/// Current value is a devnet keypair for testing.
pub const LOBSTERPAY_TREASURY: &str = "DvcQMhZmhZZQ1CX6FhGkyAiPr3YtNbBuLDP3QpuBRTHp";
