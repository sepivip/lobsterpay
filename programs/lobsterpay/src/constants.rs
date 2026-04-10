pub const VAULT_SEED: &[u8] = b"vault";
pub const POLICY_SEED: &[u8] = b"policy";

pub const MAX_ALLOWED_MINTS: usize = 8;
pub const MAX_ALLOWED_DESTINATIONS: usize = 8;
pub const MAX_ALLOWED_EXTERNAL_PROGRAMS: usize = 4;

pub const SECONDS_PER_DAY: i64 = 86400;

// Action flags (bitmask)
pub const ACTION_SWAP_EXACT_IN: u64 = 1;
pub const ACTION_PAY_EXACT: u64 = 2;
pub const ACTION_X402_EXACT: u64 = 4;
pub const ACTION_ALL: u64 = 7;
