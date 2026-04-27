use anchor_lang::prelude::*;
use crate::constants::*;
use crate::errors::LobsterPayError;
use crate::events::PolicyUpdated;
use crate::state::{Policy, Vault};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct UpdatePolicyParams {
    pub paused: Option<bool>,
    pub allowed_actions: Option<u64>,
    pub max_per_tx_amount_atomic: Option<u64>,
    pub daily_limit_amount_atomic: Option<u64>,
    pub max_slippage_bps: Option<u16>,
    pub allowed_mints: Option<Vec<Pubkey>>,
    pub allowed_destinations: Option<Vec<Pubkey>>,
    pub allowed_external_programs: Option<Vec<Pubkey>>,
}

#[derive(Accounts)]
pub struct UpdatePolicy<'info> {
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

pub fn handler(ctx: Context<UpdatePolicy>, params: UpdatePolicyParams) -> Result<()> {
    let policy = &mut ctx.accounts.policy;

    if let Some(paused) = params.paused {
        policy.paused = paused;
    }

    if let Some(allowed_actions) = params.allowed_actions {
        policy.allowed_actions = allowed_actions;
    }

    if let Some(max_per_tx) = params.max_per_tx_amount_atomic {
        policy.max_per_tx_amount_atomic = max_per_tx;
    }

    if let Some(daily_limit) = params.daily_limit_amount_atomic {
        policy.daily_limit_amount_atomic = daily_limit;
    }

    if let Some(max_slippage_bps) = params.max_slippage_bps {
        policy.max_slippage_bps = max_slippage_bps;
    }

    if let Some(mints) = params.allowed_mints {
        require!(
            mints.len() <= MAX_ALLOWED_MINTS,
            LobsterPayError::MintAllowlistFull
        );
        require!(
            !has_duplicates(&mints),
            LobsterPayError::DuplicateAllowlistEntry
        );
        let mut arr = [Pubkey::default(); MAX_ALLOWED_MINTS];
        for (i, m) in mints.iter().enumerate() {
            arr[i] = *m;
        }
        policy.allowed_mints = arr;
        policy.allowed_mint_count = mints.len() as u8;
    }

    if let Some(destinations) = params.allowed_destinations {
        require!(
            destinations.len() <= MAX_ALLOWED_DESTINATIONS,
            LobsterPayError::DestinationAllowlistFull
        );
        require!(
            !has_duplicates(&destinations),
            LobsterPayError::DuplicateAllowlistEntry
        );
        let mut arr = [Pubkey::default(); MAX_ALLOWED_DESTINATIONS];
        for (i, d) in destinations.iter().enumerate() {
            arr[i] = *d;
        }
        policy.allowed_destinations = arr;
        policy.allowed_destination_count = destinations.len() as u8;
    }

    if let Some(programs) = params.allowed_external_programs {
        require!(
            programs.len() <= MAX_ALLOWED_EXTERNAL_PROGRAMS,
            LobsterPayError::ExternalProgramAllowlistFull
        );
        require!(
            !has_duplicates(&programs),
            LobsterPayError::DuplicateAllowlistEntry
        );
        let mut arr = [Pubkey::default(); MAX_ALLOWED_EXTERNAL_PROGRAMS];
        for (i, p) in programs.iter().enumerate() {
            arr[i] = *p;
        }
        policy.allowed_external_programs = arr;
        policy.allowed_external_program_count = programs.len() as u8;
    }

    emit!(PolicyUpdated {
        vault: ctx.accounts.vault.key(),
    });

    Ok(())
}

/// O(n^2) duplicate check - acceptable for small allowlists (max 8 entries).
fn has_duplicates(list: &[Pubkey]) -> bool {
    for i in 0..list.len() {
        for j in (i + 1)..list.len() {
            if list[i] == list[j] {
                return true;
            }
        }
    }
    false
}
