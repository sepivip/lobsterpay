#!/usr/bin/env node
// Probe the live LobsterPay API with the dev API key. Confirms auth
// works, shows vault info, lists policy, and then attempts a tiny
// devnet x402 call through LobsterPay's current /v1/agent/actions/x402
// endpoint using agon's 402 as the paymentRequirements. We then forward
// LobsterPay's response to agon — expect agon to reject because the
// current endpoint returns a POST-settled xPaymentHeader (containing a
// tx signature), not a pre-signed unsubmitted tx per the x402 SVM spec.
//
// Run: node scripts/lobsterpay-api-probe.mjs

import fs from "node:fs";

// Load LOBSTERPAY_API from .env (one-line .env only — no parser dep).
const envRaw = fs.readFileSync(".env", "utf8");
const envMap = Object.fromEntries(
  envRaw
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const LP_KEY = envMap.LOBSTERPAY_API;
if (!LP_KEY) {
  console.error("LOBSTERPAY_API missing from .env");
  process.exit(1);
}

const LP_BASE = "https://api.lobsterpay.xyz";
const AGON_ENDPOINT =
  "https://gateway.agonx402.com/v1/x402/solana/devnet/helius/rpc/getBalance";
const RPC_BODY = { params: ["GQUtvPx89ZNCwmvQqFmH59bJcU8fW8siETpaxod7Aydz"] };

function hr(t) {
  console.log(`\n=== ${t} ===`);
}

async function lp(method, pathName, body) {
  const res = await fetch(`${LP_BASE}${pathName}`, {
    method,
    headers: {
      Authorization: `Bearer ${LP_KEY}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, text, json };
}

// ── Sanity: auth + vault info ─────────────────────────────────────────────
hr("1. LobsterPay API sanity check");
const vault = await lp("GET", "/v1/agent/vault");
console.log("Status:", vault.status);
if (vault.status !== 200) {
  console.error("Auth failed or API unreachable:", vault.text.slice(0, 200));
  process.exit(1);
}
const v = vault.json;
console.log("Vault ID:", v.vaultId ?? v.id);
console.log("Vault PDA:", v.vaultPda ?? v.pda);
console.log("Cluster:", v.cluster ?? v.network);
console.log("Paused:", v.paused);
console.log("Allowed actions bitmask:", v.allowedActions);
console.log("Per-tx limit (atomic):", v.maxPerTxAmountAtomic);
console.log("Daily limit (atomic):", v.dailyLimitAmountAtomic);
console.log("Balances:", JSON.stringify(v.balances, null, 2));

// ── Fetch agon 402 ────────────────────────────────────────────────────────
hr("2. Fetch agon 402 challenge (devnet helius getBalance)");
const r402 = await fetch(AGON_ENDPOINT, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(RPC_BODY),
});
const challenge = JSON.parse(
  Buffer.from(r402.headers.get("payment-required"), "base64").toString(),
);
const accept = challenge.accepts[0];
console.log("Accept:", JSON.stringify(accept, null, 2));

// ── Call LobsterPay's /v1/agent/actions/x402 (existing submit-mode) ──────
hr("3. Call LobsterPay /v1/agent/actions/x402 with agon's accept object");
const lpX402 = await lp("POST", "/v1/agent/actions/x402", {
  paymentRequirements: accept,
  originalRequestUrl: AGON_ENDPOINT,
  idempotencyKey: `agon-incompat-test-${Date.now()}`,
});
console.log("LobsterPay status:", lpX402.status);
console.log("LobsterPay body:", JSON.stringify(lpX402.json, null, 2));

if (lpX402.status !== 200 || !lpX402.json?.xPaymentHeader) {
  console.log(
    "\n⚠️  LobsterPay could not produce an xPaymentHeader. Stopping here.",
  );
  console.log(
    "(Possibly because the destination agon.payTo is not in the vault's allowlist,",
  );
  console.log(
    "or the vault has no balance of agon's devnet USDC mint. Either reason is",
  );
  console.log(
    "informative but doesn't test the incompatibility claim. We'd need the",
  );
  console.log(
    "vault to have a small amount of that specific devnet USDC and allowlist",
  );
  console.log("agon's payTo wallet as a destination to actually test.");
  process.exit(0);
}

// ── Try forwarding LobsterPay's xPaymentHeader to agon ───────────────────
hr("4. Forward LobsterPay's xPaymentHeader as PAYMENT-SIGNATURE to agon");
const retry = await fetch(AGON_ENDPOINT, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "PAYMENT-SIGNATURE": lpX402.json.xPaymentHeader,
  },
  body: JSON.stringify(RPC_BODY),
});
console.log("Agon status:", retry.status);
const agonBody = await retry.text();
console.log("Agon body:", agonBody);
const agonChallenge = retry.headers.get("payment-required");
if (agonChallenge && retry.status === 402) {
  try {
    const c = JSON.parse(Buffer.from(agonChallenge, "base64").toString());
    console.log("Agon error detail:", c.error);
  } catch {}
}

hr("done");
