---
name: lobsterpay
description: Permissioned payment layer for AI agents on Solana. Make payments, swaps, and x402 purchases through a policy-controlled vault - no private keys needed.
version: "{SKILL_VERSION}"
metadata:
  openclaw:
    requires:
      env:
        - LOBSTERPAY_API_KEY
    primaryEnv: LOBSTERPAY_API_KEY
    homepage: https://github.com/sepivip/lobsterpay
    emoji: "🦞"
---

# LobsterPay Agent Instructions

<!-- Skill version {SKILL_VERSION} · updated {SKILL_UPDATED} · check {LOBSTERPAY_API_URL}/v1/skills/version for updates -->

You have access to a LobsterPay vault - a permissioned payment system on Solana. You can make payments, swaps, and pay for 402-gated services within the limits set by the vault owner.

## Authentication

Include your API key in every request:
```
Authorization: Bearer lp_live_YOUR_KEY
```

## Base URL

```
{LOBSTERPAY_API_URL}
```

## Available Actions

### 1. Check Your Vault

Before making any payment, check your current permissions and budget:

```
GET /v1/agent/vault
```

This returns your allowed actions, spending limits, and how much you've spent today.

### 2. Make a Payment

Send tokens to an approved destination:

```
POST /v1/agent/actions/pay
{
  "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "amountAtomic": "1000000",
  "destinationOwner": "RECIPIENT_WALLET_ADDRESS",
  "idempotencyKey": "unique-payment-id",
  "memo": "Payment for service X"
}
```

**Amount conversion:** USDC has 6 decimals. 1 USDC = 1000000 atomic units.

### 3. Swap Tokens

Get a quote first, then execute:

```
POST /v1/agent/quotes/swap
{
  "fromMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "toMint": "So11111111111111111111111111111111111111112",
  "amountAtomic": "5000000"
}
```

If the quote looks good, execute:

```
POST /v1/agent/actions/swap
{
  "fromMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "toMint": "So11111111111111111111111111111111111111112",
  "amountAtomic": "5000000",
  "maxSlippageBps": 100,
  "idempotencyKey": "swap-001"
}
```

### 4. Pay a 402-Gated Endpoint

When you get a 402 response with payment requirements, forward them to `pay_x402` intact. x402 v2 bodies use an `accepts` array; pass `accepts[0]` (or the flat legacy `paymentRequirements` alias if the server emits it) as the object:

```
POST /v1/agent/actions/x402
{
  "paymentRequirements": {
    "scheme": "exact",
    "network": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    "maxAmountRequired": "100000",
    "payTo": "SERVICE_WALLET",
    "asset": {
      "address": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "symbol": "USDC",
      "decimals": 6
    }
  },
  "originalRequestUrl": "https://api.example.com/premium-data",
  "idempotencyKey": "x402-example-001"
}
```

Either v2 field names (`maxAmountRequired`, `payTo`, `asset.address`) or legacy aliases (`amount`, `recipient`, `asset` as a string mint address) are accepted; we normalize internally.

**`network` field.** Accepted values:

- `"solana"` - cluster-agnostic; resolves to whatever cluster the server is configured for. Safe default when you don't know.
- `"solana-devnet"` / `"solana-mainnet"` - our dialect.
- `"solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"` - CAIP-2 mainnet chain id (per the x402 spec; this is what real gateways emit).
- `"solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"` - CAIP-2 devnet chain id.

If the 402 sends a cluster-specific value that doesn't match this deployment (e.g. a mainnet chain id when the server is devnet), the call returns a clear "Network mismatch" error - don't retry with a different value, route to a deployment configured for that cluster instead.

**Response header.** The returned `xPaymentHeader` is a base64-encoded v2 envelope: `{ x402Version: 2, scheme, network, payload: { txSignature, maxAmountRequired, payTo, asset, amount, recipient, paymentId } }`. Send it on the retry as `PAYMENT-SIGNATURE: <value>` (or legacy `X-PAYMENT: <value>` for pre-v2 upstreams). The `payload` carries both v2 names and legacy aliases so either kind of verifier works.

