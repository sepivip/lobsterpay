use anchor_lang::prelude::*;

#[event]
pub struct VaultInitialized {
    pub vault: Pubkey,
    pub owner: Pubkey,
}

#[event]
pub struct PolicyUpdated {
    pub vault: Pubkey,
}

#[event]
pub struct PaymentExecuted {
    pub vault: Pubkey,
    pub mint: Pubkey,
    pub destination: Pubkey,
    pub gross_amount: u64,
    pub net_amount: u64,
    pub service_fee: u64,
    pub request_hash: [u8; 32],
}

#[event]
pub struct SwapExecuted {
    pub vault: Pubkey,
    pub input_mint: Pubkey,
    pub output_mint: Pubkey,
    pub amount_in: u64,
    pub min_amount_out: u64,
}

#[event]
pub struct OwnerWithdrawal {
    pub vault: Pubkey,
    pub mint: Pubkey,
    pub destination: Pubkey,
    pub amount: u64,
}

#[event]
pub struct PauseToggled {
    pub vault: Pubkey,
    pub paused: bool,
}

#[event]
pub struct VaultTokenAccountEnsured {
    pub vault: Pubkey,
    pub mint: Pubkey,
    pub token_account: Pubkey,
}

#[event]
pub struct FeeVaultInitialized {
    pub fee_vault: Pubkey,
    pub owner: Pubkey,
    pub vault: Pubkey,
}

#[event]
pub struct FeesDeposited {
    pub fee_vault: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
    pub new_balance: u64,
}

#[event]
pub struct FeesWithdrawn {
    pub fee_vault: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
    pub new_balance: u64,
}

#[event]
pub struct AuthorizedAgentUpdated {
    pub vault: Pubkey,
    pub old_agent: Pubkey,
    pub new_agent: Pubkey,
}

#[event]
pub struct ServiceFeeCollected {
    pub vault: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub treasury: Pubkey,
}
