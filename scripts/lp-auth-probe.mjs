#!/usr/bin/env node
// Isolate where the 502 on /v1/agent/vault comes from.

import fs from "node:fs";

const env = Object.fromEntries(
  fs
    .readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const KEY = env.LOBSTERPAY_API;
const BASE = "https://api.lobsterpay.xyz";

async function probe(label, pathName, auth = KEY) {
  const headers = { "Content-Type": "application/json" };
  if (auth !== null) headers.Authorization = `Bearer ${auth}`;
  const res = await fetch(`${BASE}${pathName}`, { headers });
  const text = await res.text();
  const snippet = text.length > 200 ? text.slice(0, 200) + "…" : text;
  console.log(
    `[${label}] ${pathName}  ${auth === null ? "(no auth)" : auth === "bogus" ? "(bogus auth)" : "(real auth)"}`,
  );
  console.log(`  status: ${res.status}`);
  console.log(`  body:   ${snippet}`);
  console.log("");
}

console.log("Probing LobsterPay auth paths on", BASE);
console.log("");

await probe("no auth vault", "/v1/agent/vault", null);
await probe("bad auth vault", "/v1/agent/vault", "bogus");
await probe("real auth vault", "/v1/agent/vault");
await probe("real auth activity", "/v1/agent/vault/activity");
await probe("real auth activity (alt)", "/v1/agent/activity");
await probe("no auth health", "/health", null);
