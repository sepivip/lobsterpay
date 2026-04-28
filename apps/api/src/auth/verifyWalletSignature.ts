import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";

const SIGNATURE_MAX_AGE_MS = 10 * 60 * 1000;
const CLOCK_SKEW_MS = 60 * 1000;

export const OWNER_AUTH_MESSAGE_PREFIX = "LobsterPay-auth";

export type OwnerAuthFailure =
	| { ok: false; reason: "missing_headers" }
	| { ok: false; reason: "invalid_address" }
	| { ok: false; reason: "invalid_timestamp" }
	| { ok: false; reason: "stale_timestamp" }
	| { ok: false; reason: "future_timestamp" }
	| { ok: false; reason: "invalid_signature" };

export type OwnerAuthSuccess = { ok: true; walletAddress: string };

export type OwnerAuthResult = OwnerAuthSuccess | OwnerAuthFailure;

export interface OwnerAuthHeaders {
	walletAddress?: string;
	walletSignature?: string;
	walletTimestamp?: string;
}

export function buildOwnerAuthMessage(walletAddress: string, timestampMs: string): string {
	return `${OWNER_AUTH_MESSAGE_PREFIX}:${walletAddress}:${timestampMs}`;
}

export function verifyOwnerAuth(
	headers: OwnerAuthHeaders,
	now: number = Date.now(),
): OwnerAuthResult {
	const { walletAddress, walletSignature, walletTimestamp } = headers;

	if (!walletAddress || !walletSignature || !walletTimestamp) {
		return { ok: false, reason: "missing_headers" };
	}

	let pubkey: PublicKey;
	try {
		pubkey = new PublicKey(walletAddress);
	} catch {
		return { ok: false, reason: "invalid_address" };
	}

	if (!/^\d+$/.test(walletTimestamp)) {
		return { ok: false, reason: "invalid_timestamp" };
	}
	const ts = Number.parseInt(walletTimestamp, 10);
	if (!Number.isFinite(ts)) {
		return { ok: false, reason: "invalid_timestamp" };
	}

	const ageMs = now - ts;
	if (ageMs > SIGNATURE_MAX_AGE_MS) {
		return { ok: false, reason: "stale_timestamp" };
	}
	if (ageMs < -CLOCK_SKEW_MS) {
		return { ok: false, reason: "future_timestamp" };
	}

	let sigBytes: Uint8Array;
	try {
		sigBytes = bs58.decode(walletSignature);
	} catch {
		return { ok: false, reason: "invalid_signature" };
	}
	if (sigBytes.length !== 64) {
		return { ok: false, reason: "invalid_signature" };
	}

	const message = buildOwnerAuthMessage(walletAddress, walletTimestamp);
	const messageBytes = new TextEncoder().encode(message);

	const valid = nacl.sign.detached.verify(messageBytes, sigBytes, pubkey.toBytes());
	if (!valid) {
		return { ok: false, reason: "invalid_signature" };
	}

	return { ok: true, walletAddress };
}
