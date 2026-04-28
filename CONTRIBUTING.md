# Contributing

Thanks for considering a contribution. LobsterPay is a hackathon project but PRs are welcome.

## Setup

See [Quick Start](./README.md#quick-start) in the README. You need:

- Node.js 20+
- pnpm 9+
- Rust 1.92+
- Solana CLI 3.x
- Anchor CLI **0.31.1** (not 0.30.x - it does not build with modern Rust)
- Docker (for Postgres)

## Workflow

1. Fork the repo and create a feature branch off `main`.
2. Make your change. Keep PRs focused - one logical change per PR.
3. Run locally before pushing:
   ```bash
   pnpm -r build
   pnpm exec biome ci .
   anchor test   # if you touched programs/lobsterpay
   ```
4. Open a PR using the template. Link any related issue.

## Style

- TypeScript: Biome formatting (`pnpm exec biome format --write .`).
- Rust: `cargo fmt` + `cargo clippy --all-targets`.
- Commits: short imperative subject. Optional Conventional Commits prefix (`feat:`, `fix:`, `chore:`, `docs:`).
- No em-dashes anywhere - in code, comments, copy, or commit messages. Use `-`.

## Security-sensitive changes

Anything touching the Anchor program, the relayer keypair, API key storage, or policy enforcement gets extra scrutiny:

- Include test coverage for the new behavior and for the threat it mitigates.
- Call out the threat model in the PR description (what could an attacker do before / after).
- For program changes, document any change to the on-chain account layout - those are not backwards-compatible without a migration path.

## Reporting vulnerabilities

Do not open a public issue. Follow [SECURITY.md](./SECURITY.md).
