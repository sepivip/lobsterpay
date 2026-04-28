/**
 * The agent task: buy a fortune from the LobsterPay demo paywall.
 *
 * Loads creds from .env.integration (same file as test-integration/).
 * Defines four tools that wrap LobsterPay's HTTP API. Hands them to
 * Claude via the Anthropic SDK's tool runner. The runner executes the
 * agent loop until Claude is done; we stream text deltas so the
 * console shows the agent's reasoning live.
 *
 * No personal info is hardcoded. Test destination + USDC mint come
 * from env. The agent never sees the API key directly - the tool
 * functions hold it host-side and only surface tool results to the
 * model.
 */

import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
// betaZodTool expects Zod v4 schemas. zod 3.25+ ships a `zod/v4` subpath
// that exposes v4 alongside the legacy v3 default export.
import { z } from "zod/v4";

const LOBSTERPAY_API_URL = (
	process.env.LOBSTERPAY_API_URL ?? "https://api.lobsterpay.xyz"
).replace(/\/$/, "");
const LOBSTERPAY_API_KEY =
	process.env.LOBSTERPAY_API_KEY ?? process.env.LOBSTERPAY_API;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!LOBSTERPAY_API_KEY) {
	console.error(
		"Missing LOBSTERPAY_API_KEY (or LOBSTERPAY_API) in environment.",
	);
	process.exit(1);
}
if (!ANTHROPIC_API_KEY) {
	console.error("Missing ANTHROPIC_API_KEY in environment.");
	process.exit(1);
}

// The agent runner picks one of the demo paywall paths. Both work the
// same way; the agent only needs to know one. Hardcoding to the
// fortune endpoint keeps the demo predictable for video.
const DEMO_PAYWALL_URL = `${LOBSTERPAY_API_URL}/v1/demo/x402/fortune`;

interface PaywallShape {
	statusCode: number;
	requirements: unknown;
	contentSnippet: string | null;
}

async function lpGet(path: string, headers: Record<string, string> = {}) {
	const res = await fetch(`${LOBSTERPAY_API_URL}${path}`, {
		headers: {
			Authorization: `Bearer ${LOBSTERPAY_API_KEY}`,
			...headers,
		},
	});
	const text = await res.text();
	let body: unknown = text;
	try {
		body = JSON.parse(text);
	} catch {}
	return { status: res.status, body, headers: res.headers };
}

async function lpPost(path: string, payload: unknown) {
	const res = await fetch(`${LOBSTERPAY_API_URL}${path}`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${LOBSTERPAY_API_KEY}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(payload),
	});
	const text = await res.text();
	let body: unknown = text;
	try {
		body = JSON.parse(text);
	} catch {}
	return { status: res.status, body };
}

// ── Tool 1: check the vault ────────────────────────────────────────
const checkVault = betaZodTool({
	name: "check_vault",
	description:
		"Check the LobsterPay vault's balances and per-tx / daily spending limits. Use this first to confirm the agent has enough headroom to settle a payment.",
	inputSchema: z.object({}).strict(),
	run: async () => {
		const { status, body } = await lpGet("/v1/agent/vault");
		if (status !== 200) {
			return JSON.stringify({ error: "vault read failed", status, body });
		}
		return JSON.stringify(body, null, 2);
	},
});

// ── Tool 2: peek at the paywall ────────────────────────────────────
const peekPaywall = betaZodTool({
	name: "peek_paywall",
	description:
		"GET the demo paywall without paying. Returns 402 + the parsed paymentRequirements so the agent can see the price, mint, and recipient before deciding to settle.",
	inputSchema: z.object({}).strict(),
	run: async (): Promise<string> => {
		const res = await fetch(DEMO_PAYWALL_URL);
		const headerVal = res.headers.get("payment-required");
		const text = await res.text();
		const out: PaywallShape = {
			statusCode: res.status,
			requirements: null,
			contentSnippet: null,
		};
		// Demo paywall sends payment-required as raw JSON; some gateways
		// base64-encode it. Try raw, fall back to base64, then to body.
		const tryParse = (s: string | null) => {
			if (!s) return null;
			try {
				return JSON.parse(s);
			} catch {
				try {
					return JSON.parse(Buffer.from(s, "base64").toString("utf8"));
				} catch {
					return null;
				}
			}
		};
		const decoded =
			tryParse(headerVal) ?? tryParse(text) ?? (text ? { raw: text } : null);
		if (decoded && typeof decoded === "object" && "accepts" in decoded) {
			out.requirements = (decoded as { accepts: unknown[] }).accepts?.[0];
		} else {
			out.requirements = decoded;
		}
		out.contentSnippet = text.slice(0, 200);
		return JSON.stringify(out, null, 2);
	},
});

