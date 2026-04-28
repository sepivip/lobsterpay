import { expect } from "chai";
import { confirmOnChain, freshIdempotencyKey, loadConfig, TestApi, txDigest } from "./setup.js";
import { CONFIRM_TIMEOUT_MS, HUGE_USDC_AMOUNT, SMALL_USDC_AMOUNT, SYSTEM_PROGRAM_ID } from "./fixtures.js";

describe("pay", () => {
	let cfg: ReturnType<typeof loadConfig>;
	let api: TestApi;
	before(() => {
		cfg = loadConfig();
		api = new TestApi(cfg);
	});

	it("happy path: sends a small USDC transfer and returns a confirmed tx signature", async () => {
		const idempotencyKey = freshIdempotencyKey("pay-happy");
		const res = await api.executePay({
			mint: cfg.usdcMint,
			amountAtomic: SMALL_USDC_AMOUNT,
			destinationOwner: cfg.testDestOwner,
			idempotencyKey,
			memo: "lobsterpay integration test",
		});
		expect(res.txSignature ?? res.signature, "tx signature in response").to.be.a("string");
		const sig = res.txSignature ?? res.signature;
		txDigest.push({ label: "pay (happy)", signature: sig });

		const ok = await confirmOnChain(cfg.rpcUrl, sig, CONFIRM_TIMEOUT_MS);
		expect(ok, `tx ${sig} should confirm on chain within ${CONFIRM_TIMEOUT_MS}ms`).to.equal(true);
	});

	it("idempotency: same key returns the same signature without producing a new tx", async () => {
		const idempotencyKey = freshIdempotencyKey("pay-idem");
		const first = await api.executePay({
			mint: cfg.usdcMint,
			amountAtomic: SMALL_USDC_AMOUNT,
			destinationOwner: cfg.testDestOwner,
			idempotencyKey,
		});
		const second = await api.executePay({
			mint: cfg.usdcMint,
			amountAtomic: SMALL_USDC_AMOUNT,
			destinationOwner: cfg.testDestOwner,
			idempotencyKey,
		});
		const sig1 = first.txSignature ?? first.signature;
		const sig2 = second.txSignature ?? second.signature;
		expect(sig2, "second call should return the cached signature").to.equal(sig1);
		txDigest.push({ label: "pay (idempotent retry)", signature: sig1 });
	});

	it("over-limit: amount > perTxLimit is rejected with 4xx and a policy error code", async () => {
		try {
			await api.executePay({
				mint: cfg.usdcMint,
				amountAtomic: HUGE_USDC_AMOUNT,
				destinationOwner: cfg.testDestOwner,
				idempotencyKey: freshIdempotencyKey("pay-overlimit"),
			});
			expect.fail("expected over-limit pay to throw");
		} catch (err: any) {
			expect(err.status, "HTTP status").to.be.oneOf([400, 403, 422]);
			// Error shape varies by reason; check the whole response surface
			// rather than a specific field name.
			const haystack = JSON.stringify({
				body: err.body,
				code: err.code,
				message: err.message,
			}).toLowerCase();
			expect(haystack, "error mentions limit / policy / amount / exceed / max").to.match(
				/limit|policy|amount|exceed|max/,
			);
		}
	});

	it("rejected dest: pay to an obviously not-allowlisted dest is rejected (or vault has empty allowlist)", async () => {
		const v = await api.getVault();
		const allowlist: string[] = v?.destinationAllowlist ?? v?.policy?.destinationAllowlist ?? [];
		if (allowlist.length === 0) {
			// allow-all policy. Skip rather than fail.
			console.log("    (skip) destinationAllowlist is empty - allow-all policy");
			return;
		}
		try {
			await api.executePay({
				mint: cfg.usdcMint,
				amountAtomic: SMALL_USDC_AMOUNT,
				destinationOwner: SYSTEM_PROGRAM_ID,
				idempotencyKey: freshIdempotencyKey("pay-baddest"),
			});
			expect.fail("expected pay to non-allowlisted dest to throw");
		} catch (err: any) {
			expect(err.status).to.be.oneOf([400, 403, 422]);
			expect(String(err.body?.code ?? err.code ?? "").toLowerCase()).to.match(
				/dest|allowlist|policy/,
			);
		}
	});
});
