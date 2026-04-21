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

When you get a 402 response with payment requirements:

```
POST /v1/agent/actions/x402
{
  "paymentRequirements": {
    "scheme": "exact",
    "network": "solana",
    "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "amount": "100000",
    "recipient": "SERVICE_WALLET"
  },
  "originalRequestUrl": "https://api.example.com/premium-data",
  "idempotencyKey": "x402-example-001"
}
```

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
