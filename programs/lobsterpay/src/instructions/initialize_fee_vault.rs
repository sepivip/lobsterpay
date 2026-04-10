use anchor_lang::prelude::*;
use crate::constants::*;
use crate::events::FeeVaultInitialized;
use crate::state::{FeeVault, Vault};

#[derive(Accounts)]
pub struct InitializeFeeVault<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        has_one = owner,
        seeds = [VAULT_SEED, owner.key().as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        init,
        payer = owner,
        space = 8 + FeeVault::MAX_SIZE,
        seeds = [FEE_VAULT_SEED, owner.key().as_ref()],
        bump,
    )]
    pub fee_vault: Account<'info, FeeVault>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeFeeVault>) -> Result<()> {
    let fee_vault = &mut ctx.accounts.fee_vault;
    fee_vault.owner = ctx.accounts.owner.key();
    fee_vault.vault = ctx.accounts.vault.key();
    fee_vault.bump = ctx.bumps.fee_vault;
    fee_vault.version = 1;

    emit!(FeeVaultInitialized {
        fee_vault: fee_vault.key(),
        owner: ctx.accounts.owner.key(),
        vault: ctx.accounts.vault.key(),
    });

    Ok(())
}
