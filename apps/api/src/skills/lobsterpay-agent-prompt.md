---
name: lobsterpay
description: Permissioned payment layer for AI agents on Solana. Make payments, swaps, and x402 purchases through a policy-controlled vault — no private keys needed.
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

You have access to a LobsterPay vault — a permissioned payment system on Solana. You can make payments, swaps, and pay for 402-gated services within the limits set by the vault owner.

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

### Compatibility limits

LobsterPay's `pay_x402` works with upstream APIs that verify payment by looking up the Solana tx signature on-chain (like our `/v1/demo/x402/fortune` and `/v1/demo/x402/joke` reference endpoints).

It does **not** work with spec-conformant x402 *facilitator* gateways (e.g. agonx402, Coinbase's reference facilitator) that expect a pre-signed unsubmitted transaction which the facilitator itself submits after upstream succeeds. LobsterPay's vaults are program-derived addresses (PDAs), and PDAs cannot produce pre-signed tx blobs - so that flow is structurally not possible with the LobsterPay model. If the 402 you received points at a facilitator URL and expects that flow, skip `pay_x402` and use a wallet-based client instead.

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
