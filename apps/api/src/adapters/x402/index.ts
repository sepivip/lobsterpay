export interface X402PaymentRequirements {
  scheme: "exact";
  network: string;
  asset: string; // mint address
  amount: string; // atomic units
  recipient: string; // destination wallet
  paymentId?: string;
  description?: string;
  expiresAt?: string;
}

export interface X402Settlement {
  paymentId: string;
  txSignature: string;
  status: "confirmed" | "failed";
  amount: string;
  asset: string;
  network: string;
}

/**
 * Parse x402 payment requirements from a 402 response.
 * Supports the X-PAYMENT-REQUIRED header format and JSON body format.
 */
export function parsePaymentRequirements(input: unknown): X402PaymentRequirements {
  // Input can be a raw object from the agent
  const data = input as Record<string, any>;

  if (!data) throw new Error("Missing payment requirements");

  // Support both flat object and nested structure
  const scheme = data.scheme || data.paymentScheme || "exact";
  if (scheme !== "exact") {
    throw new Error(`Unsupported x402 scheme: ${scheme}. Only "exact" is supported.`);
  }

  const network = data.network || data.chain || "solana";
  if (network !== "solana" && network !== "solana-devnet") {
    throw new Error(`Unsupported network: ${network}. Only Solana is supported.`);
  }

  const asset = data.asset || data.mint || data.token;
  if (!asset) throw new Error("Missing asset/mint in payment requirements");

  const amount = data.amount || data.amountAtomic;
  if (!amount) throw new Error("Missing amount in payment requirements");

  const recipient = data.recipient || data.destination || data.payTo;
  if (!recipient) throw new Error("Missing recipient in payment requirements");

  return {
    scheme: "exact",
    network,
    asset,
    amount: String(amount),
    recipient,
    paymentId: data.paymentId || data.payment_id || undefined,
    description: data.description || undefined,
    expiresAt: data.expiresAt || data.expires_at || undefined,
  };
}

/**
 * Validate payment requirements against the vault policy (offchain checks).
 */
export function validateRequirements(
  requirements: X402PaymentRequirements,
  allowedDomains?: string[],
  domain?: string,
): string | null {
  // Check expiry
  if (requirements.expiresAt && new Date(requirements.expiresAt) < new Date()) {
    return "Payment requirements have expired";
  }

  // Check domain allowlist if provided
  if (allowedDomains && allowedDomains.length > 0 && domain) {
    if (!allowedDomains.includes(domain)) {
      return `Domain ${domain} is not in the allowlist`;
    }
  }

  return null; // valid
}
