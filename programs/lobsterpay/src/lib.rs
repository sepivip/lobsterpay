use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod state;
pub mod instructions;
pub mod adapters;
pub mod utils;

use instructions::*;

declare_id!("A184DBQaCM6qWETbEDJUtr25bSuuTH72sTTixsyoZbtS");

#[program]
pub mod lobsterpay {
    use super::*;

    pub fn initialize_vault(
        ctx: Context<InitializeVault>,
        params: InitializeVaultParams,
    ) -> Result<()> {
        instructions::initialize_vault::handler(ctx, params)
    }

    pub fn update_policy(
        ctx: Context<UpdatePolicy>,
        params: UpdatePolicyParams,
    ) -> Result<()> {
        instructions::update_policy::handler(ctx, params)
    }

    pub fn ensure_vault_token_account(
        ctx: Context<EnsureVaultTokenAccount>,
    ) -> Result<()> {
        instructions::ensure_vault_token_account::handler(ctx)
    }

    pub fn execute_pay_exact(
        ctx: Context<ExecutePayExact>,
        params: ExecutePayExactParams,
    ) -> Result<()> {
        instructions::execute_pay_exact::handler(ctx, params)
    }

    pub fn execute_swap_exact_in(
        ctx: Context<ExecuteSwapExactIn>,
        params: ExecuteSwapExactInParams,
    ) -> Result<()> {
        instructions::execute_swap_exact_in::handler(ctx, params)
    }

    pub fn withdraw_owner(
        ctx: Context<WithdrawOwner>,
        params: WithdrawOwnerParams,
    ) -> Result<()> {
        instructions::withdraw_owner::handler(ctx, params)
    }

    pub fn emergency_pause(ctx: Context<EmergencyPause>) -> Result<()> {
        instructions::emergency_pause::handler(ctx)
    }

    pub fn initialize_fee_vault(ctx: Context<InitializeFeeVault>) -> Result<()> {
        instructions::initialize_fee_vault::handler(ctx)
    }

    pub fn deposit_fees(
        ctx: Context<DepositFees>,
        params: DepositFeesParams,
    ) -> Result<()> {
        instructions::deposit_fees::handler(ctx, params)
    }

    pub fn withdraw_fees(
        ctx: Context<WithdrawFees>,
        params: WithdrawFeesParams,
    ) -> Result<()> {
        instructions::withdraw_fees::handler(ctx, params)
    }

    pub fn update_authorized_agent(
        ctx: Context<UpdateAuthorizedAgent>,
        params: UpdateAuthorizedAgentParams,
    ) -> Result<()> {
        instructions::update_authorized_agent::handler(ctx, params)
    }
}
