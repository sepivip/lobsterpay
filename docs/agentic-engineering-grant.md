# Agentic Engineering Grant Application

**Submit at:** https://superteam.fun/earn/grants/agentic-engineering
**Grant amount:** 200 USDG
**Generated:** 2026-04-18

---

## Step 1: Basics

**Project Title**
> LobsterPay

**One Line Description**
> Permissioned payment layer for AI agents on Solana — owners issue API keys with granular spending limits, agents transact through program-controlled vaults without ever touching private keys.

**TG username**
> t.me/sepivip

**Wallet Address**
> 9gAbueQ8X2jkNtanutA3AFEZnWJDtRzUJKc4GkLp1mAc

---

## Step 2: Details

### Project Details

> **The problem:** AI agents need purchasing power but have only two bad options today. Hand them a seed phrase and one prompt-injection attack drains your treasury. Wrap every transaction in human approval and you've killed the autonomy that made agents useful in the first place.
>
> **The solution:** LobsterPay introduces a third path. A Solana Anchor program creates owner-controlled vault PDAs with onchain policy enforcement: per-tx limits, daily limits, allowlisted mints, allowlisted destinations, action bitmasks, and a delegated `authorized_agent` pubkey. Owners deposit SPL tokens once, configure their policy in the dashboard, and issue scoped API keys. Agents then call a Fastify backend that validates against policy offchain and signs transactions onchain via the authorized agent. The vault PDA is the only entity that can move funds — enforced by `transfer_checked` CPIs with hardcoded 1.5% service-fee splits and self-sustaining fee-payer reimbursement (10,000 lamports per agent tx, paid from the user's onchain FeeVault).
>
> **What's shipped end-to-end:** 11 Anchor instructions, 25 passing integration tests, B+ security audit grade (Solana-specific `review-and-iterate` rubric), full Next.js 15 dashboard, TypeScript SDK, MCP server with 6 tools for Claude agents, and downloadable agent skill files in 4 formats (Skill JSON, Agent Prompt MD, OpenAPI 3.0, MCP Config). Everything is live on Railway and Solana devnet right now: program `A184DBQaCM6qWETbEDJUtr25bSuuTH72sTTixsyoZbtS`, frontend `lobsterpayweb-production.up.railway.app`, API `lobsterpayapi-production.up.railway.app`. The revenue model is wired in code — every agent payment splits 98.5% to the destination, 1.5% to the LobsterPay treasury.
>
> **Why this is agentic engineering:** The entire codebase was built through Claude Code with iterative skill invocations — brainstorming, frontend-design, code-review, security audits via the `review-and-iterate` Solana skill, and this grant application via `apply-grant`. The session transcript (`claude-session.jsonl`, attached) captures the full development arc from empty repo to production deployment in a single hackathon cycle. LobsterPay is both built by an agentic engineer and built **for** agentic engineers — the MCP server lets Claude itself become a paying customer.

### Deadline

> 2026-05-31 (Asia/Calcutta)

### Proof of Work

> **GitHub repository:** https://github.com/sepivip/lobsterpay (public, MIT licensed, 33 commits)
>
> **Live deployment:**
> - Frontend: https://lobsterpayweb-production.up.railway.app
> - API: https://lobsterpayapi-production.up.railway.app
> - Anchor program (Solana devnet): `A184DBQaCM6qWETbEDJUtr25bSuuTH72sTTixsyoZbtS`
> - Solana Explorer: https://explorer.solana.com/address/A184DBQaCM6qWETbEDJUtr25bSuuTH72sTTixsyoZbtS?cluster=devnet
>
> **Onchain proof:**
> - Initial program deploy tx: `2bsnJAAg67djXzAYrqGrcYnKkGPH2ZRsZuoQo1YF45t9Rc77yKY9N6oKRMgxT25ZY5jmZTYFGjpqN3CajwZi5hCy`
> - Fee-reimbursement upgrade tx: `34242rHGszBypxVTEY6ktGt31nLus7GQSVpwhoGCr2xmepQET98tzLjVHrBQRV5jxtpFCwjs6ZjaeogVszX387Xi`
> - Upgrade authority: `2ALtGZpteopcZgKCcW6eHcSiwvLGkoqrnEGidsJe5Lq3`
> - Treasury (devnet): `DvcQMhZmhZZQ1CX6FhGkyAiPr3YtNbBuLDP3QpuBRTHp`
>
> **Technical scope shipped:**
> - **Anchor program** (Rust, Anchor 0.31.1): 11 instructions, 23 custom errors, 11 events, 3 PDA account types (Vault, Policy, FeeVault), hardcoded 1.5% service fee, self-sustaining fee-vault reimbursement model, **25 integration tests all passing**. Audited via Solana-specific security rubric: aligned daily-limit windows, atomic SQL CTE for usage reservation, boxed accounts under BPF stack limit, has_one constraints on all privileged operations, duplicate-account-aliasing check.
> - **Backend** (Fastify 5 + Postgres on Railway): vault CRUD, API key auth (SHA-256 hashed, raw key shown once), idempotent agent endpoints, Jupiter swap adapter, x402 payment adapter, downloadable skill versioning system at `/v1/skills/version`.
> - **Frontend** (Next.js 15 + Tailwind v4 + Solana wallet adapter): dashboard, key management, policy editor, activity log, agent integration page, real onchain token balances, fee deposit modal, dashed-focus design system.
> - **SDK + MCP server:** TypeScript client (`@lobsterpay/sdk`) for any agent framework, MCP server (`@lobsterpay/mcp-server`) with 6 tools (`check_vault`, `make_payment`, `get_swap_quote`, `execute_swap`, `pay_x402`, `list_activity`) for Claude Code/Desktop.
> - **Agent skill formats:** four downloadable formats served from the API, all version-stamped — Skill JSON, Agent Prompt MD, OpenAPI 3.0, MCP Config.
>
> **Crowdedness analysis (Colosseum Copilot):** LobsterPay sits in cluster `Solana AI Agent Infrastructure` (v1-c14, **325 projects, 14 winners — 4.3% win rate**). Maximum similarity to any existing project is **0.067**, indicating a sparsely populated niche. Closest comparables (Project Plutus deploys agents, SolAIBot is a wallet adapter, Mercantill is stablecoin rails) all attack adjacent problems but none combine PDA-controlled vaults + per-key policy engine + 1.5% protocol service fee + agent-funded reimbursement + multi-format skill distribution.
>
> **AI-assisted development proof:** Entire project built through Claude Code with iterative skill invocations: `brainstorming`, `frontend-design`, `requesting-code-review`, security audits via `review-and-iterate` (Solana-specific rubric), `apply-grant` (this application). Full session transcript attached as `claude-session.jsonl` (~2,700 git contributions over the session).

### Personal X Profile

> x.com/stepneurope

### Personal GitHub Profile

> https://github.com/sepivip

### Colosseum Crowdedness Score

> **Cluster:** Solana AI Agent Infrastructure (`v1-c14`)
> **Cluster size:** 325 projects (this is the "crowdedness" number)
> **Winners in cluster:** 14 / 325 = 4.3% win rate
> **Max similarity to nearest existing project:** 0.067 (low = strong differentiation)
>
> Google Drive screenshot: **TODO — visit https://copilot.colosseum.com → search "LobsterPay" or "permissioned payment AI agents" → screenshot the cluster card → upload to Drive (sharing: "Anyone with the link") → paste link here**

### AI Session Transcript

> File: `claude-session.jsonl` (in project root, ready to attach to the form)

---

## Step 3: Milestones

### Goals and Milestones

> **Milestone 1 — Production hot wallet + agent demo (by 2026-04-25)**
> Generate the LobsterPay relayer hot wallet, set `FEE_PAYER_SECRET_KEY` in Railway, fund with 0.1 SOL on devnet. Complete an end-to-end agent payment from Claude Code via the MCP server: agent calls `make_payment` → backend signs with relayer → onchain `execute_pay_exact` → 98.5% to destination, 1.5% to treasury, 10,000 lamports reimbursement to relayer. Record 3-minute demo video.
>
> **Milestone 2 — Onchain swap instruction (by 2026-05-02)**
> Implement `execute_swap_exact_in` with Jupiter v6 CPI inside the Anchor program (currently a stub returning `UnsupportedFeature`). Test the full swap pipeline: quote → policy validation → onchain CPI → fee split → daily-limit tracking. Add 5+ integration tests for swap edge cases. Backend swap endpoints already exist; this just wires them onchain.
>
> **Milestone 3 — x402 onchain settlement (by 2026-05-12)**
> Wire the existing x402 backend adapter to the onchain `execute_pay_exact` flow so 402-gated payments actually settle on Solana (currently records intent only). Build a demo 402-gated API service that accepts LobsterPay payments. Useful as a launch demo for "first agent that pays for its own API access."
>
> **Milestone 4 — Mainnet deploy + production treasury (by 2026-05-22)**
> Replace devnet treasury keypair with a production keypair and update `programs/lobsterpay/src/constants.rs`. Audit one final time. Deploy program to Solana mainnet with Helius RPC. Publish `@lobsterpay/sdk` and `@lobsterpay/mcp-server` to npm. Update CLAUDE.md, DEPLOY.md, README with mainnet addresses.
>
> **Milestone 5 — Adoption + final tranche (by 2026-05-31)**
> Onboard 10+ external agent developers via the MCP server. Track real agent transactions on the dashboard. Publish technical write-up + demo video. Submit final tranche evidence: Colosseum project link, GitHub repo, Claude Pro subscription receipt.

### Primary KPI

> Cumulative agent-initiated USDC payment volume processed through LobsterPay vaults — target: **$1,000+ in the first 30 days post-mainnet** (Milestones 4 + 5). Tracked onchain via `PaymentExecuted` and `ServiceFeeCollected` events emitted by the program.

### Final Tranche Checklist

> To receive the final tranche, the following will be submitted:
> - Colosseum project link (will be added after Cypherpunk hackathon submission)
> - GitHub repo: https://github.com/sepivip/lobsterpay
> - Claude Pro / Claude Code subscription receipt

---

## Files to attach to the form

| File | Location | Purpose |
|------|----------|---------|
| `claude-session.jsonl` | Project root | AI session transcript (proof of agentic dev) |
| Crowdedness Score screenshot | Google Drive (your link) | Cluster info from copilot.colosseum.com |

---

## Submit at: https://superteam.fun/earn/grants/agentic-engineering
