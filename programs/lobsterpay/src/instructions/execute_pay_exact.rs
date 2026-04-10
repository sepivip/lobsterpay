use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Mint, TokenAccount, TokenInterface, TransferChecked,
};
use crate::constants::*;
use crate::errors::LobsterPayError;
use crate::events::PaymentExecuted;
use crate::state::{Policy, Vault};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct ExecutePayExactParams {
    pub amount: u64,
    pub request_hash: [u8; 32],
}

#[derive(Accounts)]
pub struct ExecutePayExact<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [VAULT_SEED, vault.owner.as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        mut,
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

pub fn handler(ctx: Context<ExecutePayExact>, params: ExecutePayExactParams) -> Result<()> {
    let policy = &mut ctx.accounts.policy;
    let vault = &ctx.accounts.vault;

    // Guard: not paused
    require!(!policy.paused, LobsterPayError::VaultPaused);

    // Guard: action allowed
    require!(
        policy.is_action_allowed(ACTION_PAY_EXACT),
        LobsterPayError::ActionNotAllowed
    );

    // Guard: mint allowed
    require!(
        policy.is_mint_allowed(&ctx.accounts.mint.key()),
        LobsterPayError::MintNotAllowed
    );

    // Guard: destination allowed (check the owner of the destination token account)
    let dest_owner = ctx.accounts.destination_token_account.owner;
    require!(
        policy.is_destination_allowed(&dest_owner),
        LobsterPayError::DestinationNotAllowed
    );

    // Guard: amount > 0
    require!(params.amount > 0, LobsterPayError::InvalidAmount);

    // Guard: per-tx limit
    if policy.max_per_tx_amount_atomic > 0 {
        require!(
            params.amount <= policy.max_per_tx_amount_atomic,
            LobsterPayError::AmountExceedsPerTxLimit
        );
    }

    // Guard: daily limit
    let clock = Clock::get()?;
    policy.check_and_update_daily_limit(params.amount, clock.unix_timestamp)?;

    // Execute transfer
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

    emit!(PaymentExecuted {
        vault: vault.key(),
        mint: ctx.accounts.mint.key(),
        destination: dest_owner,
        amount: params.amount,
        request_hash: params.request_hash,
    });

    Ok(())
}
