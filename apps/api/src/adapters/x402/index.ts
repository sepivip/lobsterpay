/**
 * x402 wire-format adapter.
 *
 * Real x402 gateways (agonx402, Helius x402 adapter, etc.) produce payment
 * requirements per the x402 spec, which uses CAIP-2 chain identifiers for
 * the `network` field: `solana:<first-32-chars-of-genesis-hash>`. Our
 * earlier (LP-010 era) skill docs described a simpler `network: "solana"`
 * dialect, so the real world sends both. This adapter parses any of the
 * accepted shapes into a normalized `SolanaCluster` and lets the caller
 * reject requests that don't match the server's configured cluster.
 *
 * Accepted network strings:
 *   - "solana"            - cluster-agnostic; treated as "matches configured"
 *   - "solana-devnet"     - our dialect
 *   - "solana-mainnet"    - our dialect
 *   - "solana:<32-char-genesis-hash>" - CAIP-2 (x402 spec)
 *
 * Anything else is rejected with a precise error including the full list
 * of accepted forms so partners don't have to dig through docs.
 */

export type SolanaCluster = "devnet" | "mainnet";

export interface X402PaymentRequirements {
	scheme: "exact";
	/** Original network string the caller sent, preserved for audit / settlement. */
	network: string;
	/** Normalized cluster; `null` means the caller sent the cluster-agnostic
	 *  "solana" value and we should default to the server's configured cluster. */
	cluster: SolanaCluster | null;
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
 * CAIP-2 Solana chain identifiers are the first 32 characters of the base58
 * genesis block hash. These are stable across time (see Solana namespace
 * definition at
 * https://github.com/ChainAgnostic/namespaces/blob/main/solana/caip2.md).
 */
const CAIP2_SOLANA_MAINNET = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const CAIP2_SOLANA_DEVNET = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

/**
 * Parse x402's `network` field into a canonical cluster. Returns `null` if
 * the caller sent the generic "solana" value (the server should substitute
 * its own configured cluster). Throws on any unrecognized form.
 */
export function parseSolanaNetwork(input: string): SolanaCluster | null {
	if (input === "solana") return null;
	if (input === "solana-mainnet" || input === "solana-mainnet-beta") return "mainnet";
	if (input === "solana-devnet") return "devnet";
	if (input.startsWith("solana:")) {
		const hash = input.slice("solana:".length);
		if (hash === CAIP2_SOLANA_MAINNET) return "mainnet";
		if (hash === CAIP2_SOLANA_DEVNET) return "devnet";
		throw new Error(
			`Unrecognized Solana CAIP-2 chain id: ${input}. Expected solana:${CAIP2_SOLANA_MAINNET} (mainnet) or solana:${CAIP2_SOLANA_DEVNET} (devnet).`,
		);
	}
	throw new Error(
		`Unsupported network: ${input}. Accepted: "solana", "solana-devnet", "solana-mainnet", "solana:${CAIP2_SOLANA_MAINNET}" (CAIP-2 mainnet), "solana:${CAIP2_SOLANA_DEVNET}" (CAIP-2 devnet).`,
	);
}

/**
 * Parse x402 payment requirements from a 402 response body.
 *
 * Supports both our original flat shape ({ scheme, network, asset, amount,
 * recipient }) and the alias variants some clients emit (`paymentScheme`,
 * `chain`, `mint`, `token`, `amountAtomic`, `destination`, `payTo`, etc.).
 * Normalizes into {@link X402PaymentRequirements}.
 *
 * `serverCluster` is the server's configured Solana cluster; if the caller
 * sends a cluster-specific network that differs from the server's, this
 * function throws with a precise mismatch message. A `null` serverCluster
 * disables the cluster check (useful in unit tests).
 */
export function parsePaymentRequirements(
	input: unknown,
	serverCluster: SolanaCluster | null = null,
): X402PaymentRequirements {
	if (!input) throw new Error("Missing payment requirements");
	const data = input as Record<string, unknown>;

	const scheme = (data.scheme as string) || (data.paymentScheme as string) || "exact";
	if (scheme !== "exact") {
		throw new Error(`Unsupported x402 scheme: ${scheme}. Only "exact" is supported.`);
	}

	const rawNetwork = (data.network as string) || (data.chain as string) || "solana";
	const parsedCluster = parseSolanaNetwork(rawNetwork);

	// Cluster mismatch check: the caller sent a specific cluster that is
	// not what we serve. The server is only provisioned for one cluster at
	// a time (Anchor program deployment + relayer hot wallet are cluster-
	// scoped), so we cannot settle cross-cluster even if we wanted to.
	if (serverCluster && parsedCluster && parsedCluster !== serverCluster) {
		throw new Error(
			`Network mismatch: this LobsterPay deployment settles on ${serverCluster}, but the payment requirements specify ${parsedCluster} (network=${rawNetwork}). If you need ${parsedCluster}, use the deployment configured for that cluster.`,
		);
	}

	const asset = (data.asset || data.mint || data.token) as string | undefined;
	if (!asset) throw new Error("Missing asset/mint in payment requirements");

	const amount = (data.amount || data.amountAtomic) as string | number | undefined;
	if (amount === undefined || amount === null || amount === "") {
		throw new Error("Missing amount in payment requirements");
	}

	const recipient = (data.recipient || data.destination || data.payTo) as string | undefined;
	if (!recipient) throw new Error("Missing recipient in payment requirements");

	return {
		scheme: "exact",
		network: rawNetwork,
		cluster: parsedCluster,
		asset,
		amount: String(amount),
		recipient,
		paymentId: (data.paymentId as string) || (data.payment_id as string) || undefined,
		description: (data.description as string) || undefined,
		expiresAt: (data.expiresAt as string) || (data.expires_at as string) || undefined,
	};
}

/**
 * Offchain validation of parsed requirements against vault policy.
 */
export function validateRequirements(
	requirements: X402PaymentRequirements,
	allowedDomains?: string[],
	domain?: string,
): string | null {
	if (requirements.expiresAt && new Date(requirements.expiresAt) < new Date()) {
		return "Payment requirements have expired";
	}

	if (allowedDomains && allowedDomains.length > 0 && domain) {
		if (!allowedDomains.includes(domain)) {
			return `Domain ${domain} is not in the allowlist`;
		}
	}

	return null;
}
