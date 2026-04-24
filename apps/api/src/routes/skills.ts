import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "../config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const API_URL_PLACEHOLDER = "{LOBSTERPAY_API_URL}";
const VERSION_PLACEHOLDER = "{SKILL_VERSION}";
const UPDATED_PLACEHOLDER = "{SKILL_UPDATED}";

interface SkillsManifest {
	version: string;
	updated: string;
	changelog: Array<{ version: string; date: string; notes: string }>;
}

function loadManifest(): SkillsManifest {
	const raw = readFileSync(
		join(__dirname, "../skills/skills-manifest.json"),
		"utf-8",
	);
	return JSON.parse(raw) as SkillsManifest;
}

export function skillRoutes(app: FastifyInstance, config: Config) {
	const apiUrl = config.PUBLIC_API_URL.replace(/\/$/, "");
	const manifest = loadManifest();

	const applyPlaceholders = (text: string): string =>
		text
			.split(API_URL_PLACEHOLDER)
			.join(apiUrl)
			.split(VERSION_PLACEHOLDER)
			.join(manifest.version)
			.split(UPDATED_PLACEHOLDER)
			.join(manifest.updated);

	// GET /v1/skills — list available skill formats + current version
	app.get("/v1/skills", async () => ({
		version: manifest.version,
		updated: manifest.updated,
		formats: [
			{
				id: "skill-json",
				name: "Skill JSON",
				description:
					"Structured tool definitions for agent frameworks. Includes auth, endpoints, parameters, and response schemas.",
				downloadUrl: "/v1/skills/download/skill.json",
				contentType: "application/json",
			},
			{
				id: "agent-prompt",
				name: "Agent Prompt",
				description:
					"Plain-text instructions for LLM-based agents. Copy-paste into your agent's system prompt.",
				downloadUrl: "/v1/skills/download/agent-prompt.md",
				contentType: "text/markdown",
			},
			{
				id: "openapi",
				name: "OpenAPI Spec",
				description:
					"OpenAPI 3.0 specification for the agent API. Works with any OpenAPI-compatible tool.",
				downloadUrl: "/v1/skills/download/openapi.json",
				contentType: "application/json",
			},
			{
				id: "mcp-config",
				name: "MCP Server Config",
				description:
					"Configuration snippet for Claude Code / Claude Desktop MCP integration.",
				downloadUrl: "/v1/skills/download/mcp-config.json",
				contentType: "application/json",
			},
		],
	}));

	// GET /v1/skills/version — lightweight version check endpoint.
	// Agents can poll this cheaply to detect when they should re-download.
	app.get("/v1/skills/version", async () => ({
		version: manifest.version,
		updated: manifest.updated,
		changelog: manifest.changelog,
	}));

	// GET /v1/skills/download/:format — download a specific skill file
	app.get("/v1/skills/download/:format", async (request, reply) => {
		const { format } = request.params as { format: string };

		switch (format) {
			case "skill.json": {
				const raw = await readFile(
					join(__dirname, "../skills/lobsterpay-skill.json"),
					"utf-8",
				);
				return reply
					.header("Content-Type", "application/json")
					.header("X-Skill-Version", manifest.version)
					.header(
						"Content-Disposition",
						'attachment; filename="lobsterpay-skill.json"',
					)
					.send(applyPlaceholders(raw));
			}

			case "agent-prompt.md": {
				const raw = await readFile(
					join(__dirname, "../skills/lobsterpay-agent-prompt.md"),
					"utf-8",
				);
				return reply
					.header("Content-Type", "text/markdown")
					.header("X-Skill-Version", manifest.version)
					.header(
						"Content-Disposition",
						'attachment; filename="lobsterpay-agent-prompt.md"',
					)
					.send(applyPlaceholders(raw));
			}

			case "openapi.json": {
				const spec = buildOpenApiSpec(apiUrl, manifest.version);
				return reply
					.header("Content-Type", "application/json")
					.header("X-Skill-Version", manifest.version)
					.header(
						"Content-Disposition",
						'attachment; filename="lobsterpay-openapi.json"',
					)
					.send(JSON.stringify(spec, null, 2));
			}

			case "mcp-config.json": {
				const mcpConfig = {
					_comment: `LobsterPay MCP config · skill version ${manifest.version} · updated ${manifest.updated}`,
					mcpServers: {
						lobsterpay: {
							command: "npx",
							args: ["-y", "@lobsterpay/mcp-server"],
							env: {
								LOBSTERPAY_API_KEY: "lp_live_YOUR_KEY_HERE",
								LOBSTERPAY_API_URL: apiUrl,
							},
						},
					},
				};
				return reply
					.header("Content-Type", "application/json")
					.header("X-Skill-Version", manifest.version)
					.header(
						"Content-Disposition",
						'attachment; filename="lobsterpay-mcp-config.json"',
					)
					.send(JSON.stringify(mcpConfig, null, 2));
			}

			default:
				return reply
					.status(404)
					.send({ code: "not_found", message: `Unknown format: ${format}` });
		}
	});
}

