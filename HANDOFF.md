# LobsterPay — deploy session handoff

> **For the next Claude Code / agent session picking up this work on a different device.**
> This doc is a snapshot of where we left off mid-deploy. Delete it once the smoke test passes end-to-end.
>
> Last updated: 2026-04-11 (after commit `e0a2fca`)

## TL;DR

LobsterPay is mid-deploy. The **Railway stack (API + Web + Postgres) is live and healthy**. The **Anchor program was never deployed to devnet** — the previous program id was a placeholder, and the Windows machine we were working on couldn't build Anchor 0.31.1 because Solana 1.x on Windows bundles a Rust too old for `edition = "2024"` crates. The user is resuming on **macOS** to finish the Anchor build + deploy, then we wire Railway env vars, clean a stale DB row, and smoke test.

**Your job as the next agent:** read this, run the Anchor build + deploy on Mac, then complete the remaining 4 todo items at the bottom.

## Current state

### What works (Railway, already deployed)

| Service | URL | Status |
|---|---|---|
| `@lobsterpay/api` (Fastify) | https://lobsterpayapi-production.up.railway.app | 🟢 `/health` → 200, DB connected, 9 migrations applied, CORS wired, auth middleware working |
| `@lobsterpay/web` (Next.js 15) | https://lobsterpayweb-production.up.railway.app | 🟢 Loads, wallet adapter connects, `NEXT_PUBLIC_*` env vars baked in at build time |
| Postgres | (internal) | 🟢 |

Railway is watching `main`. Any push auto-rebuilds the affected service(s).

### What's broken and why

**The Solana program behind id `A184DBQaCM6qWETbEDJUtr25bSuuTH72sTTixsyoZbtS` does not exist on any cluster yet.** Every attempt to `initialize_vault` / `initialize_fee_vault` fails at wallet pre-send simulation because the RPC node can't resolve the program account. The frontend reports "Failed to create vault" / "Simulation failed" with no on-chain tx ever hitting the signature history.

This is the **only** remaining blocker. Once the program is deployed and Railway env vars are updated, the smoke test should pass.

## Key identifiers (all public, safe to share)

| Thing | Value |
|---|---|
| **Program id (NEW, in repo)** | `A184DBQaCM6qWETbEDJUtr25bSuuTH72sTTixsyoZbtS` |
| **Deployer wallet** (funded with ~5 SOL on devnet) | `2ALtGZpteopcZgKCcW6eHcSiwvLGkoqrnEGidsJe5Lq3` |
| **User's Phantom wallet** (dashboard owner for smoke test) | `EVfTBY7prqCDMU3LYHAe1LBDpHfjughceYmicBLB8atF` |
| **GitHub repo** | https://github.com/sepivip/lobsterpay |
| **Solana cluster** | `devnet` (`https://api.devnet.solana.com`) |

## Key files / where things live

| Path | Purpose |
|---|---|
| [.env.deploy.example](.env.deploy.example) | Template + docs for the deploy-time keypair env vars. Read this first on Mac. |
| `.env.deploy` *(gitignored, must be restored from password manager)* | Real base58 keypairs for `PROGRAM_KEYPAIR` + `DEPLOYER_KEYPAIR`. User has a backup in their password manager. |
| [programs/lobsterpay/src/lib.rs](programs/lobsterpay/src/lib.rs) | `declare_id!()` matches the new program id |
| [Anchor.toml](Anchor.toml) | `[programs.devnet]` entry matches the new program id |
| [apps/web/src/lib/solana.ts](apps/web/src/lib/solana.ts) | Frontend hardcoded `PROGRAM_ID` matches |
| [apps/api/src/solana/instructions.ts](apps/api/src/solana/instructions.ts) | Backend hardcoded `LOBSTERPAY_PROGRAM_ID` matches |
| [DEPLOY.md](DEPLOY.md) | Original Railway deploy walkthrough (already done; kept for reference) |
| [README.md](README.md) | Project overview. Program id in it is up to date. |

