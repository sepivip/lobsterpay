CREATE TABLE IF NOT EXISTS x402_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES requests(id),
  payment_id TEXT,
  domain TEXT,
  payment_requirements_json JSONB,
  settlement_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_x402_payments_request ON x402_payments(request_id);
CREATE UNIQUE INDEX idx_x402_payment_id ON x402_payments(payment_id) WHERE payment_id IS NOT NULL;
