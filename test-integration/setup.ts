/**
 * Shared test harness. Loads env, builds a typed API client (covering
 * both SDK methods and the endpoints the SDK does not expose yet), and
 * collects on-chain tx signatures from each test for a final digest.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { DEFAULT_API_URL, DEFAULT_DEVNET_RPC, USDC_MINT_DEVNET } from "./fixtures.js";

export interface TestConfig {
	apiKey: string;
	apiUrl: string;
	rpcUrl: string;
	testDestOwner: string;
	skipExternal: boolean;
	usdcMint: string;
}

/** Read & validate test config from process.env. Throws with a clear
 *  message listing every missing variable. */
export function loadConfig(): TestConfig {
	// Accept both LOBSTERPAY_API_KEY (canonical) and LOBSTERPAY_API
	// (used by some pre-existing regression scripts in this repo).
	const apiKey = process.env.LOBSTERPAY_API_KEY ?? process.env.LOBSTERPAY_API ?? "";
	const apiUrl = process.env.LOBSTERPAY_API_URL ?? DEFAULT_API_URL;
	const rpcUrl = process.env.SOLANA_RPC_URL ?? DEFAULT_DEVNET_RPC;
	const testDestOwner = process.env.TEST_DEST_OWNER ?? "";
	const skipExternal = process.env.SKIP_EXTERNAL === "1";
	const usdcMint = process.env.TEST_USDC_MINT ?? USDC_MINT_DEVNET;

	const missing: string[] = [];
	if (!apiKey) missing.push("LOBSTERPAY_API_KEY");
	if (!testDestOwner) missing.push("TEST_DEST_OWNER");
	if (missing.length) {
		throw new Error(
			`Missing required env vars: ${missing.join(", ")}. ` +
				`Copy .env.integration.example to .env.integration and fill in. ` +
				`Run via \`pnpm test:integration\` which loads it automatically.`,
		);
	}
	try {
		new PublicKey(testDestOwner);
	} catch {
		throw new Error(`TEST_DEST_OWNER is not a valid Solana pubkey: ${testDestOwner}`);
	}
	return { apiKey, apiUrl, rpcUrl, testDestOwner, skipExternal, usdcMint };
}

export interface ApiError extends Error {
	status: number;
	code?: string;
	body?: any;
}

/** Thin API client. Mirrors the @lobsterpay/sdk for the methods it
 *  exposes, and adds the facilitator + SIWX endpoints the SDK does not.
 *  Throws ApiError on non-2xx so tests can assert on status / code. */
export class TestApi {
	constructor(private cfg: TestConfig) {}

	private async request<T>(
		method: string,
		path: string,
		body?: unknown,
		opts?: { authOverride?: string | null },
	): Promise<T> {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		const auth =
			opts?.authOverride !== undefined ? opts.authOverride : `Bearer ${this.cfg.apiKey}`;
		if (auth) headers.Authorization = auth;

		const res = await fetch(`${this.cfg.apiUrl}${path}`, {
			method,
			headers,
			body: body ? JSON.stringify(body) : undefined,
		});
		const text = await res.text();
		const parsed = text ? safeParseJson(text) : undefined;
		if (!res.ok) {
			const err = new Error(
				`API ${method} ${path} -> ${res.status}: ${parsed?.message ?? parsed?.code ?? text}`,
			) as ApiError;
			err.status = res.status;
			err.code = parsed?.code;
			err.body = parsed ?? text;
			throw err;
		}
		return parsed as T;
	}

	getVault(): Promise<any> {
		return this.request("GET", "/v1/agent/vault");
	}

	createSwapQuote(params: { fromMint: string; toMint: string; amountAtomic: string }): Promise<any> {
		return this.request("POST", "/v1/agent/quotes/swap", params);
	}

	executePay(params: any): Promise<any> {
		return this.request("POST", "/v1/agent/actions/pay", params);
	}

	executeSwap(params: any): Promise<any> {
		return this.request("POST", "/v1/agent/actions/swap", params);
	}

	executeX402(params: any): Promise<any> {
		return this.request("POST", "/v1/agent/actions/x402", params);
	}

	executeX402Facilitator(params: any): Promise<any> {
		return this.request("POST", "/v1/agent/actions/x402-facilitator", params);
	}

	executeX402Siwx(params: any): Promise<any> {
		return this.request("POST", "/v1/agent/actions/x402-siwx", params);
	}

	listActivity(params?: { cursor?: string; limit?: number }): Promise<any> {
		const q = new URLSearchParams();
		if (params?.cursor) q.set("cursor", params.cursor);
		if (params?.limit) q.set("limit", String(params.limit));
		const qs = q.toString();
		return this.request("GET", `/v1/agent/vault/activity${qs ? `?${qs}` : ""}`);
	}

	/** Call any path with an explicit auth header. Used by 06-auth.test.ts
	 *  to verify that bad / missing keys are rejected. */
	requestRaw<T>(method: string, path: string, body?: unknown, authOverride?: string | null): Promise<T> {
		return this.request<T>(method, path, body, { authOverride });
	}
}

function safeParseJson(s: string): any {
	try {
		return JSON.parse(s);
	} catch {
		return undefined;
	}
}

/** Idempotency keys must be unique per logical request but stable for a
 *  retry within the same test. This keeps a per-test counter so the
 *  generated keys are short, readable, and deterministic enough to debug. */
let _idCounter = 0;
export function freshIdempotencyKey(label = "test"): string {
	_idCounter += 1;
	return `lp-it-${label}-${Date.now()}-${_idCounter}`;
}

/** Shared digest of tx signatures observed during the run. Tests push
 *  into this and the global `after` hook prints it at the end so the
 *  demo video has one clean block to capture. */
export interface TxDigestEntry {
	label: string;
	signature: string;
}
export const txDigest: TxDigestEntry[] = [];

/** Confirm a tx by signature (light wrapper for clarity at call sites). */
export async function confirmOnChain(
	rpcUrl: string,
	signature: string,
	timeoutMs = 30_000,
): Promise<boolean> {
	const conn = new Connection(rpcUrl, "confirmed");
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const status = await conn.getSignatureStatus(signature, { searchTransactionHistory: true });
		if (status.value?.confirmationStatus === "confirmed" || status.value?.confirmationStatus === "finalized") {
			return true;
		}
		await new Promise((r) => setTimeout(r, 1500));
	}
	return false;
}