### Three x402 modes

**Submit mode - `pay_x402` (POST /v1/agent/actions/x402).** LobsterPay settles the tx on-chain itself and returns a confirmed signature wrapped in `xPaymentHeader`. Works with upstreams that verify payment by on-chain tx-signature lookup (our `/v1/demo/x402/*` endpoints, many self-hosted paywalls).

**Facilitator mode - `pay_x402_facilitator` (POST /v1/agent/actions/x402-facilitator).** For spec-conformant x402 facilitator gateways (agonx402, Coinbase reference facilitator). These gateways publish their fee-payer pubkey in the 402's `accepts[i].extra.feePayer` and expect a pre-signed **unsubmitted** v0 `transferChecked` in the `PAYMENT-SIGNATURE` header for them to co-sign and submit after upstream returns 200. Use this tool when the 402 includes `extra.feePayer`; LobsterPay handles the two-tx dance internally (vault → relayer via `execute_pay_exact`, then relayer → facilitator partial-signed and returned to you).

**SIWX (auth-only) mode - `pay_x402_siwx` (POST /v1/agent/actions/x402-siwx).** For wallet-gated routes that don't take payment - e.g. agon's Tokens API at `/v1/x402/tokens/...`. The 402 has `accepts: []` (no payment scheme) and a Sign-In-with-X CAIP-122 challenge in `extensions["sign-in-with-x"]`. LobsterPay signs the canonical SIWS message with the relayer ed25519 keypair and returns a base64 `signInWithXHeader` to put in `SIGN-IN-WITH-X` on the retry. No payment, no on-chain settlement; the signature is single-use and valid ~300s.

### How to tell which mode to use

Decode the 402's `Payment-Required` header (or body for legacy upstreams) and look at the JSON:

| What you see in the decoded 402 | Use |
|---|---|
| `accepts[0].scheme === "exact"` and **no** `extra.feePayer` (or the upstream verifies on-chain by tx-signature) | `pay_x402` |
| `accepts[0].scheme === "exact"` **with** `accepts[0].extra.feePayer` set | `pay_x402_facilitator` |
| `accepts: []` (empty) and `extensions["sign-in-with-x"]` present | `pay_x402_siwx` |

### 5. Facilitator-mode x402 (agonx402 et al.)

**Step 0 - find the paymentRequirements.** This is the easy thing to miss. Spec-conformant x402 v2 facilitator gateways (agonx402, Coinbase, etc.) put the requirements in the **`Payment-Required` response header**, base64-encoded JSON, NOT in the response body. The body is typically a tiny `{"ok":false,"error":"Payment required"}` stub. Decode the header and read `accepts[0]`:

```js
const r = await fetch(url, { method: "POST", body: ... });
// r.status === 402
const pr = JSON.parse(
  Buffer.from(r.headers.get("payment-required"), "base64").toString("utf8"),
).accepts[0];
```

**Step 1 - settle via LobsterPay.** Forward the entire `accepts[i]` object to the facilitator endpoint:

```
POST /v1/agent/actions/x402-facilitator
{
  "paymentRequirements": {
    "scheme": "exact",
    "network": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    "amount": "605",
    "asset": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    "payTo": "FACILITATOR_FEE_PAYER_PUBKEY",
    "maxTimeoutSeconds": 300,
    "extra": { "feePayer": "FACILITATOR_FEE_PAYER_PUBKEY" }
  },
  "originalRequestUrl": "https://gateway.agonx402.com/v1/x402/solana/devnet/helius/rpc/getAccountInfo"
}
```

