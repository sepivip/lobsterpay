use anchor_lang::prelude::*;
use crate::events::PauseToggled;
use crate::state::{Policy, Vault};

#[derive(Accounts)]
pub struct EmergencyPause<'info> {
    pub owner: Signer<'info>,

    #[account(
        has_one = owner,
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        mut,
        has_one = vault,
        has_one = owner,
    )]
    pub policy: Account<'info, Policy>,
}

pub fn handler(ctx: Context<EmergencyPause>) -> Result<()> {
    let policy = &mut ctx.accounts.policy;
    policy.paused = true;

    emit!(PauseToggled {
        vault: ctx.accounts.vault.key(),
        paused: true,
    });

    Ok(())
}
