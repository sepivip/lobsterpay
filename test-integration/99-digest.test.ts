import { txDigest } from "./setup.js";

/**
 * Always-last "test" that prints the tx-signature digest. Lives as its
 * own describe block because mocha sorts files by name and 99- is a
 * cheap way to guarantee it runs after everything else. Skipped when
 * no signatures were collected (e.g. only running auth tests).
 */
describe("tx digest", () => {
	it("prints all on-chain signatures captured during the run", function () {
		if (txDigest.length === 0) return this.skip();
		console.log("");
		console.log("=== TX DIGEST ===");
		const labelWidth = Math.max(...txDigest.map((e) => e.label.length));
		for (const e of txDigest) {
			console.log(`${e.label.padEnd(labelWidth + 2)}${e.signature}`);
		}
		console.log("=================");
		console.log("Solscan devnet: https://solscan.io/tx/<sig>?cluster=devnet");
	});
});
