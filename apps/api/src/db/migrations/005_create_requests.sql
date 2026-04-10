CREATE TABLE IF NOT EXISTS requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_id UUID NOT NULL REFERENCES vaults(id),
  api_key_id UUID REFERENCES api_keys(id),
  action_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT,
  request_json JSONB,
  decision TEXT NOT NULL DEFAULT 'approved',
  rejection_reason TEXT,
  tx_signature TEXT,
  tx_status TEXT DEFAULT 'created',
  amount_atomic BIGINT,
  mint TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_requests_idempotency ON requests(vault_id, idempotency_key);
CREATE INDEX idx_requests_vault ON requests(vault_id);
CREATE INDEX idx_requests_tx ON requests(tx_signature);
