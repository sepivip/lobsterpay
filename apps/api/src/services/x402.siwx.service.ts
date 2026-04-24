/**
 * SIWX (Sign-In-with-X) auth-only adapter for x402 routes.
 *
 * Many gateways (e.g. agon's Tokens API) gate routes on a CAIP-122 wallet
 * signature instead of an on-chain payment. The challenge ships in the
 * same `Payment-Required` envelope as paid x402, but `accepts: []` is empty
 * and the SIWX challenge lives in `extensions["sign-in-with-x"]`.
 *
 * LobsterPay's value-add: the agent presents the challenge, we sign it
 * with the relayer ed25519 keypair and return a ready-to-use
 * `SIGN-IN-WITH-X` header. Agents never touch a wallet.
 *
 * No payment is taken; no on-chain settlement. We persist a request row
 * (action_type='x402_siwx', tx_status='authorized') and an activity entry
 * (`x402_siwx_authorized`) so the dashboard reflects the authorization.
 *
 * Canonical CAIP-122 / SIWS message format mirrors @x402/extensions/
 * sign-in-with-x's `formatSIWSMessage`. The message MUST use the cluster
 * reference (post-colon part of the CAIP-2 chainId) on the `Chain ID`
 * line, but the *payload* keeps the full CAIP-2 string. Getting that
 * wrong silently produces a 402 with no error detail from agon.
 */

import { createPrivateKey, sign as cryptoSign } from "node:crypto";
import bs58 from "bs58";
import { randomUUID } from "node:crypto";
import type { Db } from "../db/client.js";
import type { createTxService } from "./tx.service.js";

interface SiwxChallenge {
	domain: string;
	uri: string;
	statement?: string;
	version: string;
	nonce: string;
	issuedAt: string;
	expirationTime?: string;
	notBefore?: string;
	requestId?: string;
	resources?: string[];
}

interface SupportedChain {
	chainId: string;
	type: "ed25519" | string;
	signatureScheme?: string;
}

const PKCS8_ED25519_HEADER = Buffer.from(
	"302e020100300506032b657004220420",
	"hex",
);

function ed25519PrivateKeyFromSecret(secretKey: Uint8Array) {
	// Solana keypairs are 64 bytes: first 32 = ed25519 seed, last 32 = pubkey.
	// Wrap the seed as a minimal PKCS8 ed25519 private key DER blob so we can
	// hand it to Node's built-in crypto.sign — avoids pulling in tweetnacl.
	const seed = Buffer.from(secretKey.slice(0, 32));
	const der = Buffer.concat([PKCS8_ED25519_HEADER, seed]);
	return createPrivateKey({ key: der, format: "der", type: "pkcs8" });
}

function buildSiwsMessage(
	challenge: SiwxChallenge,
	address: string,
	chainId: string,
): string {
	// Lifted verbatim from @x402/extensions/sign-in-with-x's formatSIWSMessage:
	// the canonical CAIP-122 message any spec-conformant verifier reconstructs
	// to verify our signature against. Newlines and field order are load-bearing.
	const chainRef = chainId.split(":")[1] ?? chainId;
	const lines = [
		`${challenge.domain} wants you to sign in with your Solana account:`,
		address,
		"",
	];
	if (challenge.statement) lines.push(challenge.statement, "");
	lines.push(
		`URI: ${challenge.uri}`,
		`Version: ${challenge.version}`,
		`Chain ID: ${chainRef}`,
		`Nonce: ${challenge.nonce}`,
		`Issued At: ${challenge.issuedAt}`,
	);
	if (challenge.expirationTime)
		lines.push(`Expiration Time: ${challenge.expirationTime}`);
	if (challenge.notBefore) lines.push(`Not Before: ${challenge.notBefore}`);
	if (challenge.requestId) lines.push(`Request ID: ${challenge.requestId}`);
	if (challenge.resources?.length) {
		lines.push("Resources:");
		for (const r of challenge.resources) lines.push(`- ${r}`);
	}
	return lines.join("\n");
}

function decodePaymentRequiredHeader(headerB64: string): any {
	const json = Buffer.from(headerB64, "base64").toString("utf8");
	return JSON.parse(json);
}

