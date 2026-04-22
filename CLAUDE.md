# LobsterPay — Project Memory

> Persistent context for Claude Code sessions. Read this first.
>
> Last updated: 2026-04-18

## What LobsterPay is

A permissioned payment layer for AI agents on Solana. Owners create program-controlled vaults, fund them with SOL and SPL tokens, and issue API keys that let agents spend within pre-approved limits. The owner's private keys never leave their wallet — agents get scoped HTTP access, not signing authority.

Built for the **Solana Colosseum hackathon**.

**Revenue model:** 1.5% service fee (150 bps) taken from every payment → LobsterPay treasury. Plus per-tx fee reimbursement from user's fee vault → relayer hot wallet (self-sustaining).

## Live deployment

| Service | URL | Status |
|---|---|---|
| **Frontend** (Next.js) | https://lobsterpay.xyz | 🟢 Live (Railway + Cloudflare DNS) |
| **API** (Fastify) | https://api.lobsterpay.xyz | 🟢 Live, `/health` OK |
| **Postgres** | (Railway internal) | 🟢 9 migrations applied |
| **Anchor program** | `A184DBQaCM6qWETbEDJUtr25bSuuTH72sTTixsyoZbtS` | 🟢 Deployed on Solana **devnet** |
| **Program authority** | `2ALtGZpteopcZgKCcW6eHcSiwvLGkoqrnEGidsJe5Lq3` | 12.20 SOL remaining |
| **Treasury pubkey** | `DvcQMhZmhZZQ1CX6FhGkyAiPr3YtNbBuLDP3QpuBRTHp` | devnet placeholder |
| **GitHub** | https://github.com/sepivip/lobsterpay | public |

## Architecture

```
Agent (any HTTP client)
   ↓ API key (Bearer)
LobsterPay API (Fastify, Railway)
   ├─ Zod validation + policy enforcement (offchain)
   ├─ PostgreSQL: vaults, keys, requests, activity, usage_windows
   └─ Relayer hot wallet signs + submits txs
         ↓
LobsterPay Anchor program (Solana devnet)
   ├─ 11 instructions
   ├─ Vault PDA ["vault", owner]              → metadata
   ├─ Policy PDA ["policy", vault]            → limits, allowlists, agent
   ├─ FeeVault PDA ["fee_vault", owner]       → native SOL reserve
   └─ transfer_checked CPI: net → dest, 1.5% → treasury
```

## Fee economics (important)

Every agent payment:
1. Agent calls API with API key
2. Backend signs with relayer hot wallet (the `FEE_PAYER_SECRET_KEY`)
3. Relayer pays ~5,000 lamports Solana network fee
4. Program splits SPL transfer: 98.5% → destination, 1.5% → treasury
5. Program transfers `FEE_REIMBURSEMENT_LAMPORTS` (10,000) from user's FeeVault → relayer

**Net: relayer earns ~5,000 lamports profit per agent tx.** Self-sustaining and bounded — the 10k reimbursement cap is hardcoded in the program, relayer cannot drain user funds.

## Tech stack

- **Monorepo**: pnpm workspaces + turbo + biome
- **Anchor**: 0.31.1 (required — 0.30.1 is incompatible with Rust 1.92)
- **Backend**: Fastify 5, `postgres` driver (no ORM), Zod
- **Frontend**: Next.js 15 App Router, Tailwind v4, Solana wallet adapter, Geist font
- **Rust**: 1.92.0, Solana CLI 3.1.13, Cargo lock version 4

## Repository structure

