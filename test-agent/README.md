# Agent runner

An LLM agent (Claude, via the Anthropic SDK) buys content from the LobsterPay demo paywall using a vault-issued API key. Same flows that `test-integration/` exercises directly, but routed through real tool-calling.

The integration tests prove **the API works**. This proves **an agent can use the API**. Two different proofs; the second is what the hackathon video shows.

## What it does

The script defines four tools that wrap LobsterPay calls (`check_vault`, `peek_paywall`, `pay_x402`, `unlock`), hands them to Claude, and gives it a one-line task:

> Buy me a fortune from the LobsterPay demo paywall. Show me the fortune and the on-chain tx signature.

Claude reasons through the flow, picks tools in order, and the tool runner executes them. The final output is the fortune + a Solscan-ready signature - a clean clip for the demo video.

## Configure

Same `.env.integration` as `test-integration/` plus one new var:

```
LOBSTERPAY_API_KEY=lp_live_...           # vault-issued key (also accepts LOBSTERPAY_API)
LOBSTERPAY_API_URL=https://api.lobsterpay.xyz
ANTHROPIC_API_KEY=sk-ant-...             # required for the agent
```

## Run

```bash
pnpm test:agent
```

Output is the live agent transcript: tool calls, streamed response, and the final tx signature.

## Picking the model

Defaults to `claude-opus-4-7` with adaptive thinking + `effort: "high"`. For a faster but less reasoned demo, override at the top of `buy-fortune.ts` (model string + drop the thinking block).