function pickChain(
	supported: SupportedChain[],
	desired?: string,
): SupportedChain {
	if (desired) {
		const hit = supported.find((c) => c.chainId === desired);
		if (hit) return hit;
		throw new Error(
			`Requested chainId ${desired} not in upstream supportedChains`,
		);
	}
	const ed25519 = supported.find((c) => c.type === "ed25519");
	if (ed25519) return ed25519;
	throw new Error("No ed25519 chain in upstream supportedChains");
}

export function createX402SiwxService(
	db: Db,
	txService: ReturnType<typeof createTxService>,
) {
	return {
		async sign(params: {
			vaultId: string;
			apiKeyId: string;
			paymentRequiredHeader?: string;
			siwxChallenge?: any;
			originalRequestUrl: string;
			chainId?: string;
			idempotencyKey: string;
		}) {
			const relayer = txService.feePayer;
			if (!relayer) {
				throw new Error("Relayer not configured (FEE_PAYER_SECRET_KEY missing)");
			}

			let extension: any;
			if (params.siwxChallenge) {
				extension = params.siwxChallenge;
			} else if (params.paymentRequiredHeader) {
				const decoded = decodePaymentRequiredHeader(params.paymentRequiredHeader);
				extension = decoded?.extensions?.["sign-in-with-x"];
				if (!extension) {
					throw new Error(
						"Payment-Required header has no `sign-in-with-x` extension",
					);
				}
			} else {
				throw new Error(
					"Provide either `paymentRequiredHeader` or `siwxChallenge`",
				);
			}

			const info: SiwxChallenge | undefined = extension.info;
			const supported: SupportedChain[] | undefined = extension.supportedChains;
			if (!info || !supported?.length) {
				throw new Error("SIWX extension missing `info` or `supportedChains`");
			}

			const chain = pickChain(supported, params.chainId);
			const address = relayer.publicKey.toBase58();
			const message = buildSiwsMessage(info, address, chain.chainId);

			const pk = ed25519PrivateKeyFromSecret(relayer.secretKey);
			const sigBytes = cryptoSign(null, Buffer.from(message, "utf8"), pk);
			const signature = bs58.encode(sigBytes);

			const payload: Record<string, any> = {
				domain: info.domain,
				address,
				uri: info.uri,
				version: info.version,
				chainId: chain.chainId,
				type: chain.type,
				nonce: info.nonce,
				issuedAt: info.issuedAt,
				signature,
			};
			if (info.statement) payload.statement = info.statement;
			if (info.expirationTime) payload.expirationTime = info.expirationTime;
			if (info.notBefore) payload.notBefore = info.notBefore;
			if (info.requestId) payload.requestId = info.requestId;
			if (info.resources?.length) payload.resources = info.resources;
			if (chain.signatureScheme) payload.signatureScheme = chain.signatureScheme;

			const signInWithXHeader = Buffer.from(
				JSON.stringify(payload),
				"utf8",
			).toString("base64");

			const requestId = randomUUID();
			const requestJson = {
				originalRequestUrl: params.originalRequestUrl,
				domain: info.domain,
				uri: info.uri,
				chainId: chain.chainId,
				nonce: info.nonce,
				issuedAt: info.issuedAt,
				expirationTime: info.expirationTime,
				signedAddress: address,
			};

			// Persist as a normal request row so it shows up alongside facilitator
			// flows in the activity feed. action_type='x402_siwx' is a new bucket
			// the dashboard maps to "X402 SIWX".
			await db`
				INSERT INTO requests (id, vault_id, api_key_id, action_type, idempotency_key, request_json, decision, tx_status)
				VALUES (
					${requestId}, ${params.vaultId}, ${params.apiKeyId}, 'x402_siwx',
					${params.idempotencyKey}, ${JSON.stringify(requestJson)},
					'approved', 'authorized'
				)
				ON CONFLICT (vault_id, idempotency_key) DO NOTHING
			`;

			await txService.logActivity(
				params.vaultId,
				"x402_siwx_authorized",
				{
					originalRequestUrl: params.originalRequestUrl,
					domain: info.domain,
					chainId: chain.chainId,
					address,
					nonce: info.nonce,
					authorizedAt: new Date().toISOString(),
				},
				undefined,
				requestId,
			);

			return {
				requestId,
				status: "authorized" as const,
				signInWithXHeader,
				address,
				chainId: chain.chainId,
				expirationTime: info.expirationTime ?? null,
			};
		},
	};
}
