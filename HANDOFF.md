# LobsterPay — Mac session handoff (Phase 2: fee-reimbursement upgrade)

> **Delete this file after the upgrade is verified end-to-end.** It's session-specific working doc, not durable documentation.
>
> Last updated: 2026-04-16 after commit `9f18972`.

## Why you're on the Mac

The Anchor program has been **upgraded in place** at the source level (same program ID, new binary). The Fastify API and Next.js web app have already redeployed via Railway on the last push. What's left is the part a Mac/Linux toolchain has to do: `anchor build && anchor deploy` to push the new program bytes on-chain.

After that lands, you'll do two small follow-ups (Railway env var + one Phantom signature) and LobsterPay is fully self-serve.

## What changed (context for reviewers)

**The "vault pays its own gas" refactor (commit `9f18972`, skill v0.3.0):**

- `execute_pay_exact` now reimburses the tx fee payer from the vault's `fee_vault` PDA after each payment — bounded at `FEE_REIMBURSEMENT_LAMPORTS = 10_000` (0.00001 SOL) with a rent-exempt guard.
- `initialize_vault` params struct grew an `Option<Pubkey> authorized_agent` at the end (borsh-compatible addition; `None` keeps the old owner-default behavior).
- Backend exposes `GET /v1/config/relayer` returning the service relayer's pubkey derived from `FEE_PAYER_SECRET_KEY`.
- Frontend's `useVault.createVault()` fetches the relayer pubkey and threads it into the `initialize_vault` tx so new vaults are born agent-ready.

**Net UX change:** users no longer need to manage a per-deployment fee-payer key or perform an extra `update_authorized_agent` step. Deposit SOL into the fee_vault, deposit tokens into the vault's ATA, issue API keys — done.

## Immutable facts

| Thing | Value |
|---|---|
| Program ID (unchanged) | `A184DBQaCM6qWETbEDJUtr25bSuuTH72sTTixsyoZbtS` |
| Deployer address (also unchanged, same upgrade authority) | `2ALtGZpteopcZgKCcW6eHcSiwvLGkoqrnEGidsJe5Lq3` |
| **New: Service relayer address** | `8cSZsHi17gjtiBrccZK5JzqNzi4v1md7GzBG1twuKKgb` |
| API URL | `https://api.lobsterpay.xyz` |
| Web URL | `https://lobsterpay.xyz` |
| User's Phantom wallet (owner) | `EVfTBY7prqCDMU3LYHAe1LBDpHfjughceYmicBLB8atF` |
| User's existing vault ID | `a502cb4a-7ff9-474e-aebb-172879decee5` |

## Required secrets

All secrets live in [`.env.deploy`](.env.deploy) (gitignored). Keep a backup in your password manager.

The file should contain 6 lines by now:

```
PROGRAM_KEYPAIR=<base58, from first deploy session>
PROGRAM_ID=A184DBQaCM6qWETbEDJUtr25bSuuTH72sTTixsyoZbtS
DEPLOYER_KEYPAIR=<base58, from first deploy session>
DEPLOYER_ADDRESS=2ALtGZpteopcZgKCcW6eHcSiwvLGkoqrnEGidsJe5Lq3
FEE_PAYER_KEYPAIR=<base58 — NEW for this upgrade>
FEE_PAYER_ADDRESS=8cSZsHi17gjtiBrccZK5JzqNzi4v1md7GzBG1twuKKgb
```

The file is in the repo root on the Windows box; copy its exact contents into the same path on Mac. Or paste from your password manager.

If `FEE_PAYER_KEYPAIR` is missing from your password manager entry, check the Windows box's `.env.deploy` — the value was written there during this session.

## Phase 2 — what to do on Mac

### Step 1 — Sync the repo

```bash
cd ~/path/to/lobsterpay
git pull origin main
# should land at commit 9f18972 (or newer)
git log --oneline -3
```

Verify you see `feat: vault pays its own gas` in the log.

### Step 2 — Restore `.env.deploy`

```bash
# From password manager or from the Windows box. Paste all 6 lines.
$EDITOR .env.deploy

# Sanity check — gitignored?
git check-ignore -v .env.deploy
# should match .gitignore:15:.env.deploy
```

### Step 3 — Decode keypairs to JSON files

`anchor deploy` needs the program keypair at `target/deploy/lobsterpay-keypair.json` and the deployer wallet at any path you'll pass via `--provider.wallet`.

