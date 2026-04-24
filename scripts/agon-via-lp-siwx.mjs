#!/usr/bin/env node
// End-to-end regression test for LobsterPay's SIWX-mode x402 adapter
// against agonx402's Tokens API (auth-only, no payment).
//
// Three steps:
//   1. GET agon's wallet-gated URL -> 402 with `accepts: []` and a SIWX
//      challenge in `extensions["sign-in-with-x"]` (CAIP-122 envelope).
//   2. POST the raw `Payment-Required` header to LobsterPay's
//      /v1/agent/actions/x402-siwx -> server signs the canonical SIWS
//      message with the relayer ed25519 keypair and returns a base64
//      `signInWithXHeader` ready to use as the `SIGN-IN-WITH-X` header.
//   3. GET agon's URL again with `SIGN-IN-WITH-X: <header>` -> 200 + the
//      Tokens API JSON response.

import fs from "node:fs";

const env = Object.fromEntries(
	fs
		.readFileSync(".env", "utf8")
		.split(/\r?\n/)
		.filter((l) => l.includes("="))
		.map((l) => {
			const i = l.indexOf("=");
			return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
		}),
);
const LP_KEY = env.LOBSTERPAY_API;
const LP_BASE = env.LOBSTERPAY_API_URL || "https://api.lobsterpay.xyz";
if (!LP_KEY) {
	console.error("LOBSTERPAY_API missing from .env (paste a vault-issued key).");
	process.exit(1);
}

const AGON_URL =
	"https://gateway.agonx402.com/v1/x402/tokens/assets/solana/profile";

const hr = (t) => console.log(`\n=== ${t} ===`);

// 1. unauthenticated GET — expect 402 + Payment-Required
hr("1. GET agon (no auth) - expect 402 + Payment-Required header");
const r1 = await fetch(AGON_URL);
console.log("status:", r1.status);
if (r1.status !== 402) {
	console.error("Expected 402, got", r1.status);
	process.exit(1);
}
const prHeader = r1.headers.get("payment-required");
if (!prHeader) {
	console.error("No Payment-Required header on the 402 response");
	process.exit(1);
}
const decoded = JSON.parse(Buffer.from(prHeader, "base64").toString("utf8"));
const siwx = decoded.extensions?.["sign-in-with-x"];
if (!siwx) {
	console.error("Payment-Required has no sign-in-with-x extension");
	process.exit(1);
}
console.log("x402Version:", decoded.x402Version);
console.log("accepts.length:", decoded.accepts?.length);
console.log("siwx.info.domain:", siwx.info?.domain);
console.log("siwx.supportedChains:", siwx.supportedChains?.map((c) => c.chainId));

// 2. LobsterPay SIWX
hr("2. POST LobsterPay /v1/agent/actions/x402-siwx");
const r2 = await fetch(`${LP_BASE}/v1/agent/actions/x402-siwx`, {
	method: "POST",
	headers: {
		Authorization: `Bearer ${LP_KEY}`,
		"Content-Type": "application/json",
	},
	body: JSON.stringify({
		paymentRequiredHeader: prHeader,
		originalRequestUrl: AGON_URL,
		// Pin to devnet so the relayer signs against the cluster the upstream is on.
		chainId: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
	}),
});
console.log("status:", r2.status);
const j2 = await r2.json();
console.log("requestId:", j2.requestId);
console.log("address:", j2.address);
console.log("chainId:", j2.chainId);
console.log("expirationTime:", j2.expirationTime);
console.log("signInWithXHeader present:", !!j2.signInWithXHeader);
if (!j2.signInWithXHeader) {
	console.error("\nFull LobsterPay response:");
	console.error(JSON.stringify(j2, null, 2));
	process.exit(1);
}

// 3. retry agon with SIGN-IN-WITH-X header
hr("3. GET agon with SIGN-IN-WITH-X - expect 200 + tokens result");
const r3 = await fetch(AGON_URL, {
	headers: { "SIGN-IN-WITH-X": j2.signInWithXHeader },
});
console.log("status:", r3.status);
const body = await r3.text();
console.log("body (first 600 chars):", body.slice(0, 600));

if (r3.status !== 200) {
	console.error("\nFinal call did not return 200 — integration broken.");
	process.exit(1);
}

console.log("\n✅ End-to-end agon-via-LobsterPay-SIWX flow PASSED.");
