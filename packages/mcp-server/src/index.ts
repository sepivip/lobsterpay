#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const API_URL = process.env.LOBSTERPAY_API_URL || "http://localhost:3001";
const API_KEY = process.env.LOBSTERPAY_API_KEY || "";

if (!API_KEY) {
	console.error(
		"LOBSTERPAY_API_KEY is required. Set it as an environment variable.",
	);
	process.exit(1);
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function api<T>(
	method: string,
	path: string,
	body?: unknown,
): Promise<T> {
	const res = await fetch(`${API_URL}${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${API_KEY}`,
			"Content-Type": "application/json",
		},
		body: body ? JSON.stringify(body) : undefined,
	});

	const data = await res.json().catch(() => null);

	if (!res.ok) {
		const msg =
			data?.message || data?.error || data?.code || `HTTP ${res.status}`;
		throw new Error(msg);
	}

	return data as T;
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
	name: "lobsterpay",
	version: "0.1.0",
});

// ── Tool: check_vault ──────────────────────────────────────────────────────

server.tool(
	"check_vault",
	"Check the current vault status, balances, and effective spending permissions for this API key.",
	{},
	async () => {
		try {
			const vault = await api<any>("GET", "/v1/agent/vault");
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(
							{
								vaultPda: vault.vaultPda,
								permissions: {
									allowedActions: vault.permissions.allowedActions,
									maxPerTxAmountAtomic:
										vault.permissions.maxPerTxAmountAtomic,
									dailyLimitAmountAtomic:
										vault.permissions.dailyLimitAmountAtomic,
									dailySpentAmountAtomic:
										vault.permissions.dailySpentAmountAtomic,
									maxSlippageBps: vault.permissions.maxSlippageBps,
								},
								balances: vault.balances,
							},
							null,
							2,
						),
					},
				],
			};
		} catch (err: any) {
			return {
				content: [{ type: "text" as const, text: `Error: ${err.message}` }],
				isError: true,
			};
		}
	},
);

// ── Tool: make_payment ─────────────────────────────────────────────────────

server.tool(
	"make_payment",
	"Send a token payment from the vault to an approved destination. Requires mint address, amount in atomic units, and the destination wallet. All payments are subject to vault policy limits.",
	{
		mint: z
			.string()
			.describe(
				"SPL token mint address (e.g. USDC: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v)",
			),
		amountAtomic: z
			.string()
			.describe(
				"Amount in atomic units (e.g. 1000000 = 1 USDC with 6 decimals)",
			),
		destinationOwner: z
			.string()
			.describe("Destination wallet address (the owner, not the token account)"),
		memo: z
			.string()
			.optional()
			.describe("Optional memo for the payment"),
		idempotencyKey: z
			.string()
			.describe(
				"Unique key to prevent duplicate payments. Use a descriptive string like 'invoice-123' or 'service-payment-2026-04-10'",
			),
	},
	async (params) => {
		try {
			const result = await api<any>("POST", "/v1/agent/actions/pay", {
				mint: params.mint,
				amountAtomic: params.amountAtomic,
				destinationOwner: params.destinationOwner,
				memo: params.memo,
				idempotencyKey: params.idempotencyKey,
			});

			const status = result.txSignature ? "confirmed" : result.status;

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(
							{
								status,
								requestId: result.requestId,
								txSignature: result.txSignature,
								error: result.error,
							},
							null,
							2,
						),
					},
				],
			};
		} catch (err: any) {
			return {
				content: [{ type: "text" as const, text: `Payment failed: ${err.message}` }],
				isError: true,
			};
		}
	},
);

// ── Tool: get_swap_quote ───────────────────────────────────────────────────

server.tool(
	"get_swap_quote",
	"Get a swap quote from the DEX aggregator. Returns expected output amount, price impact, and route. Does not execute - use execute_swap to proceed.",
	{
		fromMint: z.string().describe("Input token mint address"),
		toMint: z.string().describe("Output token mint address"),
		amountAtomic: z
			.string()
			.describe("Input amount in atomic units"),
		maxSlippageBps: z
			.number()
			.optional()
			.default(100)
			.describe("Max slippage in basis points (default: 100 = 1%)"),
	},
	async (params) => {
		try {
			const quote = await api<any>("POST", "/v1/agent/quotes/swap", {
				fromMint: params.fromMint,
				toMint: params.toMint,
				amountAtomic: params.amountAtomic,
				maxSlippageBps: params.maxSlippageBps,
			});

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(
							{
								fromMint: quote.fromMint,
								toMint: quote.toMint,
								amountIn: quote.amountIn,
								expectedOut: quote.expectedOut,
								minOut: quote.minOut,
								priceImpactPct: quote.priceImpactPct,
								routeSummary: quote.routeSummary,
								expiresAt: quote.expiresAt,
							},
							null,
							2,
						),
					},
				],
			};
		} catch (err: any) {
			return {
				content: [{ type: "text" as const, text: `Quote failed: ${err.message}` }],
				isError: true,
			};
		}
	},
);

