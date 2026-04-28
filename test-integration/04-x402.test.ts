import { expect } from "chai";
import { confirmOnChain, freshIdempotencyKey, loadConfig, TestApi, txDigest } from "./setup.js";
import { CONFIRM_TIMEOUT_MS } from "./fixtures.js";

describe("x402", () => {
	let cfg: ReturnType<typeof loadConfig>;
	let api: TestApi;
	before(() => {
		cfg = loadConfig();
		api = new TestApi(cfg);
	});

	/** LobsterPay ships its own /v1/demo/x402/* endpoints that emit a
	 *  signature-verifying 402 - this exercises pure submit-mode end to
	 *  end without depending on any external gateway. */
	it("submit mode: settles a payment to lobsterpay's own demo paywall and the upstream returns 200", async () => {
		const demoUrl = `${cfg.apiUrl}/v1/demo/x402/fortune`;
		const r1 = await fetch(demoUrl);
		expect(r1.status, "first call to demo paywall returns 402").to.equal(402);
		const headerVal = r1.headers.get("payment-required");
		const inlineBody = await r1.text();
		// LobsterPay's demo paywall sends the payment-required header as
		// raw JSON; agonx402-style gateways base64-encode it. Try parsing
		// raw first, fall back to base64-decode, and finally to the body.
		const decoded = (() => {
			if (headerVal) {
				try {
					return JSON.parse(headerVal);
				} catch {
					try {
						return JSON.parse(Buffer.from(headerVal, "base64").toString("utf8"));
					} catch {
						/* fall through to body */
					}
				}
			}
			return JSON.parse(inlineBody);
		})();
		const requirements = decoded.accepts?.[0] ?? decoded.paymentRequirements ?? decoded;

		const settle = await api.executeX402({
			paymentRequirements: requirements,
			originalRequestUrl: demoUrl,
			idempotencyKey: freshIdempotencyKey("x402-submit"),
		});
		const sig = settle.txSignature ?? settle.signature;
		const paymentHeader = settle.xPaymentHeader ?? settle.paymentHeader ?? settle.paymentSignatureHeader;
		expect(sig, "settle returned a tx signature").to.be.a("string");
		expect(paymentHeader, "settle returned an X-PAYMENT / payment header").to.be.a("string");
		txDigest.push({ label: "x402 submit", signature: sig });

		const ok = await confirmOnChain(cfg.rpcUrl, sig, CONFIRM_TIMEOUT_MS);
		expect(ok, "settle tx confirmed on chain").to.equal(true);

		const r2 = await fetch(demoUrl, {
			headers: {
				"PAYMENT-SIGNATURE": paymentHeader,
				"X-PAYMENT": paymentHeader,
			},
		});
		expect(r2.status, "retry with payment header returns 200").to.equal(200);
	});

	/** Facilitator and SIWX modes hit a real external gateway. They are
	 *  the most useful proof-of-flow for the demo video but they are not
	 *  guaranteed to be reachable from CI - skip via SKIP_EXTERNAL=1. */
	it("facilitator mode: completes the two-tx flow against an x402 facilitator gateway", async function () {
		if (cfg.skipExternal) return this.skip();
		const upstream = "https://gateway.agonx402.com/v1/x402/solana/devnet/helius/rpc/getAccountInfo";
		const r1 = await fetch(upstream, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ params: ["11111111111111111111111111111111"] }),
		});
		if (r1.status !== 402) {
			return this.skip();
		}
		const headerB64 = r1.headers.get("payment-required");
		if (!headerB64) return this.skip();
		const decoded = JSON.parse(Buffer.from(headerB64, "base64").toString("utf8"));
		const requirements = decoded.accepts?.[0];
		if (!requirements?.extra?.feePayer) {
			return this.skip();
		}

		const res = await api.executeX402Facilitator({
			paymentRequirements: requirements,
			originalRequestUrl: upstream,
			idempotencyKey: freshIdempotencyKey("x402-facil"),
		});
		expect(res.status ?? res.txStatus, "status field").to.match(/awaiting_facilitator|confirmed/);
		expect(res.tx1Signature ?? res.txSignature ?? res.signature, "tx1 signature").to.be.a("string");
		const sig1 = res.tx1Signature ?? res.txSignature ?? res.signature;
		txDigest.push({ label: "x402 facilitator tx1 (vault->relayer)", signature: sig1 });
		const ok = await confirmOnChain(cfg.rpcUrl, sig1, CONFIRM_TIMEOUT_MS);
		expect(ok, "tx1 confirmed on chain").to.equal(true);
	});

	it("SIWX mode: signs a Sign-In-With-X challenge for an auth-only x402 route", async function () {
		if (cfg.skipExternal) return this.skip();
		const upstream = "https://gateway.agonx402.com/v1/x402/tokens/list";
		const r1 = await fetch(upstream);
		if (r1.status !== 402) {
			return this.skip();
		}
		const headerB64 = r1.headers.get("payment-required");
		if (!headerB64) return this.skip();
		const decoded = JSON.parse(Buffer.from(headerB64, "base64").toString("utf8"));
		const challenge = decoded?.extensions?.["sign-in-with-x"];
		if (!challenge) return this.skip();

		const res = await api.executeX402Siwx({
			siwxChallenge: challenge,
			originalRequestUrl: upstream,
			idempotencyKey: freshIdempotencyKey("x402-siwx"),
		});
		expect(res.signInWithXHeader ?? res.siwxHeader, "SIWX header").to.be.a("string");
	});
});