## What was done in the previous session (commit trail on `main`)

```
e0a2fca docs(deploy): add .env.deploy.example template
a4e163c chore(deploy): regenerate program keypair + ID (devnet redeploy prep)
e6e8cbf fix(api): verifyVaultOwnership queried non-existent column
929081b fix(deploy): unblock Railway builds by skipping usb/node-hid native compile and scoping workspace installs
8b3d74c feat: revenue model (pre-session, reference only)
```

Each commit message is verbose and explains the *why*, not just the *what*. `git show <sha>` to read them.

## Next steps — what you need to do

### Phase 1 — Deploy the Anchor program from macOS

You (the next agent) are running on macOS. Anchor/Solana support is first-class there.

**Prerequisites:**
```bash
# Solana CLI via Anza
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"

# Anchor via avm
cargo install --git https://github.com/coral-xyz/anchor avm --force
avm install 0.31.1 && avm use 0.31.1
```

**Restore the deploy secrets:**
1. Ask the user to paste the contents of their password manager note titled (roughly) "LobsterPay devnet keys" into `lobsterpay/.env.deploy`. The file is gitignored.
2. Verify with `git check-ignore -v .env.deploy` → should match `.gitignore:15`.
3. Read [.env.deploy.example](.env.deploy.example) for the exact decode snippet. The inline `node -e` script in that file turns `PROGRAM_KEYPAIR` (base58) back into `target/deploy/lobsterpay-keypair.json` and `DEPLOYER_KEYPAIR` into a temp file like `/tmp/lobsterpay-deployer.json`.

**Sanity-check the decoded keypairs:**
```bash
solana-keygen pubkey target/deploy/lobsterpay-keypair.json
# → must print: A184DBQaCM6qWETbEDJUtr25bSuuTH72sTTixsyoZbtS

solana-keygen pubkey /tmp/lobsterpay-deployer.json
# → must print: 2ALtGZpteopcZgKCcW6eHcSiwvLGkoqrnEGidsJe5Lq3
```

If either doesn't match, **stop** — something was pasted wrong. Don't proceed.

**Verify deployer wallet is still funded:**
```bash
solana config set --url devnet
solana balance 2ALtGZpteopcZgKCcW6eHcSiwvLGkoqrnEGidsJe5Lq3
# → should show ≥4 SOL. If less, airdrop via https://faucet.solana.com
```

**Build + deploy:**
```bash
anchor build
# First run takes 5-10 min. Produces target/deploy/lobsterpay.so
# Warning about anchor-lang 0.31.1 vs CLI 0.32.x is OK, not a blocker.

anchor deploy --provider.cluster devnet --provider.wallet /tmp/lobsterpay-deployer.json
# Costs ~4-5 SOL in rent. Takes ~1-2 min.

# Verify on chain
solana program show A184DBQaCM6qWETbEDJUtr25bSuuTH72sTTixsyoZbtS --url devnet
# Should show: Program Id, ProgramData Address, Authority (= deployer), Data Length

rm /tmp/lobsterpay-deployer.json   # security hygiene — only .env.deploy persists
```