```bash
source .env.deploy
mkdir -p target/deploy

# Program keypair — MUST be at this exact path for anchor deploy to match
node -e '
  const bs58 = (s) => { const A="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"; let n=0n; for(const c of s){const i=A.indexOf(c);if(i<0)throw 0;n=n*58n+BigInt(i);} const bytes=[];while(n>0n){bytes.unshift(Number(n%256n));n/=256n;} for(const c of s){if(c!=="1")break;bytes.unshift(0);} return bytes; };
  require("fs").writeFileSync(process.argv[1], JSON.stringify(bs58(process.env.PROGRAM_KEYPAIR)));
' target/deploy/lobsterpay-keypair.json

# Deployer keypair — temp path, deleted after deploy
node -e '
  const bs58 = (s) => { const A="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"; let n=0n; for(const c of s){const i=A.indexOf(c);if(i<0)throw 0;n=n*58n+BigInt(i);} const bytes=[];while(n>0n){bytes.unshift(Number(n%256n));n/=256n;} for(const c of s){if(c!=="1")break;bytes.unshift(0);} return bytes; };
  require("fs").writeFileSync(process.argv[1], JSON.stringify(bs58(process.env.DEPLOYER_KEYPAIR)));
' /tmp/lobsterpay-deployer.json

# Sanity check pubkeys match what's expected
solana-keygen pubkey target/deploy/lobsterpay-keypair.json
#   expected: A184DBQaCM6qWETbEDJUtr25bSuuTH72sTTixsyoZbtS
solana-keygen pubkey /tmp/lobsterpay-deployer.json
#   expected: 2ALtGZpteopcZgKCcW6eHcSiwvLGkoqrnEGidsJe5Lq3
```

If either pubkey mismatches, **stop** — don't deploy. Something was pasted wrong.

### Step 4 — Verify deployer has devnet SOL

```bash
solana config set --url devnet
solana balance 2ALtGZpteopcZgKCcW6eHcSiwvLGkoqrnEGidsJe5Lq3
```

Upgrades reuse program rent so the cost is small (<0.01 SOL for tx fees). If the deployer is below 0.5 SOL, top up from https://faucet.solana.com.

### Step 5 — Build + upgrade (not a fresh deploy)

```bash
anchor build
# First build on this machine may take ~5-10 min. Subsequent builds are fast.
# Warning about anchor-lang 0.31.1 vs CLI 0.32.x is harmless.

anchor deploy --provider.cluster devnet --provider.wallet /tmp/lobsterpay-deployer.json
# anchor detects the existing program at A184DB... via the keypair match
# and submits an *upgrade* (buffer + write + upgrade ix), not a fresh deploy.
# Takes ~1-2 min.
```

### Step 6 — Verify the upgrade landed

```bash
solana program show A184DBQaCM6qWETbEDJUtr25bSuuTH72sTTixsyoZbtS --url devnet
# Look for:
#   Program Id:      A184DBQaCM6qWETbEDJUtr25bSuuTH72sTTixsyoZbtS   (same)
#   Owner:           BPFLoaderUpgradeab1e...                         (same)
#   Authority:       2ALtGZpteopcZgKCcW6eHcSiwvLGkoqrnEGidsJe5Lq3   (same)
#   Last Deployed In Slot:  <NEW number, higher than before>        (proves upgrade)
#   Data Length:     <probably changed slightly>
```

The critical signal is the **Last Deployed In Slot** number updating. If it did, the new binary is live.

### Step 7 — Clean up

```bash
rm /tmp/lobsterpay-deployer.json
# .env.deploy and target/deploy/lobsterpay-keypair.json stay (gitignored)
```

## Phase 3 — Railway + on-chain migration (after anchor deploy)

These are browser-only steps. No Mac or code needed.

### Step 8 — Add `FEE_PAYER_SECRET_KEY` to Railway

`lobsterpay-api` service → **Variables** tab → **Raw Editor** (or add new variable):

```
FEE_PAYER_SECRET_KEY=<value of FEE_PAYER_KEYPAIR from .env.deploy>
```

Save. Railway auto-redeploys the API (~2 min). After it comes up, verify:

```bash
curl https://api.lobsterpay.xyz/v1/config/relayer
# Expected:
# {"configured":true,"pubkey":"8cSZsHi17gjtiBrccZK5JzqNzi4v1md7GzBG1twuKKgb"}
```

If you see `"configured": false`, the env var wasn't set correctly.

### Step 9 — Fund the service relayer with devnet SOL

The relayer pays tx fees upfront; the vault reimburses via fee_vault. It needs a starting balance so the first few txs don't fail.

```
Address: 8cSZsHi17gjtiBrccZK5JzqNzi4v1md7GzBG1twuKKgb
Fund: 0.05 SOL (will stay roughly flat with reimbursement)
Faucet: https://faucet.solana.com/
```

### Step 10 — Migrate the existing vault's authorized_agent

Your current vault (`a502cb4a-...`) was born with `authorized_agent = your Phantom wallet`. The upgrade doesn't auto-migrate existing vaults; one Phantom-signed tx fixes it.

