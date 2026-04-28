import { expect } from "chai";
import { loadConfig, TestApi } from "./setup.js";

describe("activity", () => {
	let cfg: ReturnType<typeof loadConfig>;
	let api: TestApi;
	before(() => {
		cfg = loadConfig();
		api = new TestApi(cfg);
	});

	it("recent test transactions appear in the activity log", async () => {
		const a = await api.listActivity({ limit: 25 });
		expect(a.items, "items array").to.be.an("array");
		// At minimum, this run produced one happy-path pay. After running
		// the full suite there should be several recent items.
		expect(a.items.length, "activity is non-empty").to.be.greaterThan(0);

		// The freshest entry should be from the current test session.
		const latest = a.items[0];
		expect(latest.createdAt, "createdAt").to.be.a("string");
		const latestTime = new Date(latest.createdAt).getTime();
		const fifteenMinAgo = Date.now() - 15 * 60 * 1000;
		expect(latestTime, "latest entry is from the last 15 minutes").to.be.greaterThan(fifteenMinAgo);
	});
});
