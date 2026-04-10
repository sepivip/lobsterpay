CREATE TABLE IF NOT EXISTS vaults (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES owners(id),
  cluster TEXT NOT NULL DEFAULT 'devnet',
  program_id TEXT NOT NULL,
  vault_pda TEXT NOT NULL,
  policy_pda TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_vaults_owner ON vaults(owner_id);
CREATE UNIQUE INDEX idx_vaults_pda ON vaults(vault_pda);
