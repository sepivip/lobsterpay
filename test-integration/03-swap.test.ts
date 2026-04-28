import { expect } from "chai";
import { freshIdempotencyKey, loadConfig, TestApi } from "./setup.js";
import { SMALL_USDC_AMOUNT, WSOL_MINT } from "./fixtures.js";

describe("swap", () => {
	let cfg: ReturnType<typeof loadConfig>;
	let api: TestApi;
	before(() => {
		cfg = loadConfig();
		api = new TestApi(cfg);
	});

	it("quote: USDC -> SOL returns a quote with a route", async () => {
		const q = await api.createSwapQuote({
			fromMint: cfg.usdcMint,
			toMint: WSOL_MINT,
			amountAtomic: SMALL_USDC_AMOUNT,
		});
		expect(q, "quote response").to.be.an("object");
		expect(q.expectedOut ?? q.outAmount ?? q.amountOut, "expected out amount").to.exist;
		expect(q.routeSummary ?? q.route ?? q.routes, "route info").to.exist;
	});

	it("execute: returns the documented `unsupported` shape (on-chain swap is currently a stub)", async () => {
		// `execute_swap_exact_in` is a stub on chain that returns
		// UnsupportedFeature. The backend service should surface this as a
		// clean 4xx with a recognizable code rather than an opaque 500.
		try {
			await api.executeSwap({
				fromMint: cfg.usdcMint,
				toMint: WSOL_MINT,
				amountAtomic: SMALL_USDC_AMOUNT,
				maxSlippageBps: 100,
				idempotencyKey: freshIdempotencyKey("swap-exec"),
			});
			expect.fail("expected swap execute to throw against the on-chain stub");
		} catch (err: any) {
			expect(err.status, "HTTP status").to.be.oneOf([400, 403, 422, 501, 503]);
			expect(
				String(err.body?.code ?? err.code ?? err.message ?? "").toLowerCase(),
				"error mentions unsupported / unavailable",
			).to.match(/unsupported|unavailable|not.*implement|stub|swap/);
		}
	});
});