1. Open https://lobsterpay.xyz/policy
2. Scroll to **Advanced → Authorized Agent**
3. Paste: `8cSZsHi17gjtiBrccZK5JzqNzi4v1md7GzBG1twuKKgb`
4. Save
5. Phantom pops up → Approve the `update_authorized_agent` tx
6. Wait ~15s for devnet confirmation

**New vaults (created after this upgrade) skip this step** — they auto-configure at `initialize_vault` by fetching `/v1/config/relayer`. Only pre-existing vaults need the migration.

### Step 11 — Smoke test end-to-end

Open your Telegram / Beka's agent and try a payment. The earlier "Fee payer not configured" error should be gone. The new on-chain `FeeReimbursed` event should emit on each tx — you can watch for it via:

```bash
# Count recent FeeReimbursed events (optional sanity check)
solana logs A184DBQaCM6qWETbEDJUtr25bSuuTH72sTTixsyoZbtS --url devnet | grep "FeeReimbursed"
```

After ~3 successful payments, verify:
- Your vault's USDC balance dropped by `amount - service_fee`
- Treasury's USDC balance grew by `service_fee`
- Your vault's fee_vault SOL balance dropped by ~`3 × 10_000 lamports` (~0.00003 SOL)
- The service relayer's SOL balance roughly flat (a tiny bit below 0.05 SOL if actual tx cost > reimbursement, or a tiny bit above if less)

## Rollback plan (if something breaks)

The upgrade replaces the binary at the same program ID. If the new binary misbehaves:

```bash
# Re-build from the previous commit + redeploy
git checkout bb2e6d3 -- programs/lobsterpay/
anchor build
anchor deploy --provider.cluster devnet --provider.wallet /tmp/lobsterpay-deployer.json
# Then reset source back to HEAD
git checkout HEAD -- programs/lobsterpay/
```

This rolls the on-chain binary back to the pre-upgrade state while leaving the Railway code on the new version. You'd then want to revert the frontend/backend changes via `git revert 9f18972` and push. But this shouldn't be necessary — the code is straightforward and tested against the same guards the previous version had.

## Verification checklist

Mark these off as you go:

- [ ] `git pull origin main` on Mac, HEAD shows `9f18972` or newer
- [ ] `.env.deploy` restored with all 6 lines including `FEE_PAYER_KEYPAIR`
- [ ] Keypair JSONs decoded, `solana-keygen pubkey` matches expected addresses
- [ ] `anchor build` succeeds (platform-tools warning is fine)
- [ ] `anchor deploy` succeeds, `solana program show` shows new Last Deployed In Slot
- [ ] `/tmp/lobsterpay-deployer.json` deleted
- [ ] `FEE_PAYER_SECRET_KEY` set on Railway, `/v1/config/relayer` returns `configured: true`
- [ ] Service relayer (`8cSZs...KKgb`) funded with ≥0.05 devnet SOL
- [ ] Policy page → Advanced → Authorized Agent set to the relayer, Phantom-signed tx confirmed
- [ ] Beka's agent successfully makes a payment end-to-end

Once all 9 boxes are checked, **delete this file**:

```bash
rm HANDOFF.md
git add HANDOFF.md
git commit -m "chore: remove post-upgrade handoff doc"
git push
```

## Commit trail for this upgrade

```
9f18972 feat: vault pays its own gas — fee_vault reimburses tx fee payer
bb2e6d3 fix(api): check_vault returns real on-chain token balances (skill v0.2.1)
46446ba feat(api): versioning for downloadable skills
f4a3d9a fix(api): substitute {LOBSTERPAY_API_URL} in downloaded skill files
e9f3665 fix(web): hide empty status badges on system activity events
7519061 fix(web): restore functional status colors + improve visibility
2d0a46e redesign(web): x.ai-inspired brutalist design system
04bf143 feat(web): show real on-chain token balances on dashboard
d13c660 feat(web): show full vault addresses on dashboard
59ea03f fix: duplicate account aliasing + compute budget (previous Mac session)
```

Each commit message has a full explanation. `git show <sha>` for details.

## Touchstones if anything confuses you

- **Don't regenerate the program keypair.** Same program ID must be preserved across sessions. Use the existing `PROGRAM_KEYPAIR` from `.env.deploy`.
- **`anchor deploy` is an UPGRADE here, not a fresh deploy.** It detects the existing program at the same ID (via the keypair match) and submits an upgrade transaction. Do NOT create a new keypair or use a different program ID.
- **Option C is the design direction locked in this session.** "Just vault" — no per-user hot wallet setup. The service relayer is operational infrastructure, not something users configure.
- **If the agent still fails after Step 10**, check in order: (a) Is Railway API healthy? `curl .../health` = 200. (b) Is `/v1/config/relayer` returning the right pubkey? (c) Did the vault's `authorized_agent` actually update on-chain? Look at the vault account via `solana account <policy_pda>` and parse the field, or check the Policy page shows the new value. (d) Does the relayer wallet have SOL?