```
apps/
  api/                       # Fastify backend
    src/
      solana/instructions.ts # Hand-rolled Anchor ix builders (NOT generated client)
      services/              # vault, apiKey, tx, swap, x402
      routes/                # vaults, agent, skills, config
      skills/                # Downloadable agent skill formats
      db/migrations/         # 9 SQL files
  web/                       # Next.js frontend
    src/lib/solana.ts        # Mirror of backend ix builders for wallet signing
    src/hooks/useVault.ts    # Core vault state + tx signing
    src/components/          # empty-state, require-wallet, deposit-fees-modal, nav
packages/
  shared/                    # Zod schemas + types shared by api+web
  sdk/                       # TypeScript SDK for agents
  mcp-server/                # MCP server for Claude Code / Claude Desktop agents
programs/
  lobsterpay/                # Anchor program (Rust)
    src/
      instructions/          # 11 instruction handlers
      state.rs               # Vault (74B), Policy (784B), FeeVault (66B)
      constants.rs           # Seeds, bps, fee reimbursement, treasury
      errors.rs              # 23 custom errors
      events.rs              # 11 events for indexing
tests/
  lobsterpay.ts              # 25 integration tests (all passing)
```

## Anchor program surface

**Owner-signed instructions:**
- `initialize_vault` — creates Vault + Policy PDAs. Takes optional `authorized_agent` pubkey at init (usually set to relayer hot wallet)
- `update_policy` — updates limits, allowlists, paused state
- `update_authorized_agent` — change who can act as agent
- `withdraw_owner` — owner pulls SPL tokens back
- `emergency_pause` — blocks all agent actions
- `initialize_fee_vault` — creates SOL reserve for agent tx fees
- `deposit_fees` — owner funds FeeVault with native SOL
- `withdraw_fees` — owner reclaims unused SOL (preserves rent-exempt minimum)
- `ensure_vault_token_account` — creates ATA for vault PDA (can be called by anyone, e.g. relayer)

**Relayer/owner-signed (authorized_agent check):**
- `execute_pay_exact` — 98.5% → destination, 1.5% → treasury, 10k lamports reimbursement from FeeVault
- `execute_swap_exact_in` — stub (returns UnsupportedFeature); Jupiter swap adapter exists in backend but onchain stub not finished

## Security audit status

Passed thorough audit (3 parallel review agents) + Solana-specific rubric from `review-and-iterate` skill. Grade: **B+**. Every Critical and Important finding fixed:

- ✅ `execute_pay_exact` authority check (was: any signer could drain)
- ✅ Daily limit window aligned (was: 2x spend at window edge)
- ✅ Atomic daily-limit reserve-and-check via SQL CTE (was: race condition)
- ✅ Vault owner routes authenticated via `X-Wallet-Address` header
- ✅ Transaction timeout → `pending_confirmation` status (was: false "failed")
- ✅ Frontend `update_policy` serialization order fixed (was: corrupt state)
- ✅ Input validation: Solana pubkey format, positive amounts, URL validation
- ✅ Fee payer drain protection via pre-flight balance check
- ✅ Error messages sanitized (real errors logged server-side)
- ✅ Duplicate account aliasing check in pay + withdraw (Solana skill audit)
- ✅ Compute budget instruction in backend tx builder

Remaining (non-blocking for hackathon):
- ⚠️ No `close` constraint on accounts — owner can't reclaim rent. Not a vuln.
- ⚠️ No fuzz tests (Trident)
- ⚠️ No account-closing instructions for vault lifecycle

## What's done

- ✅ Full Anchor program with 11 instructions, 25 passing tests
- ✅ Fastify backend with full CRUD + agent endpoints + skill downloads + service config endpoint
- ✅ Next.js dashboard: landing, dashboard, keys, policy, activity, integrate, deposit modal
- ✅ Design system: Geist fonts, tight tracking, pill buttons, dashed focus, CSS classes (not inline styles)
- ✅ `@lobsterpay/shared` Zod schemas + types
- ✅ `@lobsterpay/sdk` TypeScript client
- ✅ `@lobsterpay/mcp-server` MCP server for Claude agents (6 tools)
- ✅ 4 agent skill formats: Skill JSON, Agent Prompt, OpenAPI 3.0, MCP Config
- ✅ Railway deployment (API + Web + Postgres)
- ✅ Anchor program deployed + upgraded on devnet (program ID `A184...ZbtS`)
- ✅ End-to-end smoke test passed: wallet connect → create vault → init fee vault → deposit SOL → manage keys → set policy
- ✅ 1.5% service fee + fee reimbursement economics wired onchain
- ✅ Skill versioning system with `/v1/skills/version` polling endpoint

