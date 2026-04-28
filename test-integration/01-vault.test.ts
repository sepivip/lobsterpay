import { expect } from "chai";
import { loadConfig, TestApi } from "./setup.js";

describe("vault", () => {
	let cfg: ReturnType<typeof loadConfig>;
	let api: TestApi;
	before(() => {
		cfg = loadConfig();
		api = new TestApi(cfg);
	});

	it("GET /v1/agent/vault returns the expected shape", async () => {
		const v = await api.getVault();
		expect(v, "response").to.be.an("object");
		expect(v.vaultPda, "vaultPda").to.be.a("string");
		expect(v.balances, "balances[]").to.be.an("array");
		expect(v.permissions, "permissions").to.be.an("object");
		expect(v.permissions.allowedActions, "allowedActions bitmask").to.be.a("number");
		expect(v.permissions.maxPerTxAmountAtomic, "maxPerTxAmountAtomic").to.be.a("string");
		expect(v.permissions.dailyLimitAmountAtomic, "dailyLimitAmountAtomic").to.be.a("string");
	});

	it("vault has at least one token balance with a non-zero amount", async () => {
		const v = await api.getVault();
		expect(v.balances.length, "non-empty balances").to.be.greaterThan(0);
		const positive = v.balances.find((b: any) => Number(b.uiAmount ?? b.amount ?? 0) > 0);
		expect(positive, "at least one positive token balance").to.exist;
	});

	it("permissions allow at least one action (allowedActions bitmask > 0)", async () => {
		const v = await api.getVault();
		expect(v.permissions.allowedActions, "allowedActions bitmask").to.be.greaterThan(0);
	});

	it("daily spent is below the daily limit", async () => {
		const v = await api.getVault();
		const limit = BigInt(v.permissions.dailyLimitAmountAtomic);
		const spent = BigInt(v.permissions.dailySpentAmountAtomic ?? "0");
		expect(spent <= limit, "dailySpent should be <= dailyLimit").to.equal(true);
	});
});
