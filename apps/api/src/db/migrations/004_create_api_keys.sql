CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_id UUID NOT NULL REFERENCES vaults(id),
  label TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  prefix TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  expires_at TIMESTAMPTZ,
  allowed_actions_override INTEGER,
  per_tx_override BIGINT,
  daily_limit_override BIGINT,
  meta_json JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_vault ON api_keys(vault_id);
CREATE INDEX idx_api_keys_prefix ON api_keys(prefix);
