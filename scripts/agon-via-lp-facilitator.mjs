#!/usr/bin/env node
// End-to-end regression test of LobsterPay's facilitator-mode x402 flow
// against agonx402 (the third-party gateway that brought the
// "facilitator interop" question into focus during LP-014).
//
// Three steps:
//   1. POST agon's paywalled URL -> 402 with payment requirements in the
//      `Payment-Required` response header (base64 JSON, x402Version: 2,
//      `accepts: [...]` envelope per the spec).
//   2. POST those requirements to LobsterPay's
//      /v1/agent/actions/x402-facilitator -> server settles tx1 (vault
//      -> relayer USDC ATA, 1.5% to treasury) and returns a base64
//      paymentSignatureHeader containing a partial-signed v0
//      transferChecked tx the agon facilitator can co-sign + submit.
//   3. POST agon's URL again with PAYMENT-SIGNATURE: <header> -> agon
//      submits tx2 and returns 200 + actual upstream RPC response +
//      a base64 PAYMENT-RESPONSE settlement receipt.
//
// First successful run: 2026-04-24, txs 5N61j... (tx1) and 2vanr... (tx2)
// against gateway.agonx402.com getAccountInfo on devnet.
//
// Requirements: .env with LOBSTERPAY_API set to a vault-issued API key.
// Override LOBSTERPAY_API_URL to point at a non-prod LobsterPay if you
// need to test a local API. AGON_URL / RPC_BODY can be tweaked below to
// hit a different paywalled route on agon.

import fs from "node:fs";

// ── env loading (no parser dep - single-line .env values only) ─────────
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

// Adjust these to test against a different agon route.
const AGON_URL =
	"https://gateway.agonx402.com/v1/x402/solana/devnet/helius/rpc/getAccountInfo";
const RPC_BODY = {
	params: ["EVfTBY7prqCDMU3LYHAe1LBDpHfjughceYmicBLB8atF"],
};

const hr = (t) => console.log(`\n=== ${t} ===`);

// ── 1. POST agon, decode 402 ───────────────────────────────────────────
hr("1. POST agon (no payment) - expect 402 + Payment-Required header");
const r1 = await fetch(AGON_URL, {
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify(RPC_BODY),
});
console.log("status:", r1.status);
if (r1.status !== 402) {
	console.error("Expected 402, got", r1.status);
	console.error("body:", (await r1.text()).slice(0, 400));
	process.exit(1);
}
// agon delivers the requirements as a base64 JSON in `Payment-Required`,
// NOT in the response body (the body is a tiny human-readable error stub).
// This is per x402 v2 spec - the body is opaque, the header is canonical.
const prHeader =
	r1.headers.get("payment-required") || r1.headers.get("Payment-Required");
if (!prHeader) {
	console.error("No Payment-Required header on the 402 response");
	process.exit(1);
}
const prBody = JSON.parse(Buffer.from(prHeader, "base64").toString("utf8"));
const pr = prBody.accepts?.[0];
if (!pr) {
	console.error("Payment-Required header has no accepts[0]");
	console.error(JSON.stringify(prBody, null, 2));
	process.exit(1);
}
console.log("x402Version:", prBody.x402Version);
console.log("accepts[0]:", JSON.stringify(pr, null, 2));

// ── 2. LobsterPay facilitator-mode ─────────────────────────────────────
hr("2. POST LobsterPay /v1/agent/actions/x402-facilitator");
const r2 = await fetch(`${LP_BASE}/v1/agent/actions/x402-facilitator`, {
	method: "POST",
	headers: {
		Authorization: `Bearer ${LP_KEY}`,
		"Content-Type": "application/json",
	},
	body: JSON.stringify({
		paymentRequirements: pr,
		originalRequestUrl: AGON_URL,
	}),
});
console.log("status:", r2.status);
const j2Raw = await r2.text();
let j2;
try {
	j2 = JSON.parse(j2Raw);
} catch {
	console.error("Non-JSON response from LobsterPay:", j2Raw.slice(0, 500));
	process.exit(1);
}
console.log("status field:", j2.status);
console.log("requestId:", j2.requestId);
console.log("tx1Signature:", j2.tx1Signature);
console.log("error:", j2.error);
console.log(
	"grossAmount:",
	j2.grossAmount,
	"agonAmount:",
	j2.agonAmount,
	"serviceFee:",
	j2.serviceFee,
);
console.log("paymentSignatureHeader present:", !!j2.paymentSignatureHeader);
if (!j2.paymentSignatureHeader) {
	console.error("\nFull LobsterPay response:");
	console.error(JSON.stringify(j2, null, 2));
	process.exit(1);
}

// ── 3. Retry agon with PAYMENT-SIGNATURE ───────────────────────────────
hr("3. POST agon with PAYMENT-SIGNATURE - expect 200 + RPC result");
const r3 = await fetch(AGON_URL, {
	method: "POST",
	headers: {
		"Content-Type": "application/json",
		"PAYMENT-SIGNATURE": j2.paymentSignatureHeader,
	},
	body: JSON.stringify(RPC_BODY),
});
console.log("status:", r3.status);
const j3Raw = await r3.text();
console.log("body:", j3Raw.slice(0, 1500));
const respHeader =
	r3.headers.get("payment-response") || r3.headers.get("PAYMENT-RESPONSE");
if (respHeader) {
	const decoded = JSON.parse(Buffer.from(respHeader, "base64").toString("utf8"));
	console.log("\nDecoded PAYMENT-RESPONSE:", JSON.stringify(decoded, null, 2));
}

if (r3.status !== 200) {
	console.error("\nFinal call did not return 200 - integration broken.");
	process.exit(1);
}

console.log("\n✅ End-to-end agon-via-LobsterPay-facilitator flow PASSED.");
