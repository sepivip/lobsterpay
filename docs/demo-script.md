# Hackathon demo video — script and shot list

Target length **2:30**. Optimised for the Solana Colosseum submission. The whole point is to walk a judge from "I don't know what this is" to "I just watched an AI agent autonomously make a Solana payment" without a single moment of dead air.

## Pre-flight

Before recording:

- Vault funded (≥ 1 USDC, ≥ 0.05 SOL in fee vault)
- `.env.integration` filled in with `LOBSTERPAY_API_KEY`, `TEST_DEST_OWNER`, `ANTHROPIC_API_KEY`
- `pnpm install` completed
- Two test runs done back-to-back to confirm both green
- Phantom set to Devnet, dashboard logged in
- Browser tabs ready: dashboard, Solscan devnet (open and signed in)
- Terminal font set readable (≥ 16pt), dark theme, narrow window so commands aren't truncated
- Screen at 1920×1080. Quit Slack, Discord, etc.

Optional but worth it: dry-run the script once, time each section against the targets below. If a beat is dragging, cut it.

## Story arc

```
0:00  Hook: agents + money problem
0:15  Solution: LobsterPay tagline
0:30  Dashboard tour (vault, policy, lobster)
1:00  Integration suite live (tx signatures)
1:45  Agent buys the fortune (THE shot)
2:15  Solscan proof + closing
```

---

## Section 1 — The problem (0:00 → 0:15)

**Screen.** Black holding card with the line "AI agents need to spend money." Hold for 2 seconds, then crossfade to a desktop with three browser tabs visible: Stripe Agent SDK landing page, Anthropic Claude computer-use docs, an x402 spec page.

**Narration.**

> Agents are getting wallets. Stripe shipped agent APIs last quarter. Anthropic gave Claude a computer. x402 turned HTTP 402 into a real protocol. But the way agents actually pay today is broken: you either hand them a seed phrase and pray, or you wrap every transaction in a human approval pop-up. There's no middle.

**Cut to.** A short ASCII clip from `public/marketing/anim/lobster-walk.mp4` — bridge into Section 2.

---

## Section 2 — The pitch (0:15 → 0:30)

**Screen.** LobsterPay README hero (the GIF). Pause one beat on the title and tagline.

**Narration.**

> LobsterPay is the credit card for AI agents on Solana. The owner deposits tokens into a program-controlled vault, sets a spending policy — per-tx limit, daily cap, allowlists — and issues an API key. The agent calls a simple HTTP endpoint. The Anchor program enforces every policy on chain. The owner's keys never leave their wallet.

**Visual cue.** As you say "API key", "Anchor program", "HTTP endpoint", overlay each phrase on screen briefly.

---

## Section 3 — The dashboard (0:30 → 1:00)

**Screen.** lobsterpay.xyz, logged in. Spinning lobster hero is on screen.

**Action.**
1. Hover the spinning lobster — `@` cells flip to `$` near the cursor. Two seconds.
2. Click **Vault**. Show balance, fee vault, allowed actions.
3. Click **Policy**. Hover over per-tx limit and daily cap.
4. Click **Keys**. Show the existing test key (don't reveal the key — show the masked label only).

**Narration.**

> Here's the dashboard. The vault sits on devnet, holds USDC, and is bound to my wallet's pubkey. The policy is human-readable: per-tx 1 USDC, daily 15. Every owner action is signed by my wallet via real ed25519 — no spoofable headers, no shared secrets. The agent only ever sees the API key.

---

## Section 4 — Integration suite (1:00 → 1:45)

**Screen.** Terminal in repo root, full-screen.

**Action.** Type, slowly enough to be readable:

```bash
pnpm test:integration
```

**Cut.** Speed up the run. The whole suite takes ~9 seconds; you can either let it play in real time or fast-forward through the green checkmarks. End with the **TX DIGEST** block on screen, frozen.

**Narration (over the run).**

> 18 tests against the live API — pay, idempotency replay, over-limit rejection, swap quote, x402 in three modes, auth. Each tx-producing test settles a real Solana transaction on devnet. The digest at the end is the receipt: every signature, paste-able into Solscan.

**Visual cue.** When the digest lands, highlight one of the signatures with a Cmd-double-click box selection. Hold for one second.

---

## Section 5 — Agent runner — the money shot (1:45 → 2:15)

**Screen.** Same terminal, fresh prompt.

**Action.**

```bash
pnpm test:agent
```

**Narration.**

> Now the same flow, but instead of a script — Claude runs it. The agent gets one task: "buy me a fortune from the LobsterPay demo paywall and show me the tx signature." It has four tools and an API key.

**Cut.** Let the live stream play. As Claude reasons + picks tools, the screen fills:

```
[tool] check_vault
[tool] peek_paywall
[tool] pay_x402
[tool] unlock
```

**Visual cue.** When the agent prints the fortune, highlight it. When it prints the tx signature, highlight that too — these are the two payoff moments.

---

## Section 6 — On-chain proof + close (2:15 → 2:30)

**Screen.** Cmd-click the tx signature from Section 5 to open Solscan in a new tab. Show the SPL transfer details — vault → demo merchant + the 1.5% to treasury.

**Narration.**

> One real Solana transaction, signed by an LLM that never saw the owner's private key, bounded by an on-chain policy that doesn't trust the LLM. That's LobsterPay.

**End card.** Logo + tagline + the three URLs: lobsterpay.xyz, github.com/sepivip/lobsterpay, the program ID `A184DBQa...ZbtS`. Hold for 3 seconds.

---

## Editing notes

- Cut every dead second. Most pauses between commands are removable in post.
- Caption the tx signatures with overlay boxes — judges scrub through and pause; make the proof legible at any frame.
- The lobster GIF and the agent-buying-the-fortune beat are the two visual moments people will remember. Don't bury either.
- Music: optional. If you use any, instrumental + low-mix only — narration is the load-bearing layer.
- Export 1080p, H.264, ≤ 50 MB so it uploads cleanly to the submission form.

## Reshoots

If a tx times out mid-recording, don't restart — most submissions allow a single re-run; just splice the second take of that section over the first. The integration suite is reproducible (`pnpm test:integration` produces fresh signatures every run), so a clean retake is cheap.
