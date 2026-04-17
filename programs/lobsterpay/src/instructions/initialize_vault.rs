use anchor_lang::prelude::*;
use crate::constants::*;
use crate::events::VaultInitialized;
use crate::state::{Policy, Vault};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct InitializeVaultParams {
    pub allowed_actions: u64,
    pub max_per_tx_amount_atomic: u64,
    pub daily_limit_amount_atomic: u64,
    pub max_slippage_bps: u16,
    /// Pubkey authorized to sign agent actions on behalf of the owner.
    /// Frontend passes the LobsterPay service relayer pubkey here so
    /// agent payments work immediately without a separate
    /// update_authorized_agent step. If None, defaults to the owner
    /// (effectively disables agent delegation until manually enabled).
    pub authorized_agent: Option<Pubkey>,
}

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = 8 + Vault::MAX_SIZE,
        seeds = [VAULT_SEED, owner.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        init,
        payer = owner,
        space = 8 + Policy::MAX_SIZE,
        seeds = [POLICY_SEED, vault.key().as_ref()],
        bump,
    )]
    pub policy: Account<'info, Policy>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeVault>, params: InitializeVaultParams) -> Result<()> {
    let clock = Clock::get()?;

    let vault = &mut ctx.accounts.vault;
    vault.owner = ctx.accounts.owner.key();
    vault.policy = ctx.accounts.policy.key();
    vault.bump = ctx.bumps.vault;
    vault.created_at = clock.unix_timestamp;
    vault.version = 1;

    let policy = &mut ctx.accounts.policy;
    policy.vault = vault.key();
    policy.owner = ctx.accounts.owner.key();
    // authorized_agent defaults to the passed-in param (typically the
    // LobsterPay service relayer) so agent flows work immediately.
    // Falls back to the owner if not provided, disabling delegation.
    policy.authorized_agent = params
        .authorized_agent
        .unwrap_or_else(|| ctx.accounts.owner.key());
    policy.paused = false;
    policy.allowed_actions = params.allowed_actions;
    policy.max_per_tx_amount_atomic = params.max_per_tx_amount_atomic;
    policy.daily_limit_amount_atomic = params.daily_limit_amount_atomic;
    policy.daily_spent_amount_atomic = 0;
    policy.daily_window_start_ts = clock.unix_timestamp;
    policy.max_slippage_bps = params.max_slippage_bps;
    policy.allowed_mints = [Pubkey::default(); MAX_ALLOWED_MINTS];
    policy.allowed_mint_count = 0;
    policy.allowed_destinations = [Pubkey::default(); MAX_ALLOWED_DESTINATIONS];
    policy.allowed_destination_count = 0;
    policy.allowed_external_programs = [Pubkey::default(); MAX_ALLOWED_EXTERNAL_PROGRAMS];
    policy.allowed_external_program_count = 0;
    policy.bump = ctx.bumps.policy;
    policy.version = 1;

    emit!(VaultInitialized {
        vault: vault.key(),
        owner: ctx.accounts.owner.key(),
    });

    Ok(())
}
