/**
 * Mocha config for the integration suite at test-integration/.
 * Uses tsx to run TypeScript without a precompile step, and sets a
 * generous timeout because tests involve real RPC calls and on-chain
 * confirmation polling.
 */
module.exports = {
	require: ["tsx"],
	extension: ["ts"],
	spec: ["test-integration/**/*.test.ts"],
	timeout: 90_000,
	reporter: "spec",
	"node-option": ["import=tsx", "no-warnings"],
};
