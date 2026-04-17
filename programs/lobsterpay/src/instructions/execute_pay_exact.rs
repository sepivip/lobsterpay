use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Mint, TokenAccount, TokenInterface, TransferChecked,
};
use std::str::FromStr;
use crate::constants::*;
use crate::errors::LobsterPayError;
use crate::events::{FeeReimbursed, PaymentExecuted, ServiceFeeCollected};
use crate::state::{FeeVault, Policy, Vault};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct ExecutePayExactParams {
    pub amount: u64,
    pub request_hash: [u8; 32],
}

#[derive(Accounts)]
pub struct ExecutePayExact<'info> {
    /// The authority — either the vault owner OR policy.authorized_agent.
    /// Also typically the tx fee payer; gets reimbursed from fee_vault
    /// for actual network costs at the end of this instruction so the
    /// vault economically pays its own gas.
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [VAULT_SEED, vault.owner.as_ref()],
        bump = vault.bump,
    )]
    pub vault: Box<Account<'info, Vault>>,

    #[account(
        mut,
        has_one = vault,
    )]
    pub policy: Box<Account<'info, Policy>>,

    /// Fee vault — holds SOL used to reimburse the tx fee payer for
    /// network costs after each agent action. Must remain rent-exempt
    /// after reimbursement.
    #[account(
        mut,
        seeds = [FEE_VAULT_SEED, vault.owner.as_ref()],
        bump = fee_vault.bump,
    )]
    pub fee_vault: Box<Account<'info, FeeVault>>,

    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = vault,
        associated_token::token_program = token_program,
    )]
    pub vault_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = mint,
        token::token_program = token_program,
    )]
    pub destination_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// LobsterPay treasury token account — must be owned by the hardcoded
    /// treasury pubkey and match the payment mint.
    #[account(
        mut,
        token::mint = mint,
        token::token_program = token_program,
    )]
    pub treasury_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<ExecutePayExact>, params: ExecutePayExactParams) -> Result<()> {
    let policy = &mut ctx.accounts.policy;
    let vault = &ctx.accounts.vault;

    // Guard: authority must be owner OR authorized agent
    require!(
        policy.is_authorized(&ctx.accounts.authority.key()),
        LobsterPayError::Unauthorized
    );

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

    // Guard: destination allowed (check owner of destination token account)
    let dest_owner = ctx.accounts.destination_token_account.owner;
    require!(
        policy.is_destination_allowed(&dest_owner),
        LobsterPayError::DestinationNotAllowed
    );

    // Guard: no duplicate account aliasing — vault can't pay itself
    require!(
        ctx.accounts.vault_token_account.key() != ctx.accounts.destination_token_account.key(),
        LobsterPayError::DuplicateAccountAliasing
    );
    require!(
        ctx.accounts.vault_token_account.key() != ctx.accounts.treasury_token_account.key(),
        LobsterPayError::DuplicateAccountAliasing
    );
    require!(
        ctx.accounts.destination_token_account.key() != ctx.accounts.treasury_token_account.key(),
        LobsterPayError::DuplicateAccountAliasing
    );

    // Guard: amount > 0
    require!(params.amount > 0, LobsterPayError::InvalidAmount);

    // Guard: per-tx limit (applies to gross amount)
    if policy.max_per_tx_amount_atomic > 0 {
        require!(
            params.amount <= policy.max_per_tx_amount_atomic,
            LobsterPayError::AmountExceedsPerTxLimit
        );
    }

    // Guard: daily limit (tracks gross amount)
    let clock = Clock::get()?;
    policy.check_and_update_daily_limit(params.amount, clock.unix_timestamp)?;

    // Guard: fee vault has enough SOL to fund future agent actions
    let fee_vault_lamports = ctx.accounts.fee_vault.to_account_info().lamports();
    require!(
        fee_vault_lamports >= FEE_VAULT_MIN_BALANCE,
        LobsterPayError::InsufficientFeeBalance
    );

    // Guard: treasury token account is owned by the expected treasury pubkey
    let expected_treasury = Pubkey::from_str(LOBSTERPAY_TREASURY)
        .map_err(|_| LobsterPayError::InvalidTreasury)?;
    require!(
        ctx.accounts.treasury_token_account.owner == expected_treasury,
        LobsterPayError::InvalidTreasury
    );

    // ── Calculate service fee ──
    // fee = amount * SERVICE_FEE_BPS / 10_000
    let service_fee = (params.amount as u128)
        .checked_mul(SERVICE_FEE_BPS as u128)
        .ok_or(LobsterPayError::ArithmeticOverflow)?
        .checked_div(BPS_DENOMINATOR as u128)
        .ok_or(LobsterPayError::ArithmeticOverflow)? as u64;

    let net_amount = params
        .amount
        .checked_sub(service_fee)
        .ok_or(LobsterPayError::ArithmeticOverflow)?;

    // ── Execute both transfers with vault PDA signing ──
    let owner_key = vault.owner.key();
    let seeds: &[&[u8]] = &[VAULT_SEED, owner_key.as_ref(), &[vault.bump]];
    let signer_seeds = &[seeds];

    // Transfer net amount to destination
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
        net_amount,
        ctx.accounts.mint.decimals,
    )?;

    // Transfer service fee to treasury (skip if fee is 0 from rounding)
    if service_fee > 0 {
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault_token_account.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.treasury_token_account.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                signer_seeds,
            ),
            service_fee,
            ctx.accounts.mint.decimals,
        )?;

        emit!(ServiceFeeCollected {
            vault: vault.key(),
            mint: ctx.accounts.mint.key(),
            amount: service_fee,
            treasury: expected_treasury,
        });
    }

    emit!(PaymentExecuted {
        vault: vault.key(),
        mint: ctx.accounts.mint.key(),
        destination: dest_owner,
        gross_amount: params.amount,
        net_amount,
        service_fee,
        request_hash: params.request_hash,
    });

    // ── Reimburse the tx fee payer from fee_vault ──
    // The vault pays its own gas. The authority (tx fee payer) gets back
    // FEE_REIMBURSEMENT_LAMPORTS from the fee_vault PDA, bounded so the
    // relayer can't drain the vault beyond actual tx cost. Uses direct
    // lamport manipulation (both accounts are program-writable under this
    // instruction context) instead of a System::transfer CPI — cheaper
    // compute and doesn't require PDA seeds for a transfer from an
    // account the program owns.
    let fee_vault_info = ctx.accounts.fee_vault.to_account_info();
    let fee_vault_current = fee_vault_info.lamports();
    let rent = Rent::get()?;
    let fee_vault_min_rent = rent.minimum_balance(fee_vault_info.data_len());
    let available_for_reimbursement = fee_vault_current.saturating_sub(fee_vault_min_rent);
    let reimbursement = FEE_REIMBURSEMENT_LAMPORTS.min(available_for_reimbursement);

    if reimbursement > 0 {
        let authority_info = ctx.accounts.authority.to_account_info();
        **fee_vault_info.try_borrow_mut_lamports()? = fee_vault_current
            .checked_sub(reimbursement)
            .ok_or(LobsterPayError::ArithmeticOverflow)?;
        **authority_info.try_borrow_mut_lamports()? = authority_info
            .lamports()
            .checked_add(reimbursement)
            .ok_or(LobsterPayError::ArithmeticOverflow)?;

        emit!(FeeReimbursed {
            vault: vault.key(),
            fee_vault: fee_vault_info.key(),
            to: authority_info.key(),
            amount: reimbursement,
        });
    }

    Ok(())
}
