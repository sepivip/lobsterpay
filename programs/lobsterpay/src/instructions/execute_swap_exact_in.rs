use anchor_lang::prelude::*;
use crate::errors::LobsterPayError;
use crate::state::{Policy, Vault};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct ExecuteSwapExactInParams {
    pub amount_in: u64,
    pub min_amount_out: u64,
    pub slippage_bps: u16,
    pub request_hash: [u8; 32],
}

#[derive(Accounts)]
pub struct ExecuteSwapExactIn<'info> {
    pub authority: Signer<'info>,

    pub vault: Account<'info, Vault>,

    #[account(
        mut,
        has_one = vault,
    )]
    pub policy: Account<'info, Policy>,
    // remaining_accounts will be used for swap adapter accounts in Phase 3
}

pub fn handler(
    _ctx: Context<ExecuteSwapExactIn>,
    _params: ExecuteSwapExactInParams,
) -> Result<()> {
    // Phase 3 stub — swap functionality not yet implemented
    Err(LobsterPayError::UnsupportedFeature.into())
}