// ── Tool 3: settle the payment ────────────────────────────────────
const payX402 = betaZodTool({
	name: "pay_x402",
	description:
		"Settle the demo paywall by submitting paymentRequirements (from peek_paywall) to LobsterPay's POST /v1/agent/actions/x402. LobsterPay builds and broadcasts a real Solana devnet transaction. Returns { txSignature, xPaymentHeader, status } on success - the agent must keep both fields to unlock the content.",
	inputSchema: z
		.object({
			paymentRequirements: z
				.unknown()
				.describe(
					"The accepts[0] object returned by peek_paywall - pass it through verbatim.",
				),
			idempotencyHint: z
				.string()
				.optional()
				.describe(
					"Short tag the agent can include for traceability. Will be combined with a timestamp.",
				),
		})
		.strict(),
	run: async ({ paymentRequirements, idempotencyHint }): Promise<string> => {
		const idempotencyKey = `agent-${idempotencyHint ?? "fortune"}-${Date.now()}`;
		const { status, body } = await lpPost("/v1/agent/actions/x402", {
			paymentRequirements,
			originalRequestUrl: DEMO_PAYWALL_URL,
			idempotencyKey,
		});
		return JSON.stringify({ status, body }, null, 2);
	},
});

// ── Tool 4: unlock the paywall with the payment header ────────────
const unlock = betaZodTool({
	name: "unlock",
	description:
		"Retry the paywall with the PAYMENT-SIGNATURE header from pay_x402. Returns 200 + the paywalled content (the fortune).",
	inputSchema: z
		.object({
			xPaymentHeader: z
				.string()
				.describe(
					"The xPaymentHeader value from pay_x402's response - base64 envelope.",
				),
		})
		.strict(),
	run: async ({ xPaymentHeader }): Promise<string> => {
		const res = await fetch(DEMO_PAYWALL_URL, {
			headers: {
				"PAYMENT-SIGNATURE": xPaymentHeader,
				"X-PAYMENT": xPaymentHeader,
			},
		});
		const text = await res.text();
		let body: unknown = text;
		try {
			body = JSON.parse(text);
		} catch {}
		return JSON.stringify({ status: res.status, body }, null, 2);
	},
});

// ── Run the agent ─────────────────────────────────────────────────
async function main() {
	const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

	const systemPrompt = [
		"You are a payment agent that holds an API key for a LobsterPay vault on Solana devnet.",
		"Your goal is to buy paywalled content for the user using the LobsterPay tools provided.",
		"Always: (1) check_vault first to confirm headroom, (2) peek_paywall to see what's required, (3) pay_x402 to settle, (4) unlock with the returned xPaymentHeader.",
		"After unlocking, present the content to the user along with the on-chain tx signature so they can verify it on Solscan.",
		"Do not invent tools or credentials. Use only the tools provided. Surface real error messages if a step fails.",
	].join(" ");

	const userTask =
		"Buy me a fortune from the LobsterPay demo paywall. Show me the fortune and the on-chain tx signature so I can verify it.";

	console.log("=".repeat(64));
	console.log("LOBSTERPAY AGENT RUNNER");
	console.log("=".repeat(64));
	console.log(`API URL:  ${LOBSTERPAY_API_URL}`);
	console.log(`Demo URL: ${DEMO_PAYWALL_URL}`);
	console.log(`Task:     ${userTask}`);
	console.log("=".repeat(64));
	console.log();

	const runner = client.beta.messages.toolRunner({
		model: "claude-opus-4-7",
		max_tokens: 64000,
		thinking: { type: "adaptive" },
		output_config: { effort: "high" },
		system: systemPrompt,
		tools: [checkVault, peekPaywall, payX402, unlock],
		messages: [{ role: "user", content: userTask }],
		stream: true,
	});

	let lastWasText = false;
	for await (const messageStream of runner) {
		for await (const event of messageStream) {
			if (event.type === "content_block_start") {
				if (event.content_block.type === "tool_use") {
					if (lastWasText) {
						process.stdout.write("\n");
						lastWasText = false;
					}
					console.log(`\n[tool] ${event.content_block.name}`);
				} else if (event.content_block.type === "thinking") {
					if (lastWasText) {
						process.stdout.write("\n");
						lastWasText = false;
					}
					console.log("\n[thinking]");
				}
			} else if (event.type === "content_block_delta") {
				if (event.delta.type === "text_delta") {
					process.stdout.write(event.delta.text);
					lastWasText = true;
				} else if (event.delta.type === "thinking_delta") {
					process.stdout.write(event.delta.thinking);
					lastWasText = true;
				}
			}
		}
	}

	console.log("\n");
	console.log("=".repeat(64));
	console.log("AGENT FINISHED");
	console.log("=".repeat(64));
}

main().catch((err) => {
	console.error("\nAgent runner failed:", err?.message ?? err);
	if (err instanceof Anthropic.APIError) {
		console.error(`Anthropic API error ${err.status}: ${err.message}`);
	}
	process.exit(1);
});
