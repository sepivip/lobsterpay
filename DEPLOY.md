# Deploying LobsterPay to Railway

This guide walks you through deploying the LobsterPay monorepo (API + Web + Postgres) to [Railway](https://railway.com).

## Architecture

Railway will host three services in a single project:

1. **Postgres** — managed database plugin
2. **API** — Fastify backend (`apps/api`)
3. **Web** — Next.js 15 frontend (`apps/web`)

Both the API and Web deploy from the same GitHub repo but as separate services. Each service has its own `railway.json` in its app directory, and the repo root contains a shared `nixpacks.toml`.

---

## Prerequisites

- A [Railway account](https://railway.com) (free tier works for initial testing)
- Your LobsterPay repo pushed to GitHub
- [Railway CLI](https://docs.railway.com/guides/cli) installed locally (optional but handy):
  ```bash
  npm i -g @railway/cli
  railway login
  ```
- A Solana fee-payer keypair (see "Generating FEE_PAYER_SECRET_KEY" below)

---

## Step 1 — Create the Railway project

1. Go to [railway.com/new](https://railway.com/new) and pick **Deploy from GitHub repo**.
2. Authorize Railway to access your GitHub account if you haven't already, then pick your LobsterPay repo.
3. Railway will spin up a first service automatically. Delete it — we'll create all three services explicitly in the next steps.

---

## Step 2 — Add Postgres

1. In your project dashboard, click **+ New** -> **Database** -> **Add PostgreSQL**.
2. Wait for it to provision. The plugin exposes `DATABASE_URL`, `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` automatically.
3. Click on the Postgres service, open the **Variables** tab, and copy the value of `DATABASE_URL` — you'll reference it from the API service.

---

## Step 3 — Deploy the API service

1. Click **+ New** -> **GitHub Repo** -> select your LobsterPay repo.
2. Name the service `lobsterpay-api`.
3. Go to **Settings**:
   - **Root Directory**: leave blank (repo root). The `apps/api/railway.json` is picked up via the **Config Path** setting below.
   - **Config Path**: `apps/api/railway.json`
   - **Watch Paths** (optional): `apps/api/**` and `packages/shared/**` and `packages/sdk/**`
4. Go to **Variables** and add:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (reference the Postgres service) |
   | `SOLANA_RPC_URL` | `https://api.devnet.solana.com` (or your preferred RPC) |
   | `SOLANA_CLUSTER` | `devnet` |
   | `LOBSTERPAY_PROGRAM_ID` | your deployed program ID |
   | `FEE_PAYER_SECRET_KEY` | base58-encoded secret key (see below) |
   | `ALLOWED_ORIGIN` | `https://your-web-service.up.railway.app` |
   | `LOG_LEVEL` | `info` |
   | `API_HOST` | `0.0.0.0` |
   | `REDIS_URL` | (optional) Redis connection string |

   Note: `API_PORT` is set automatically by Railway via `$PORT`. Fastify binds to it through the `API_PORT` env var — if you want Railway's assigned port, set `API_PORT=${{PORT}}` in the variables.

5. Click **Deploy**. Railway runs:
   - **Build**: `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @lobsterpay/shared build && pnpm --filter @lobsterpay/api build`
   - **Start**: `pnpm --filter @lobsterpay/api release && pnpm --filter @lobsterpay/api start`

   The `release` script runs database migrations before the server starts. If migrations fail, the deploy fails — check logs and fix before retrying.

6. Once deployed, click **Settings** -> **Networking** -> **Generate Domain** to get a public URL (e.g. `lobsterpay-api.up.railway.app`). Test it:
   ```bash
   curl https://lobsterpay-api.up.railway.app/health
   # {"status":"ok"}
   ```

---

## Step 4 — Deploy the Web service

1. Click **+ New** -> **GitHub Repo** -> select your LobsterPay repo again.
2. Name it `lobsterpay-web`.
3. In **Settings**:
   - **Root Directory**: leave blank
   - **Config Path**: `apps/web/railway.json`
   - **Watch Paths**: `apps/web/**` and `packages/shared/**` and `packages/sdk/**`
4. In **Variables** add:

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_API_URL` | `https://lobsterpay-api.up.railway.app` |
   | `NEXT_PUBLIC_SOLANA_RPC_URL` | `https://api.devnet.solana.com` |

   These are baked into the client bundle at build time, so if you change them you need to trigger a redeploy.

5. Click **Deploy**, then generate a domain under **Networking**.

6. **Important**: go back to the API service's `ALLOWED_ORIGIN` variable and set it to the Web service's public URL (e.g. `https://lobsterpay-web.up.railway.app`), then redeploy the API so CORS lets the frontend through.

---

## Generating FEE_PAYER_SECRET_KEY

The API expects a base58-encoded 64-byte Solana keypair secret. Generate one locally:

```bash
# Create a new keypair (writes to ~/lobsterpay-fee-payer.json)
solana-keygen new --outfile ~/lobsterpay-fee-payer.json --no-bip39-passphrase

# Print the public key so you can fund it
solana-keygen pubkey ~/lobsterpay-fee-payer.json

# Airdrop some devnet SOL for gas
solana airdrop 2 $(solana-keygen pubkey ~/lobsterpay-fee-payer.json) --url devnet

# Convert the JSON byte array to base58 (copy this into Railway)
node -e "const bs58=require('bs58').default||require('bs58');const k=require('/Users/YOU/lobsterpay-fee-payer.json');console.log(bs58.encode(Uint8Array.from(k)))"
```

Paste the base58 string into the Railway `FEE_PAYER_SECRET_KEY` variable. **Never commit this value to git.**

If you deploy without setting `FEE_PAYER_SECRET_KEY`, the API will boot (with a warning) but payment routes that need to sign transactions will fail.

---

## Custom domain setup

For each service:

1. Go to **Settings** -> **Networking** -> **Custom Domain**.
2. Enter your domain (e.g. `api.lobsterpay.xyz`).
3. Railway shows you a `CNAME` record to add at your DNS provider.
4. After DNS propagates (a few minutes to an hour), the domain goes green and gets an auto-provisioned TLS cert.

Remember to update `ALLOWED_ORIGIN` on the API and `NEXT_PUBLIC_API_URL` on the Web service whenever URLs change, then redeploy.

---

## Connecting Railway Postgres from your local machine

1. Open the Postgres service and go to the **Data** or **Connect** tab.
2. Copy the `postgres://...` connection string (the **public** one, not the internal `${{Postgres.DATABASE_URL}}`).
3. Use it with any Postgres client:
   ```bash
   psql "postgres://postgres:PASSWORD@host.railway.app:PORT/railway"
   ```
4. To run migrations from your laptop against Railway:
   ```bash
   DATABASE_URL="postgres://..." pnpm --filter @lobsterpay/api db:migrate
   ```

---

## Tailing logs

**Via dashboard**: click the service, then the **Deployments** tab, then the active deployment. Logs stream live.

**Via CLI**:
```bash
railway link                         # pick your project
railway service                      # pick the service
railway logs                         # tail live logs
railway logs --deployment            # logs for a specific deployment
```

---

## Troubleshooting

### Build fails with "command not found: pnpm"
The `nixpacks.toml` at repo root enables corepack and activates pnpm 9.15.4. If this fails, check that the root `package.json` still has `"packageManager": "pnpm@9.15.4"`.

### `@lobsterpay/shared` not found at runtime
The build command explicitly runs `pnpm --filter @lobsterpay/shared build` before building each app. If you see a missing-dist error, verify `packages/shared/package.json` has a `build` script that emits to `dist/`.

### Cold start / healthcheck timeout
Default `healthcheckTimeout` in `apps/api/railway.json` is 30 seconds. If migrations are slow on first deploy, bump it to 90. The `/health` endpoint only returns once the Fastify server is listening, so anything slow in `main()` delays readiness.

### Migrations fail on deploy
The `release` script runs `tsx src/db/migrate.ts` before `start`. If migrations fail the deploy fails. Check:
- `DATABASE_URL` is wired to the Postgres service correctly
- The migration SQL is valid (run locally against the Railway DB to reproduce)
- The Postgres service is in the same Railway project so the internal URL works

### CORS errors in the browser
Make sure `ALLOWED_ORIGIN` on the API matches the exact Web origin (no trailing slash). If you serve the web on both a Railway-generated domain AND a custom domain, pass both comma-separated:
```
ALLOWED_ORIGIN=https://lobsterpay-web.up.railway.app,https://app.lobsterpay.xyz
```

### Skill files return 404
The API serves `src/skills/*.json` and `*.md` through `/v1/skills/download/:format`. During build, `node -e "fs.cpSync('src/skills', 'dist/skills', { recursive: true })"` copies those assets into `dist/`. If 404s happen, inspect the build logs and confirm the `cpSync` step ran.

### `FEE_PAYER_SECRET_KEY` crash on boot
The env schema now marks it optional — the API boots with a warning if missing. If you still see a crash, you're probably on an older build; force a redeploy after pushing the schema change.

### Environment variable not picked up by Next.js
Next.js bakes `NEXT_PUBLIC_*` vars at **build** time. If you change one, trigger a redeploy — don't just restart.

---

## Local development vs Railway parity

Keep a `.env.example` at repo root listing every env var each service needs. When onboarding a new Railway environment, duplicate the existing one via **Settings** -> **Duplicate Environment** rather than hand-copying variables.