The `extra.feePayer` field is REQUIRED - without it, LobsterPay returns a 403. You pay `agonAmount × 1.015` from your vault (the 1.5% markup is LobsterPay's service fee). On success (status: `awaiting_facilitator`) you get back `paymentSignatureHeader` + the on-chain `tx1Signature` for the vault → relayer settlement.

**Step 2 - retry the original URL with the proof:**

```
PAYMENT-SIGNATURE: <paymentSignatureHeader>
```

Same body as your original request. Gateway co-signs + submits tx2 only after the upstream API returns 200, so the upstream content + the settlement happen atomically. Inspect the `PAYMENT-RESPONSE` response header (also base64 JSON) for the gateway's tx2 signature - useful for audit logs.

**Blockhash expiry.** The facilitator must submit tx2 within ~60-90s of LobsterPay building it. If they're slow, call `pay_x402_facilitator` again with a **fresh** `idempotencyKey` - retrying the SAME key returns the stale row.

**Which mode to use.** If the 402 includes `extra.feePayer` (or the gateway docs mention "facilitator submits"), use `pay_x402_facilitator`. Otherwise (paywalls that verify by on-chain tx-signature lookup) use `pay_x402`.

**Reference implementation.** A working end-to-end script lives at `scripts/agon-via-lp-facilitator.mjs` in the LobsterPay repo. It does exactly steps 0 - 2 above against agonx402's devnet `getAccountInfo` endpoint and was verified live on 2026-04-24 (tx1 `5N61j…XH3` settled vault→relayer, tx2 `2vanr…EaX` submitted by agon).

### 6. SIWX (auth-only) routes (agon Tokens API et al.)

**When to use.** Some upstreams gate access on a wallet signature instead of a payment - e.g. `https://gateway.agonx402.com/v1/x402/tokens/...`. Their 402 looks like:

```json
{
  "x402Version": 2,
  "accepts": [],
  "extensions": {
    "sign-in-with-x": {
      "info": { "domain": "gateway.agonx402.com", "uri": "...", "nonce": "...", "issuedAt": "...", "expirationTime": "...", "statement": "..." },
      "supportedChains": [ { "chainId": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", "type": "ed25519" } ]
    }
  }
}
```

**Step 1 - sign via LobsterPay.** Forward the raw `Payment-Required` header value:

```
POST /v1/agent/actions/x402-siwx
{
  "paymentRequiredHeader": "<raw base64 from r.headers.get('payment-required')>",
  "originalRequestUrl": "https://gateway.agonx402.com/v1/x402/tokens/assets/solana/profile",
  "chainId": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"
}
```

(`chainId` is optional - defaults to the first ed25519 chain in `supportedChains`. Pin it explicitly if the upstream supports both mainnet and devnet and you want to make sure you're hitting the right one.)

You get back `{ status: "authorized", signInWithXHeader, address, chainId, expirationTime }`. The `address` is the relayer pubkey that signed the challenge - that's the wallet identity the upstream will see.

**Step 2 - retry with the signed header:**

```
SIGN-IN-WITH-X: <signInWithXHeader>
```

Same method + body as the original request. Upstream verifies the signature, returns 200 + the API response. **No PAYMENT-RESPONSE header** on SIWX flows (no settlement happened).

**Single-use + 300s window.** Each `signInWithXHeader` is valid for ~300 seconds and gets one shot - replays are rejected. If you need another call, call `pay_x402_siwx` again to get a fresh signature.

**Reference implementation.** End-to-end script at `scripts/agon-via-lp-siwx.mjs` - verified live against agon Tokens API on 2026-04-24.

## Rules

1. **Always use unique idempotency keys.** Format: `{action}-{purpose}-{date/counter}`. Safe to retry.
2. **Check your budget before large payments.** Call `GET /v1/agent/vault` first.
3. **Amounts are always in atomic units.** USDC (6 decimals): multiply dollars by 1,000,000.
4. **Destinations must be pre-approved** by the vault owner. If a payment is rejected with "destination not allowed", ask the user to add the destination to their vault policy.
5. **Handle errors gracefully.** 403 = policy rejection (limits, paused, not allowed). 401 = key revoked.
6. **Never retry without checking idempotency.** If you get a timeout, the payment may have gone through. Use the same idempotency key to check.

## Common Token Mints (Solana)

- **USDC:** `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- **SOL (wrapped):** `So11111111111111111111111111111111111111112`
- **USDT:** `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`
