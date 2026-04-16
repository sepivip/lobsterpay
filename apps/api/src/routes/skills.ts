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
		},
	};
}
