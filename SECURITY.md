# Security Policy

## Supported versions

LobsterPay is currently deployed on Solana **devnet**. There is no mainnet deployment yet, so no funds are at risk in production. Once mainnet ships, this section will track supported program versions.

## Reporting a vulnerability

**Do not open a public GitHub issue for security reports.**

Use one of these private channels:

1. **GitHub Security Advisories** (preferred): https://github.com/sepivip/lobsterpay/security/advisories/new
2. **Email**: bekaz@adwise.ge with the subject line `[security] LobsterPay`

Please include:

- A description of the issue and its impact.
- Reproduction steps or a proof-of-concept.
- Whether the issue affects the Anchor program, the API, the frontend, or the SDK / MCP server.
- Any suggested mitigation, if you have one.

You will get an acknowledgment within 72 hours. If the report is in scope and reproducible, we will work with you on a coordinated disclosure timeline.

## In scope

- Anchor program at `programs/lobsterpay` (program id `A184DBQaCM6qWETbEDJUtr25bSuuTH72sTTixsyoZbtS` on devnet).
- API at `apps/api` - especially the auth middleware, policy enforcement, idempotency, and the relayer transaction builder.
- SDK and MCP server at `packages/sdk` and `packages/mcp-server` - especially anything touching API keys.
- Frontend at `apps/web` - wallet connection, signMessage flow, transaction signing.

## Out of scope

- Devnet treasury keypairs (placeholder; will be rotated before mainnet).
- Issues that require a compromised owner wallet or a compromised relayer key.
- Denial-of-service via free-tier abuse on devnet RPC endpoints.
- Issues that depend on social-engineering the maintainer.

## Acknowledgments

Security researchers who report valid issues will be credited in release notes (with permission) once the fix lands.
