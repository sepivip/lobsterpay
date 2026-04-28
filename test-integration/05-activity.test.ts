import { expect } from "chai";
import { loadConfig, TestApi } from "./setup.js";

describe("activity", () => {
	let cfg: ReturnType<typeof loadConfig>;
	let api: TestApi;
	before(() => {
		cfg = loadConfig();
		api = new TestApi(cfg);
	});

	// The activity log lives at `/v1/vaults/:vaultId/activity` and is
	// owner-authenticated (ed25519 signed headers), not Bearer-API-key.
	// An agent therefore cannot read its own history via the agent
	// surface without holding the owner's signing key. That is the
	// intended boundary - the agent has spend authority, not read
	// authority over the owner's full audit log.
	//
	// This test is left as a placeholder so the gap is visible. When the
	// API exposes an agent-side activity endpoint (or accepts a
	// Bearer-key narrower view), drop the skip.
	it.skip("agent-side activity feed is not yet exposed (owner-only at /v1/vaults/:id/activity)", () => {
		void cfg;
		void api;
	});
});
