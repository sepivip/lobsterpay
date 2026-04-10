ALTER TABLE vaults ADD COLUMN fee_vault_pda TEXT;
ALTER TABLE vault_policies ADD COLUMN authorized_agent TEXT;
ALTER TABLE vault_policies ADD COLUMN fee_balance_lamports BIGINT DEFAULT 0;
