use anchor_lang::prelude::*;
use crate::constants::*;
use crate::errors::LobsterPayError;
use crate::events::FeesWithdrawn;
use crate::state::FeeVault;

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct WithdrawFeesParams {
    pub amount: u64,
}

#[derive(Accounts)]
pub struct WithdrawFees<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        has_one = owner,
        seeds = [FEE_VAULT_SEED, owner.key().as_ref()],
        bump = fee_vault.bump,
    )]
    pub fee_vault: Account<'info, FeeVault>,
}

pub fn handler(ctx: Context<WithdrawFees>, params: WithdrawFeesParams) -> Result<()> {
    require!(params.amount > 0, LobsterPayError::InvalidAmount);

    let fee_vault_info = ctx.accounts.fee_vault.to_account_info();
    let current_balance = fee_vault_info.lamports();

    // Must leave enough to keep the PDA rent-exempt.
    let rent = Rent::get()?;
    let min_rent = rent.minimum_balance(fee_vault_info.data_len());
    let available = current_balance.saturating_sub(min_rent);

    require!(
        params.amount <= available,
        LobsterPayError::InsufficientFeeBalance
    );

    // Direct lamport manipulation since both accounts are owned by the program.
    **fee_vault_info.try_borrow_mut_lamports()? = current_balance
        .checked_sub(params.amount)
        .ok_or(LobsterPayError::ArithmeticOverflow)?;

    **ctx.accounts.owner.to_account_info().try_borrow_mut_lamports()? = ctx
        .accounts
        .owner
        .to_account_info()
        .lamports()
        .checked_add(params.amount)
        .ok_or(LobsterPayError::ArithmeticOverflow)?;

    emit!(FeesWithdrawn {
        fee_vault: ctx.accounts.fee_vault.key(),
        owner: ctx.accounts.owner.key(),
        amount: params.amount,
        new_balance: current_balance - params.amount,
    });

    Ok(())
}
