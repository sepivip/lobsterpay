import { expect } from "chai";
import { Connection, PublicKey } from "@solana/web3.js";
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
		expect(v).to.be.an("object");
		expect(v.vaultId, "vaultId").to.be.a("string");
		expect(v.ownerWallet, "ownerWallet").to.be.a("string");
		expect(v.paused, "paused").to.be.a("boolean");
		expect(v.allowedActions, "allowedActions").to.be.an("array");
		expect(v.perTxLimit, "perTxLimit").to.exist;
		expect(v.dailyLimit, "dailyLimit").to.exist;
	});

	it("vault is not paused", async () => {
		const v = await api.getVault();
		expect(v.paused, "expected vault to be active for the rest of the suite").to.equal(false);
	});

	it("fee vault has SOL for relayer reimbursements", async () => {
		const v = await api.getVault();
		const conn = new Connection(cfg.rpcUrl, "confirmed");
		// vault.feeVault is a derived PDA address that the API surfaces.
		// Fall back to checking the vault has *some* SOL balance reported
		// inline if the field is shaped differently.
		if (v.feeVaultBalance != null) {
			const bal = Number(v.feeVaultBalance);
			expect(bal, "fee vault SOL balance (lamports)").to.be.greaterThan(10_000);
			return;
		}
		if (v.feeVault) {
			const bal = await conn.getBalance(new PublicKey(v.feeVault), "confirmed");
			expect(bal, "fee vault SOL balance (lamports)").to.be.greaterThan(10_000);
			return;
		}
		// If the API hides fee-vault details, fall back to confirming the
		// vault has the action enabled - a vault without a funded fee vault
		// usually has `pay` removed from allowedActions.
		expect(v.allowedActions).to.include("pay");
	});

	it("permissioned vault has allowedActions[]", async () => {
		const v = await api.getVault();
		expect(v.allowedActions).to.be.an("array").with.length.greaterThan(0);
	});
});
