use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Mint, TokenAccount, TokenInterface, TransferChecked,
};
use crate::constants::*;
use crate::events::OwnerWithdrawal;
use crate::state::{Policy, Vault};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct WithdrawOwnerParams {
    pub amount: u64,
}

#[derive(Accounts)]
pub struct WithdrawOwner<'info> {
    pub owner: Signer<'info>,

    #[account(
        has_one = owner,
        seeds = [VAULT_SEED, owner.key().as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, Vault>,

    // Security: owner is already validated via vault.has_one = owner + seeds.
    // Policy is linked to vault via has_one = vault. Adding has_one = owner
    // here causes BPF stack overflow due to Policy's large account size.
    #[account(
        has_one = vault,
    )]
    pub policy: Account<'info, Policy>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = vault,
        associated_token::token_program = token_program,
    )]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = mint,
        token::token_program = token_program,
    )]
    pub destination_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<WithdrawOwner>, params: WithdrawOwnerParams) -> Result<()> {
    use crate::errors::LobsterPayError;

    // Guard: amount must be positive
    require!(params.amount > 0, LobsterPayError::InvalidAmount);

    // Guard: no duplicate account aliasing
    require!(
        ctx.accounts.vault_token_account.key() != ctx.accounts.destination_token_account.key(),
        LobsterPayError::DuplicateAccountAliasing
    );

    let vault = &ctx.accounts.vault;
    let owner_key = vault.owner.key();
    let seeds: &[&[u8]] = &[VAULT_SEED, owner_key.as_ref(), &[vault.bump]];
    let signer_seeds = &[seeds];

    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.vault_token_account.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.destination_token_account.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer_seeds,
        ),
        params.amount,
        ctx.accounts.mint.decimals,
    )?;

    let dest_owner = ctx.accounts.destination_token_account.owner;

    emit!(OwnerWithdrawal {
        vault: vault.key(),
        mint: ctx.accounts.mint.key(),
        destination: dest_owner,
        amount: params.amount,
    });

    Ok(())
}
