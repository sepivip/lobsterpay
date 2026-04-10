CREATE TABLE IF NOT EXISTS vault_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_id UUID NOT NULL UNIQUE REFERENCES vaults(id),
  paused BOOLEAN NOT NULL DEFAULT FALSE,
  allowed_actions INTEGER NOT NULL DEFAULT 7,
  max_per_tx_amount_atomic BIGINT NOT NULL DEFAULT 0,
  daily_limit_amount_atomic BIGINT NOT NULL DEFAULT 0,
  max_slippage_bps INTEGER NOT NULL DEFAULT 100,
  config_json JSONB DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
