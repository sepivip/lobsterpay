use anchor_lang::prelude::*;
use crate::events::AuthorizedAgentUpdated;
use crate::state::{Policy, Vault};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct UpdateAuthorizedAgentParams {
    pub new_agent: Pubkey,
}

#[derive(Accounts)]
pub struct UpdateAuthorizedAgent<'info> {
    pub owner: Signer<'info>,

    #[account(has_one = owner)]
    pub vault: Account<'info, Vault>,

    #[account(
        mut,
        has_one = vault,
        has_one = owner,
    )]
    pub policy: Account<'info, Policy>,
}

pub fn handler(
    ctx: Context<UpdateAuthorizedAgent>,
    params: UpdateAuthorizedAgentParams,
) -> Result<()> {
    let policy = &mut ctx.accounts.policy;
    let old_agent = policy.authorized_agent;
    policy.authorized_agent = params.new_agent;

    emit!(AuthorizedAgentUpdated {
        vault: ctx.accounts.vault.key(),
        old_agent,
        new_agent: params.new_agent,
    });

    Ok(())
}