## What's left

### 🔴 Critical to ship (enable agent payments)

1. **Generate relayer hot wallet + set `FEE_PAYER_SECRET_KEY` in Railway**
   - Currently `/v1/config/relayer` returns `{ configured: false }`
   - Without this, agents **cannot** pay/swap via API key
   - See bottom of this doc for the exact commands

2. **Fund relayer with ~0.1 SOL on devnet** to bootstrap (gets reimbursed after)

3. **Test end-to-end agent flow**: create API key → hit `/v1/agent/actions/pay` from curl/SDK → verify onchain tx → verify relayer got reimbursed

### 🟡 Nice to have before hackathon submission

4. **Finish swap onchain** — the Jupiter swap adapter in the backend is complete but the `execute_swap_exact_in` instruction is a stub. Either:
   - Finish the onchain instruction (Jupiter CPI), OR
   - Document swap as Phase-2, demo only pay + x402

5. **Replace devnet treasury** with a fresh one you control → paste its pubkey into `programs/lobsterpay/src/constants.rs` → redeploy. Current treasury keypair is in `.env.deploy` only (not production).

6. **Wire x402 onchain** — adapter exists, endpoint exists, but the actual tx isn't submitted (it's just recorded). Follow the same pattern as `execute_pay_exact`.

7. **Polish for demo**:
   - Add a "copy vault address" button
   - Show treasury tx history somewhere
   - Record a demo video

### 🟢 Post-hackathon

8. **Audit + mainnet deploy** — formal audit recommended before mainnet
9. **Session keys (v2)** — cryptographically scoped signing keys instead of API keys
10. **Multi-vault per owner** (currently 1 vault per wallet)
11. **Bridging / multi-chain**
12. **Fuzz tests (Trident)** before TVL grows

## Critical gotchas (do not repeat)

1. **`API_PORT` on Railway must be literal `8080`**, not `${{PORT}}`. Template syntax doesn't work for the built-in PORT var.
2. **`usb`/`node-hid` native compile** breaks Railway Nixpacks — `pnpm.neverBuiltDependencies` in root package.json skips them.
3. **Anchor 0.30.1 is incompatible** with modern Rust. Use 0.31.1. Solana 1.x on Windows can't build it — use macOS/Linux/WSL.
4. **`Cargo.lock` version 4** is correct — don't downgrade.
5. **A DB vault row exists ≠ onchain vault exists.** If Create Vault fails mid-flow (user dismisses wallet popup), you get split-brain. Frontend hides the button on any DB row — clean the DB if this happens.
6. **"Wallet simulation failed" = program doesn't exist at that address.** Verify with `solana program show <id>` before debugging frontend.
7. **Phantom must be on Devnet** (Settings → Developer Settings → Network = Devnet).
8. **`verifyVaultOwnership`** was querying a non-existent column. Fixed. If you see Postgres error `42703`, check other queries for the same bug.
9. **Devnet faucet is rate-limited.** Use https://faucet.solana.com/ web UI if CLI airdrop fails.
10. **Railway auto-redeploys on push.** Frontend rebuild is slow (~2-3 min) because `NEXT_PUBLIC_*` gets baked into the client bundle at build time.

## Deploy secrets (reference only — never commit)

`.env.deploy` (gitignored, in password manager):
- `PROGRAM_KEYPAIR` — base58 of program id keypair (deterministic address)
- `PROGRAM_ID` — `A184DBQaCM6qWETbEDJUtr25bSuuTH72sTTixsyoZbtS`
- `DEPLOYER_KEYPAIR` — base58 of the upgrade authority keypair
- `DEPLOYER_ADDRESS` — `2ALtGZpteopcZgKCcW6eHcSiwvLGkoqrnEGidsJe5Lq3`

