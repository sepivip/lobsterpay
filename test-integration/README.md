# Integration tests

End-to-end tests that hit the live LobsterPay API on Solana **devnet** with a real API key. Each test exercises one or more endpoints, verifies the response shape, and (for tx-producing actions) confirms the resulting transaction on chain.

These are **separate** from the Anchor program tests in `tests/lobsterpay.ts` - that suite spins up a local validator and tests the on-chain program in isolation. This suite tests the full stack.

## Prereqs

The vault behind your API key needs:

- ~0.05 SOL in the FeeVault for relayer reimbursements
- ~1 USDC (devnet mint `Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr`) so a small transfer per run has headroom
- The `TEST_DEST_OWNER` pubkey added to the policy's destination allowlist (or an empty allowlist = allow-all)
- Per-tx limit ≥ 100,000 atomic (0.1 USDC), daily limit ≥ 1,000,000 atomic (1 USDC)

## Configure

Copy `.env.integration.example` → `.env.integration` (gitignored) at the repo root and fill in:

```
LOBSTERPAY_API_KEY=lp_live_...
LOBSTERPAY_API_URL=https://api.lobsterpay.xyz
TEST_DEST_OWNER=<a devnet pubkey that can receive USDC; do NOT use a personal wallet>
SOLANA_RPC_URL=https://api.devnet.solana.com
```

Optional:

```
SKIP_EXTERNAL=1   # skip facilitator/SIWX tests that depend on an external gateway
```

## Run

```bash
pnpm test:integration
```

Each test logs the on-chain tx signature it produced. The summary at the end lists every signature so you can paste them into Solscan or use them as proof in a demo video.

## What's covered

| Suite | Tests | Endpoints |
|---|---|---|
| `01-vault` | shape, balances, limits | `GET /v1/agent/vault` |
| `02-pay` | happy path, idempotency, rejected dest, over-limit | `POST /v1/agent/actions/pay` |
| `03-swap` | quote, execute (currently `UnsupportedFeature` per on-chain stub) | `POST /v1/agent/quotes/swap`, `POST /v1/agent/actions/swap` |
| `04-x402` | submit mode, facilitator mode, SIWX mode | `POST /v1/agent/actions/{x402,x402-facilitator,x402-siwx}` |
| `05-activity` | recent activity visible | `GET /v1/agent/vault/activity` |
| `06-auth` | bad / missing bearer | All Bearer-protected endpoints |

## Costs per run

- One real devnet `transfer_checked` tx per pay test (~0.0001 USDC each)
- One devnet swap quote (free; doesn't execute)
- One x402 submit tx + one facilitator two-tx flow (skip via `SKIP_EXTERNAL=1` if you don't want to depend on an external gateway)

Run cost is well under 0.01 USDC + a few thousand lamports of SOL per run.

## Output for the demo video

After all tests pass, the runner prints a compact "tx digest" block:

```
=== TX DIGEST ===
pay (happy):           <signature>
pay (idempotent retry): <signature>  (same as above)
x402 submit:           <signature>
x402 facilitator tx1:  <signature>
x402 facilitator tx2:  <signature>
=================
```

This is the bit you screen-record / paste into the hackathon submission.
