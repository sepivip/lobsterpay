import { expect } from "chai";
import { loadConfig, TestApi } from "./setup.js";

describe("auth", () => {
	let cfg: ReturnType<typeof loadConfig>;
	let api: TestApi;
	before(() => {
		cfg = loadConfig();
		api = new TestApi(cfg);
	});

	it("missing Authorization header returns 401", async () => {
		try {
			await api.requestRaw("GET", "/v1/agent/vault", undefined, null);
			expect.fail("expected 401");
		} catch (err: any) {
			expect(err.status).to.equal(401);
		}
	});

	it("malformed bearer returns 401", async () => {
		try {
			await api.requestRaw("GET", "/v1/agent/vault", undefined, "Bearer not-a-real-key");
			expect.fail("expected 401");
		} catch (err: any) {
			expect(err.status).to.equal(401);
		}
	});

	it("non-bearer scheme returns 401", async () => {
		try {
			await api.requestRaw("GET", "/v1/agent/vault", undefined, "Basic Zm9vOmJhcg==");
			expect.fail("expected 401");
		} catch (err: any) {
			expect(err.status).to.equal(401);
		}
	});
});
