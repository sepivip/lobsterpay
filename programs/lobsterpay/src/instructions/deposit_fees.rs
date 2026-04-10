use anchor_lang::prelude::*;
use anchor_lang::system_program;
use crate::constants::*;
use crate::errors::LobsterPayError;
use crate::events::FeesDeposited;
use crate::state::FeeVault;

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct DepositFeesParams {
    pub amount: u64,
}

#[derive(Accounts)]
pub struct DepositFees<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        has_one = owner,
        seeds = [FEE_VAULT_SEED, owner.key().as_ref()],
        bump = fee_vault.bump,
    )]
    pub fee_vault: Account<'info, FeeVault>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<DepositFees>, params: DepositFeesParams) -> Result<()> {
    require!(params.amount > 0, LobsterPayError::InvalidAmount);

    // Transfer SOL from owner → fee_vault via system program CPI
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.owner.to_account_info(),
                to: ctx.accounts.fee_vault.to_account_info(),
            },
        ),
        params.amount,
    )?;

    let new_balance = ctx.accounts.fee_vault.to_account_info().lamports();

    emit!(FeesDeposited {
        fee_vault: ctx.accounts.fee_vault.key(),
        owner: ctx.accounts.owner.key(),
        amount: params.amount,
        new_balance,
    });

    Ok(())
}
