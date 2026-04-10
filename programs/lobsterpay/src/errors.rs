use anchor_lang::prelude::*;

#[error_code]
pub enum LobsterPayError {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Action not allowed by policy")]
    ActionNotAllowed,
    #[msg("Mint not in allowlist")]
    MintNotAllowed,
    #[msg("Destination not in allowlist")]
    DestinationNotAllowed,
    #[msg("Program not in allowlist")]
    ProgramNotAllowed,
    #[msg("Amount exceeds per-transaction limit")]
    AmountExceedsPerTxLimit,
    #[msg("Amount exceeds daily limit")]
    AmountExceedsDailyLimit,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Invalid route")]
    InvalidRoute,
    #[msg("Invalid slippage")]
    InvalidSlippage,
    #[msg("Invalid token program")]
    InvalidTokenProgram,
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
    #[msg("Stale window state")]
    StaleWindowState,
    #[msg("Unsupported feature")]
    UnsupportedFeature,
    #[msg("Mint allowlist is full")]
    MintAllowlistFull,
    #[msg("Destination allowlist is full")]
    DestinationAllowlistFull,
    #[msg("External program allowlist is full")]
    ExternalProgramAllowlistFull,
    #[msg("Duplicate entry in allowlist")]
    DuplicateAllowlistEntry,
}