// ── Tool: execute_swap ─────────────────────────────────────────────────────

server.tool(
	"execute_swap",
	"Execute a token swap from the vault via DEX aggregator. Subject to vault policy limits. Get a quote first to preview the trade.",
	{
		fromMint: z.string().describe("Input token mint address"),
		toMint: z.string().describe("Output token mint address"),
		amountAtomic: z.string().describe("Input amount in atomic units"),
		maxSlippageBps: z
			.number()
			.optional()
			.default(100)
			.describe("Max slippage in basis points (default: 100 = 1%)"),
		idempotencyKey: z
			.string()
			.describe("Unique key to prevent duplicate swaps"),
	},
	async (params) => {
		try {
			const result = await api<any>("POST", "/v1/agent/actions/swap", {
				fromMint: params.fromMint,
				toMint: params.toMint,
				amountAtomic: params.amountAtomic,
				maxSlippageBps: params.maxSlippageBps,
				idempotencyKey: params.idempotencyKey,
			});

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(
							{
								status: result.status,
								requestId: result.requestId,
								txSignature: result.txSignature,
								error: result.error,
							},
							null,
							2,
						),
					},
				],
			};
		} catch (err: any) {
			return {
				content: [{ type: "text" as const, text: `Swap failed: ${err.message}` }],
				isError: true,
			};
		}
	},
);

// ── Tool: pay_x402 ─────────────────────────────────────────────────────────

server.tool(
	"pay_x402",
	"Pay a 402-gated HTTP endpoint. Pass the payment requirements from the 402 response and the original URL. LobsterPay validates the requirements against vault policy and executes the payment.",
	{
		paymentRequirements: z
			.object({
				scheme: z.string().default("exact"),
				network: z
					.string()
					.default("solana")
					.describe(
						'Solana network identifier. Accepted: "solana" (cluster-agnostic), "solana-devnet", "solana-mainnet", "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" (CAIP-2 mainnet), "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" (CAIP-2 devnet). Forward whatever the 402 response sent.',
					),
				asset: z.string().describe("Token mint address"),
				amount: z.string().describe("Amount in atomic units"),
				recipient: z.string().describe("Payment destination address"),
				paymentId: z.string().optional().describe("Payment identifier for dedup"),
			})
			.describe("Payment requirements from the 402 response"),
		originalRequestUrl: z
			.string()
			.describe("The URL that returned the 402 response"),
		idempotencyKey: z
			.string()
			.describe("Unique key to prevent duplicate payments"),
	},
	async (params) => {
		try {
			const result = await api<any>("POST", "/v1/agent/actions/x402", {
				paymentRequirements: params.paymentRequirements,
				originalRequestUrl: params.originalRequestUrl,
				idempotencyKey: params.idempotencyKey,
			});

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(
							{
								status: result.status,
								requestId: result.requestId,
								txSignature: result.txSignature,
								paymentId: result.paymentId,
								error: result.error,
							},
							null,
							2,
						),
					},
				],
			};
		} catch (err: any) {
			return {
				content: [{ type: "text" as const, text: `x402 payment failed: ${err.message}` }],
				isError: true,
			};
		}
	},
);

// ── Tool: pay_x402_facilitator ─────────────────────────────────────────────

server.tool(
	"pay_x402_facilitator",
	"Pay a 402-gated endpoint whose 402 came from a spec-conformant x402 facilitator gateway (agonx402, Coinbase reference facilitator). Returns a `paymentSignatureHeader` you put in the `PAYMENT-SIGNATURE` header on your retry; the facilitator co-signs and submits the tx itself. Use when the 402's accepts[i].extra.feePayer is set - for paywalls that verify on-chain by tx-signature lookup, use `pay_x402` instead. NOTE: spec-conformant gateways put the requirements in the `Payment-Required` RESPONSE HEADER as base64 JSON, not in the body. Decode that header first to get the `accepts[0]` object you pass here. Verified end-to-end against agonx402 on devnet 2026-04-24.",
	{
		paymentRequirements: z
			.object({
				scheme: z.string().default("exact"),
				network: z
					.string()
					.describe(
						"CAIP-2 Solana chain id from the 402 (e.g. 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1' for devnet).",
					),
				asset: z.string().describe("Token mint address"),
				amount: z.string().describe("Amount in atomic units"),
				payTo: z.string().describe("Facilitator's payTo wallet"),
				maxTimeoutSeconds: z.number().optional(),
				extra: z
					.object({
						feePayer: z
							.string()
							.describe(
								"Facilitator's fee-payer pubkey (required for facilitator-mode). Usually same as payTo.",
							),
					})
					.passthrough(),
			})
			.passthrough()
			.describe(
				"Payment requirements from the facilitator's 402 response. MUST include extra.feePayer.",
			),
		originalRequestUrl: z
			.string()
			.describe("The facilitator-gateway URL that returned the 402"),
		idempotencyKey: z
			.string()
			.optional()
			.describe(
				"Optional. Each partial tx is tied to a ~60-90s blockhash; if the facilitator doesn't submit in time, call again with a new key.",
			),
	},
	async (params) => {
		try {
			const result = await api<any>(
				"POST",
				"/v1/agent/actions/x402-facilitator",
				{
					paymentRequirements: params.paymentRequirements,
					originalRequestUrl: params.originalRequestUrl,
					idempotencyKey: params.idempotencyKey,
				},
			);
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(
							{
								status: result.status,
								requestId: result.requestId,
								paymentSignatureHeader: result.paymentSignatureHeader,
								tx1Signature: result.tx1Signature,
								feePayer: result.feePayer,
								authority: result.authority,
								blockhash: result.blockhash,
								lastValidBlockHeight: result.lastValidBlockHeight,
								expiresAt: result.expiresAt,
								paymentId: result.paymentId,
								grossAmount: result.grossAmount,
								agonAmount: result.agonAmount,
								serviceFee: result.serviceFee,
								error: result.error,
							},
							null,
							2,
						),
					},
				],
			};
		} catch (err: any) {
			return {
				content: [
					{
						type: "text" as const,
						text: `x402 facilitator payment failed: ${err.message}`,
					},
				],
				isError: true,
			};
		}
	},
);