To decode + deploy:
```bash
source .env.deploy
python3 -c "
import base58, json
with open('target/deploy/lobsterpay-keypair.json', 'w') as f:
    json.dump(list(base58.b58decode('$PROGRAM_KEYPAIR')), f)
with open('/tmp/lobsterpay-deployer.json', 'w') as f:
    json.dump(list(base58.b58decode('$DEPLOYER_KEYPAIR')), f)
"
anchor build
anchor deploy --provider.cluster devnet --provider.wallet /tmp/lobsterpay-deployer.json
rm /tmp/lobsterpay-deployer.json
```

## Railway env vars (reference)

**API service** (`@lobsterpay/api`):
- `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
- `SOLANA_RPC_URL` = `https://api.devnet.solana.com`
- `SOLANA_CLUSTER` = `devnet`
- `LOBSTERPAY_PROGRAM_ID` = `A184DBQaCM6qWETbEDJUtr25bSuuTH72sTTixsyoZbtS`
- `PUBLIC_API_URL` = `https://api.lobsterpay.xyz`
- `API_PORT` = `8080`  ← literal number, not `${{PORT}}`
- `API_HOST` = `0.0.0.0`
- `LOG_LEVEL` = `info`
- `FEE_PAYER_SECRET_KEY` = **NOT SET YET** ← critical gap
- `ALLOWED_ORIGIN` = `https://lobsterpay.xyz`

**Web service** (`@lobsterpay/web`):
- `NEXT_PUBLIC_API_URL` = `https://api.lobsterpay.xyz`
- `NEXT_PUBLIC_SOLANA_RPC_URL` = `https://api.devnet.solana.com`
- `NEXT_PUBLIC_SOLANA_CLUSTER` = `devnet`
- `NEXT_PUBLIC_LOBSTERPAY_PROGRAM_ID` = `A184DBQaCM6qWETbEDJUtr25bSuuTH72sTTixsyoZbtS`

## How to generate the relayer hot wallet (next step)

```bash
export PATH="$HOME/.avm/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"

# 1. Generate fresh keypair
solana-keygen new --no-bip39-passphrase --force -s -o /tmp/lp-relayer.json

# 2. Get pubkey
solana-keygen pubkey /tmp/lp-relayer.json

# 3. Encode as base58 for FEE_PAYER_SECRET_KEY env var
python3 -c "import base58, json; print(base58.b58encode(bytes(json.load(open('/tmp/lp-relayer.json')))).decode())"

# 4. Fund with bootstrap SOL on devnet
solana airdrop 1 $(solana-keygen pubkey /tmp/lp-relayer.json) --url devnet
# If rate-limited, use https://faucet.solana.com/

# 5. Paste base58 into Railway → API service → Variables → FEE_PAYER_SECRET_KEY

# 6. Clean up
rm /tmp/lp-relayer.json

# 7. Verify
curl https://api.lobsterpay.xyz/v1/config/relayer
# Should return { configured: true, pubkey: "..." }
```

## Related project files

- **[apps/web/DESIGN.md](./apps/web/DESIGN.md)** — **source of truth for all frontend styling**. Read this BEFORE any CSS, button, spacing, typography, or color change. Contains exact specs for buttons (12px 24px padding, 14px GeistMono, 1.4px letter-spacing, 0 radius), colors (monochrome #1f2228 + #fff palette), spacing scale, elevation philosophy ("no shadows, ever"), and do's/don'ts.
- [HANDOFF.md](./HANDOFF.md) — deploy session notes (can be deleted once Phase 4 smoke test passes on mainnet)
- [DEPLOY.md](./DEPLOY.md) — Railway deploy walkthrough
- [README.md](./README.md) — public overview
- [.env.deploy.example](./.env.deploy.example) — template for deploy secrets
