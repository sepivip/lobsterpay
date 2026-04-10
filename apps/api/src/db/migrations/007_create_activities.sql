CREATE TABLE IF NOT EXISTS activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_id UUID NOT NULL REFERENCES vaults(id),
  type TEXT NOT NULL,
  tx_signature TEXT,
  reference_request_id UUID REFERENCES requests(id),
  payload_json JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_activities_vault ON activities(vault_id);
CREATE INDEX idx_activities_created ON activities(created_at DESC);
