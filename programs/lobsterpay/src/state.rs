use anchor_lang::prelude::*;
use crate::constants::*;

#[account]
pub struct Vault {
    pub owner: Pubkey,
    pub policy: Pubkey,
    pub bump: u8,
    pub created_at: i64,
    pub version: u8,
}

impl Vault {
    pub const MAX_SIZE: usize = 32 + 32 + 1 + 8 + 1; // 74
}

#[account]
pub struct Policy {
    pub vault: Pubkey,
    pub owner: Pubkey,
    /// Additional signer allowed to call execute_pay_exact / execute_swap_exact_in
    /// on behalf of the owner. Typically the LobsterPay backend fee payer.
    /// Default (at init) is the owner itself, which disables agent delegation.
    pub authorized_agent: Pubkey,
    pub paused: bool,
    pub allowed_actions: u64,
    pub max_per_tx_amount_atomic: u64,
    pub daily_limit_amount_atomic: u64,
    pub daily_spent_amount_atomic: u64,
    pub daily_window_start_ts: i64,
    pub max_slippage_bps: u16,
    pub allowed_mints: [Pubkey; MAX_ALLOWED_MINTS],
    pub allowed_mint_count: u8,
    pub allowed_destinations: [Pubkey; MAX_ALLOWED_DESTINATIONS],
    pub allowed_destination_count: u8,
    pub allowed_external_programs: [Pubkey; MAX_ALLOWED_EXTERNAL_PROGRAMS],
    pub allowed_external_program_count: u8,
    pub bump: u8,
    pub version: u8,
}

impl Policy {
    pub const MAX_SIZE: usize = 32 + 32 + 32 + 1 + 8 + 8 + 8 + 8 + 8 + 2
        + (32 * MAX_ALLOWED_MINTS) + 1
        + (32 * MAX_ALLOWED_DESTINATIONS) + 1
        + (32 * MAX_ALLOWED_EXTERNAL_PROGRAMS) + 1
        + 1 + 1; // = 784 (was 752, +32 for authorized_agent)

    /// Check if a given signer is authorized to act on this vault.
    /// Either the owner OR the authorized_agent.
    pub fn is_authorized(&self, signer: &Pubkey) -> bool {
        *signer == self.owner || *signer == self.authorized_agent
    }

    pub fn is_mint_allowed(&self, mint: &Pubkey) -> bool {
        if self.allowed_mint_count == 0 {
            return true; // empty = allow all
        }
        self.allowed_mints[..self.allowed_mint_count as usize].contains(mint)
    }

    pub fn is_destination_allowed(&self, dest: &Pubkey) -> bool {
        if self.allowed_destination_count == 0 {
            return true;
        }
        self.allowed_destinations[..self.allowed_destination_count as usize].contains(dest)
    }

    pub fn is_program_allowed(&self, program: &Pubkey) -> bool {
        if self.allowed_external_program_count == 0 {
            return false; // empty = deny all for CPI
        }
        self.allowed_external_programs[..self.allowed_external_program_count as usize]
            .contains(program)
    }

    pub fn is_action_allowed(&self, action: u64) -> bool {
        self.allowed_actions & action == action
    }

    pub fn check_and_update_daily_limit(
        &mut self,
        amount: u64,
        current_ts: i64,
    ) -> Result<()> {
        use crate::errors::LobsterPayError;

        // 0 = no limit enforced. Owner must set a non-zero
        // daily_limit_amount_atomic to enable daily-limit enforcement.
        if self.daily_limit_amount_atomic == 0 {
            return Ok(());
        }

        // Reset window using aligned day boundaries to prevent double-spend
        // at window edges. Each window is [aligned_start, aligned_start + 86400).
        let aligned_start = current_ts - (current_ts % SECONDS_PER_DAY);
        if aligned_start > self.daily_window_start_ts {
            self.daily_window_start_ts = aligned_start;
            self.daily_spent_amount_atomic = 0;
        }

        let new_spent = self
            .daily_spent_amount_atomic
            .checked_add(amount)
            .ok_or(LobsterPayError::ArithmeticOverflow)?;

        if new_spent > self.daily_limit_amount_atomic {
            return Err(LobsterPayError::AmountExceedsDailyLimit.into());
        }

        self.daily_spent_amount_atomic = new_spent;
        Ok(())
    }
}

/// FeeVault - a program-controlled PDA holding native SOL to fund
/// network fees for agent actions. Funded by the owner via deposit_fees.
#[account]
pub struct FeeVault {
    pub owner: Pubkey,
    pub vault: Pubkey,
    pub bump: u8,
    pub version: u8,
}

impl FeeVault {
    pub const MAX_SIZE: usize = 32 + 32 + 1 + 1; // 66
}