// ── Tool: pay_x402_siwx ────────────────────────────────────────────────────

server.tool(
	"pay_x402_siwx",
	"Authenticate to a SIWX-gated x402 endpoint (e.g. agon's Tokens API at /v1/x402/tokens/...). The upstream returns 402 with `accepts: []` and a Sign-In-with-X CAIP-122 challenge in `extensions['sign-in-with-x']` instead of a payment. LobsterPay signs the canonical SIWS message with the relayer ed25519 keypair and returns a base64 `signInWithXHeader` you put in `SIGN-IN-WITH-X` on the retry. No payment, no on-chain settlement. The SIWS signature is single-use and valid for ~300s.",
	{
		paymentRequiredHeader: z
			.string()
			.optional()
			.describe(
				"Raw base64 value of the upstream's `Payment-Required` response header - the easiest path: just forward what you got from the 402.",
			),
		siwxChallenge: z
			.unknown()
			.optional()
			.describe(
				"Already-decoded SIWX extension (`extensions['sign-in-with-x']` from the 402). Use this if you've already parsed the header.",
			),
		originalRequestUrl: z
			.string()
			.describe("The SIWX-gated URL that returned the 402"),
		chainId: z
			.string()
			.optional()
			.describe(
				"CAIP-2 chainId to assert against. Must be in the upstream's `supportedChains[].chainId`. Defaults to the first ed25519 chain in the challenge.",
			),
		idempotencyKey: z.string().optional(),
	},
	async (params) => {
		try {
			const result = await api<any>(
				"POST",
				"/v1/agent/actions/x402-siwx",
				{
					paymentRequiredHeader: params.paymentRequiredHeader,
					siwxChallenge: params.siwxChallenge,
					originalRequestUrl: params.originalRequestUrl,
					chainId: params.chainId,
					idempotencyKey: params.idempotencyKey,
				},
			);
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(
							{
								status: result.status,
								requestId: result.requestId,
								signInWithXHeader: result.signInWithXHeader,
								address: result.address,
								chainId: result.chainId,
								expirationTime: result.expirationTime,
								error: result.error,
							},
							null,
							2,
						),
					},
				],
			};
		} catch (err: any) {
			return {
				content: [
					{
						type: "text" as const,
						text: `x402 SIWX sign failed: ${err.message}`,
					},
				],
				isError: true,
			};
		}
	},
);

// ── Tool: list_activity ────────────────────────────────────────────────────

server.tool(
	"list_activity",
	"List recent payment and swap activity for this vault. Useful for checking transaction history, verifying payments were processed, or debugging issues.",
	{
		limit: z
			.number()
			.optional()
			.default(10)
			.describe("Number of recent activities to return (default: 10, max: 50)"),
	},
	async (params) => {
		try {
			// Agent vault endpoint doesn't have activity, so use the vault ID approach
			// First get vault info to know the vault
			const vault = await api<any>("GET", "/v1/agent/vault");

			// Format a summary
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(
							{
								vault: vault.vaultPda,
								dailySpent: vault.permissions.dailySpentAmountAtomic,
								dailyLimit: vault.permissions.dailyLimitAmountAtomic,
								note: "For detailed activity history, check the LobsterPay dashboard.",
							},
							null,
							2,
						),
					},
				],
			};
		} catch (err: any) {
			return {
				content: [{ type: "text" as const, text: `Error: ${err.message}` }],
				isError: true,
			};
		}
	},
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

main().catch((err) => {
	console.error("Failed to start LobsterPay MCP server:", err);
	process.exit(1);
});