function buildOpenApiSpec(apiUrl: string, version: string) {
	return {
		openapi: "3.0.3",
		info: {
			title: "LobsterPay Agent API",
			version,
			description:
				"Permissioned payment API for AI agents on Solana. Authenticate with an API key to make payments, swaps, and x402 purchases within vault policy limits.",
		},
		servers: [{ url: apiUrl }],
		security: [{ bearerAuth: [] }],
		components: {
			securitySchemes: {
				bearerAuth: { type: "http", scheme: "bearer", description: "LobsterPay API key" },
			},
			schemas: {
				ActionResult: {
					type: "object",
					properties: {
						requestId: { type: "string" },
						txSignature: { type: "string", nullable: true },
						status: { type: "string", enum: ["confirmed", "failed", "pending_confirmation", "created"] },
						error: { type: "string", nullable: true },
					},
				},
			},
		},
		paths: {
			"/v1/agent/vault": {
				get: {
					operationId: "checkVault",
					summary: "Check vault status, balances, and permissions",
					responses: { "200": { description: "Vault info" } },
				},
			},
			"/v1/agent/actions/pay": {
				post: {
					operationId: "makePayment",
					summary: "Send tokens to an approved destination",
					requestBody: {
						required: true,
						content: {
							"application/json": {
								schema: {
									type: "object",
									required: ["mint", "amountAtomic", "destinationOwner", "idempotencyKey"],
									properties: {
										mint: { type: "string", description: "SPL token mint address" },
										amountAtomic: { type: "string", description: "Amount in atomic units" },
										destinationOwner: { type: "string", description: "Recipient wallet address" },
										idempotencyKey: { type: "string", description: "Unique payment identifier" },
										memo: { type: "string", description: "Optional memo" },
									},
								},
							},
						},
					},
					responses: {
						"200": { description: "Payment result", content: { "application/json": { schema: { $ref: "#/components/schemas/ActionResult" } } } },
						"403": { description: "Policy rejection" },
					},
				},
			},
			"/v1/agent/quotes/swap": {
				post: {
					operationId: "getSwapQuote",
					summary: "Get a swap quote",
					requestBody: {
						required: true,
						content: {
							"application/json": {
								schema: {
									type: "object",
									required: ["fromMint", "toMint", "amountAtomic"],
									properties: {
										fromMint: { type: "string" },
										toMint: { type: "string" },
										amountAtomic: { type: "string" },
										maxSlippageBps: { type: "number", default: 100 },
									},
								},
							},
						},
					},
					responses: { "200": { description: "Swap quote" } },
				},
			},
			"/v1/agent/actions/swap": {
				post: {
					operationId: "executeSwap",
					summary: "Execute a token swap",
					requestBody: {
						required: true,
						content: {
							"application/json": {
								schema: {
									type: "object",
									required: ["fromMint", "toMint", "amountAtomic", "idempotencyKey"],
									properties: {
										fromMint: { type: "string" },
										toMint: { type: "string" },
										amountAtomic: { type: "string" },
										maxSlippageBps: { type: "number", default: 100 },
										idempotencyKey: { type: "string" },
									},
								},
							},
						},
					},
					responses: {
						"200": { description: "Swap result", content: { "application/json": { schema: { $ref: "#/components/schemas/ActionResult" } } } },
					},
				},
			},
			"/v1/agent/actions/x402": {
				post: {
					operationId: "payX402",
					summary: "Pay a 402-gated endpoint",
					requestBody: {
						required: true,
						content: {
							"application/json": {
								schema: {
									type: "object",
									required: ["paymentRequirements", "originalRequestUrl", "idempotencyKey"],
									properties: {
										paymentRequirements: { type: "object", description: "Payment requirements from 402 response" },
										originalRequestUrl: { type: "string", format: "uri" },
										idempotencyKey: { type: "string" },
									},
								},
							},
						},
					},
					responses: {
						"200": { description: "x402 payment result" },
					},
				},
			},
				"/v1/agent/actions/x402-facilitator": {
					post: {
						operationId: "payX402Facilitator",
						summary: "Pay a 402-gated endpoint via a spec-conformant x402 facilitator gateway (agonx402, Coinbase reference facilitator)",
						description:
							"Returns a partial-signed v0 transferChecked tx wrapped in the x402 PAYMENT-SIGNATURE envelope for the facilitator to co-sign and submit. Internally does two txs: vault → relayer (execute_pay_exact, 1.5% fee to treasury) then relayer → facilitator (partial-signed, returned to agent). Requires the 402's paymentRequirements.extra.feePayer to be set — that's the facilitator's published fee-payer pubkey.",
						requestBody: {
							required: true,
							content: {
								"application/json": {
									schema: {
										type: "object",
										required: ["paymentRequirements", "originalRequestUrl"],
										properties: {
											paymentRequirements: {
												type: "object",
												description: "Full accepts[i] object from the 402. MUST include extra.feePayer.",
											},
											originalRequestUrl: { type: "string", format: "uri" },
											idempotencyKey: { type: "string" },
										},
									},
								},
							},
						},
						responses: {
							"200": {
								description:
									"tx1 (vault → relayer) settled; partial-signed tx2 ready for the facilitator",
								content: {
									"application/json": {
										schema: {
											type: "object",
											properties: {
												requestId: { type: "string" },
												status: { type: "string", enum: ["awaiting_facilitator"] },
												paymentId: { type: "string", nullable: true },
												paymentSignatureHeader: {
													type: "string",
													description: "Base64 x402 v2 envelope — put this in PAYMENT-SIGNATURE on retry",
												},
												partialTransactionBase64: { type: "string" },
												tx1Signature: { type: "string" },
												feePayer: { type: "string" },
												authority: { type: "string" },
												blockhash: { type: "string" },
												lastValidBlockHeight: { type: "integer" },
												expiresAt: { type: "string", format: "date-time" },
												grossAmount: { type: "string" },
												agonAmount: { type: "string" },
												serviceFee: { type: "string" },
											},
										},
									},
								},
							},
							"202": { description: "tx1 confirmation timed out" },
							"207": {
								description:
									"Multi-status: tx1 confirmed but tx2 build failed. Returned with status `tx1_confirmed_tx2_build_failed`. The vault → relayer settlement landed on-chain (vault USDC has moved); tx2 (relayer → facilitator's payTo) was not built so there is no PAYMENT-SIGNATURE to forward. Caller should investigate the error field; vault funds are recoverable via the relayer's USDC ATA on a follow-up.",
								content: {
									"application/json": {
										schema: {
											type: "object",
											properties: {
												requestId: { type: "string" },
												status: {
													type: "string",
													enum: ["tx1_confirmed_tx2_build_failed"],
												},
												error: { type: "string" },
												tx1Signature: {
													type: "string",
													description:
														"Confirmed Solana tx signature for the vault → relayer settlement (tx1). USDC has already moved.",
												},
												paymentId: { type: "string", nullable: true },
												paymentSignatureHeader: { type: "null" },
												partialTransactionBase64: { type: "null" },
											},
										},
									},
								},
							},
							"403": { description: "Policy rejection (paused, over-limit, missing extra.feePayer, invalid input)" },
							"409": { description: "Duplicate paymentId or concurrent retry" },
							"500": { description: "On-chain or infrastructure error" },
						},
					},
				},
				"/v1/agent/actions/x402-siwx": {
					post: {
						operationId: "payX402Siwx",
						summary: "Authenticate to a SIWX-gated x402 endpoint by signing the upstream's CAIP-122 challenge with the relayer ed25519 keypair (no payment, no settlement)",
						description:
							"For upstream gateways that gate routes with a Sign-In-with-X (CAIP-122) wallet signature instead of an x402 payment — e.g. agon's Tokens API. Decodes the upstream's `Payment-Required` header (or accepts the already-decoded SIWX challenge), signs the canonical SIWS message with the LobsterPay relayer keypair, and returns a base64 `signInWithXHeader` ready to use as the `SIGN-IN-WITH-X` header on the retry.",
						requestBody: {
							required: true,
							content: {
								"application/json": {
									schema: {
										type: "object",
										required: ["originalRequestUrl"],
										properties: {
											paymentRequiredHeader: {
												type: "string",
												description: "Raw base64 value of the upstream's `Payment-Required` response header. Either this or `siwxChallenge` is required.",
											},
											siwxChallenge: {
												type: "object",
												description: "Already-decoded SIWX extension object (`extensions['sign-in-with-x']` from the 402). Either this or `paymentRequiredHeader` is required.",
											},
											originalRequestUrl: { type: "string", format: "uri" },
											chainId: {
												type: "string",
												description: "CAIP-2 chainId to assert against. Must be in the upstream's `supportedChains[].chainId`. Defaults to the first ed25519 chain in the challenge.",
											},
											idempotencyKey: { type: "string" },
										},
									},
								},
							},
						},
						responses: {
							"200": {
								description: "Signed challenge ready to use as the SIGN-IN-WITH-X header",
								content: {
									"application/json": {
										schema: {
											type: "object",
											properties: {
												requestId: { type: "string" },
												status: { type: "string", enum: ["authorized"] },
												signInWithXHeader: {
													type: "string",
													description: "Base64-encoded SIWX payload — put this in the `SIGN-IN-WITH-X` header on the retry.",
												},
												address: { type: "string", description: "Relayer pubkey that signed the challenge." },
												chainId: { type: "string" },
												expirationTime: {
													type: "string",
													format: "date-time",
													nullable: true,
													description: "When the signature expires (typically 300s after issue). Replays are rejected by the upstream after this.",
												},
											},
										},
									},
								},
							},
							"400": { description: "Validation rejection (missing challenge, invalid chainId, no ed25519 chain, malformed input)" },
							"500": { description: "Infrastructure error (relayer unavailable)" },
						},
					},
				},
		},
	};
}
