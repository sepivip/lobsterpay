import { Section } from "./section";
import { CodeBlock } from "./code-block";

const CURL = `curl -H "Authorization: Bearer lp_live_xxx" \\
  https://api.lobsterpay.xyz/v1/agent/vault
# → { vaultPda, balances, permissions: { maxPerTxAmountAtomic, ... } }`;

const SDK_TS = `import { LobsterPay } from "@lobsterpay/sdk";

const lp = new LobsterPay({ apiKey: process.env.LOBSTERPAY_API_KEY! });

await lp.pay({
  mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  amountAtomic: "1000000",                              // 1.00 USDC
  destinationOwner: "ByPCbo5cPAm8JuBvoEXLxGYr9fyQLnMF21KUoWRNkxa",
  memo: "agent invoice #42",
});`;

const MCP = `{
  "mcpServers": {
    "lobsterpay": {
      "command": "npx",
      "args": ["-y", "@lobsterpay/mcp-server"],
      "env": { "LOBSTERPAY_API_KEY": "lp_live_xxx" }
    }
  }
}`;

export function DevQuickstart() {
	return (
		<Section
			id="quickstart"
			eyebrow="DEVELOPER QUICKSTART"
			title="Four lines to a paying agent"
			blurb="Any HTTP client works. The SDK is optional - just hit the REST endpoints with a Bearer key. If your agent speaks MCP, drop our config in and it picks up 6 tools instantly."
		>
			<div className="quickstart-grid">
				<CodeBlock label="CURL · REST" code={CURL} />
				<CodeBlock label="TYPESCRIPT SDK" code={SDK_TS} />
				<CodeBlock label="MCP · CLAUDE / CURSOR" code={MCP} />
			</div>
		</Section>
	);
}