**Double-check via RPC** (same thing I'll want to verify anyway):
```bash
curl -sS -X POST https://api.devnet.solana.com \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getAccountInfo","params":["A184DBQaCM6qWETbEDJUtr25bSuuTH72sTTixsyoZbtS",{"encoding":"base64"}]}' \
  | head -c 300
# "value": { ... "executable": true, "owner": "BPFLoaderUpgradeab1e11111111111111111111111" ... }
# "value": null means it's STILL not deployed. Debug and retry.
```

### Phase 2 — Wire the new program id into Railway

Railway currently has **stale** env vars from before the program id was regenerated. Update both:

**On service `@lobsterpay/api`** → Variables → find `LOBSTERPAY_PROGRAM_ID` → set to:
```
A184DBQaCM6qWETbEDJUtr25bSuuTH72sTTixsyoZbtS
```

**On service `@lobsterpay/web`** → Variables → find `NEXT_PUBLIC_LOBSTERPAY_PROGRAM_ID` → set to:
```
A184DBQaCM6qWETbEDJUtr25bSuuTH72sTTixsyoZbtS
```

Railway will auto-redeploy both services on the variable changes. The Web rebuild is the slow one (~2-3 min) because `NEXT_PUBLIC_*` gets baked into the client bundle at build time.

**Note:** the code references in the repo already have the new id (commit `a4e163c`), so a source-level git pull on Mac shouldn't require further edits to `apps/web/src/lib/solana.ts` or `apps/api/src/solana/instructions.ts`. Only the Railway env var strings need updating.

### Phase 3 — Clean stale DB vault rows

The user's wallet (`EVfTBY7...`) has one or more stale vault rows in Postgres from failed create attempts. Query first, then delete.

**Railway dashboard** → **Postgres** service → **Database** tab → SQL query box:

```sql
SELECT v.id, v.vault_pda, v.created_at
FROM vaults v
JOIN owners o ON v.owner_id = o.id
WHERE o.wallet_address = 'EVfTBY7prqCDMU3LYHAe1LBDpHfjughceYmicBLB8atF';
```

Known stale rows from the last session (may or may not still exist):
- `f124621f-1f9e-4791-bef2-f8dcaa561b37`
- `42855ecc-b743-4fca-8ab3-3c3cf129fe89`
- `55829ada-08a6-4231-a1c0-0e2e2c4997e3`

**For each returned vault id, delete children first (FK order matters):**

```sql
DELETE FROM activities      WHERE vault_id = '<vault-id>';
DELETE FROM vault_policies  WHERE vault_id = '<vault-id>';
DELETE FROM vaults          WHERE id       = '<vault-id>';
```

After deletion, `GET /v1/vaults/by-owner/EVfTBY7prqCDMU3LYHAe1LBDpHfjughceYmicBLB8atF` should return 404. This unhides the "Create Vault" button in the dashboard and lets the user retry the full flow.

### Phase 4 — End-to-end smoke test

User opens https://lobsterpayweb-production.up.railway.app in a browser with Phantom on **Devnet**.

1. **Landing page** loads, wallet connects via "Select Wallet" → Phantom → Approve.
2. Redirects to `/dashboard`. Dashboard shows "No vault yet, Create Vault" button.
3. Click **Create Vault**. Phantom popup → `initialize_vault` tx → **sign** (critical: user must sign this, not just dismiss). ~15s devnet confirmation.
4. Dashboard refreshes, shows vault PDA + "active" status + zero balances.
5. Click **Initialize Fee Vault**. Phantom popup → `initialize_fee_vault` tx → sign.
6. Click **Deposit Fees**, put in `0.005` SOL, sign.
7. Dashboard should show a non-zero fee balance.
8. Navigate to `/policy`, `/keys`, `/activity` — all pages load without 500s.
9. Create an API key, revoke it, watch the activity page pick it up.

If any step fails, read DevTools Console + Network tab + Railway API logs. Most common failure modes — and how to fix them — are logged in the commit messages of `e6e8cbf` and `929081b` (see `git log --format=full`).

## Gotchas learned the hard way this session

**Do not repeat these mistakes.** Each one cost us real time.

1. **`API_PORT` env var on Railway must be a literal number like `8080`, not `${{PORT}}`.** Railway's template `${{VAR}}` syntax works for cross-service refs like `${{Postgres.DATABASE_URL}}` but NOT for the built-in `PORT` variable. If `API_PORT` is set to `${{PORT}}` Fastify binds to port 0, Node auto-assigns a random ephemeral port, and Railway's healthcheck on 8080 never finds it.

2. **`verifyVaultOwnership` in `apps/api/src/routes/vaults.ts` was querying a non-existent `owner_wallet` column.** Fixed in `e6e8cbf`. If you see PostgreSQL error code `42703` ("column ... does not exist") in API logs, check if more queries have the same bug.

3. **`usb` / `node-hid` native compile breaks Railway Nixpacks builds.** `@solana/wallet-adapter-wallets` pulls in `@ledgerhq/hw-transport-node-hid` → `usb`, which tries to compile native bindings during `pnpm install`. The Nixpacks image doesn't have `libusb-dev`. Fixed by `pnpm.neverBuiltDependencies: ["usb", "node-hid"]` in the root `package.json` (commit `929081b`).

4. **Don't run `pnpm install` at the repo root during per-service Railway builds.** Scope it to the target workspace: `pnpm install --frozen-lockfile --filter @lobsterpay/api...` so only that service's deps download.

5. **`Cargo.lock` version 4 → 3 is a trap.** We downgraded it to work around old Windows Cargo, then reverted. Don't do it again. Modern cargo handles v4 fine. If you hit a "lock file version `4`" error, **upgrade the toolchain**, don't downgrade the lockfile.

6. **A DB vault row existing does NOT mean an on-chain vault exists.** The dashboard's `createVault()` is a 2-step flow: POST to backend (creates DB row) → build + sign on-chain tx. If step 2 fails or the user dismisses the wallet popup, you get a split-brain state. The frontend doesn't currently detect this — it hides the Create Vault button on every load where `getVaultByOwner` returns a row. If the user reports "Create Vault does nothing" or "Failed to create vault", **check if the Vault PDA actually exists on devnet** via `getAccountInfo`, not the DB.

7. **"Wallet simulation failed" almost always means the program doesn't exist at the expected address.** Verify with `getAccountInfo` on the program id before blaming frontend or wallet. If `"value": null`, the program isn't there.

8. **Phantom/Solflare must be on Devnet**, not Mainnet or Testnet. These are three different clusters. LobsterPay is only deployed on Devnet. Phantom: Settings → Developer Settings → Testnet Mode → Network = Devnet. Solflare: Settings → Network → Devnet.

9. **Windows + Anchor 0.31.1 does not work.** Solana 1.x on Windows bundles Rust too old for the current Anchor ecosystem (edition2024, feature resolver v2, etc.). Use Linux, macOS, WSL Ubuntu, or a Docker Linux container. Don't waste time fighting this.

## Pre-session context you should have

The Explore agent reports from the previous session mapped the full repo architecture. If you need a deeper understanding of the codebase than README.md gives you:

- **Anchor program** — `programs/lobsterpay/src/` has 11 instructions + state/errors/events/constants. Core instructions: `initialize_vault`, `update_policy`, `update_authorized_agent`, `execute_pay_exact`, `execute_swap_exact_in` (stub — Phase 3, not implemented), `withdraw_owner`, `emergency_pause`, `initialize_fee_vault`, `deposit_fees`, `withdraw_fees`, `ensure_vault_token_account`. Guards enforce paused flag, action bitmask, mint/destination allowlists, per-tx + daily limits, fee vault balance ≥ 1.5M lamports.

- **API** — Fastify 5, raw `postgres` driver (no ORM), Zod schemas from `@lobsterpay/shared`, hand-rolled Anchor instruction builders in `apps/api/src/solana/instructions.ts` (not the TypeScript client generated by `anchor build` — they rebuild discriminators + borsh serialization manually). 9 SQL migrations in `apps/api/src/db/migrations/`. Owner routes in `vaults.ts` (auth: `X-Wallet-Address` header + `verifyVaultOwnership` JOIN lookup). Agent routes in `agent.ts` (auth: SHA-256 of `Bearer <apiKey>` matched against `api_keys.key_hash`).

- **Web** — Next.js 15 App Router, Tailwind v4, Solana wallet adapter (Phantom + Solflare), same hand-rolled instruction builders in `apps/web/src/lib/solana.ts`. Dashboard page is the critical smoke-test target.

- **Shared packages** — `packages/shared` has the Zod schemas + error types + constants that both API and Web import.

---

**When all 4 phases above pass, delete this file** (`rm HANDOFF.md && git add -u && git commit -m "chore: remove post-deploy handoff doc"`). It's session-specific and will go stale.
