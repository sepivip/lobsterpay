use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};
use crate::constants::*;
use crate::events::VaultTokenAccountEnsured;
use crate::state::Vault;

#[derive(Accounts)]
pub struct EnsureVaultTokenAccount<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        seeds = [VAULT_SEED, vault.owner.as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, Vault>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = vault,
        associated_token::token_program = token_program,
    )]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<EnsureVaultTokenAccount>) -> Result<()> {
    // The account is created by init_if_needed if it doesn't exist.
    emit!(VaultTokenAccountEnsured {
        vault: ctx.accounts.vault.key(),
        mint: ctx.accounts.mint.key(),
        token_account: ctx.accounts.vault_token_account.key(),
    });
    Ok(())
}
