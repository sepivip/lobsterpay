CREATE TABLE IF NOT EXISTS usage_windows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_id UUID NOT NULL REFERENCES vaults(id),
  api_key_id UUID REFERENCES api_keys(id),
  window_start TIMESTAMPTZ NOT NULL,
  amount_spent_atomic BIGINT NOT NULL DEFAULT 0,
  request_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_usage_windows_vault_key_start ON usage_windows(vault_id, api_key_id, window_start);
