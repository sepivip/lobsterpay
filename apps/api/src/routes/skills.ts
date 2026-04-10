import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function skillRoutes(app: FastifyInstance) {
	// GET /v1/skills — list available skill formats
	app.get("/v1/skills", async () => ({
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

	// GET /v1/skills/download/:format — download a specific skill file
	app.get("/v1/skills/download/:format", async (request, reply) => {
		const { format } = request.params as { format: string };

		switch (format) {
			case "skill.json": {
				const content = await readFile(
					join(__dirname, "../skills/lobsterpay-skill.json"),
					"utf-8",
				);
				return reply
					.header("Content-Type", "application/json")
					.header(
						"Content-Disposition",
						'attachment; filename="lobsterpay-skill.json"',
					)
					.send(content);
			}

			case "agent-prompt.md": {
				const content = await readFile(
					join(__dirname, "../skills/lobsterpay-agent-prompt.md"),
					"utf-8",
				);
				return reply
					.header("Content-Type", "text/markdown")
					.header(
						"Content-Disposition",
						'attachment; filename="lobsterpay-agent-prompt.md"',
					)
					.send(content);
			}

			case "openapi.json": {
				const spec = buildOpenApiSpec();
				return reply
					.header("Content-Type", "application/json")
					.header(
						"Content-Disposition",
						'attachment; filename="lobsterpay-openapi.json"',
					)
					.send(JSON.stringify(spec, null, 2));
			}

			case "mcp-config.json": {
				const config = {
					mcpServers: {
						lobsterpay: {
							command: "npx",
							args: ["-y", "@lobsterpay/mcp-server"],
							env: {
								LOBSTERPAY_API_KEY: "lp_live_YOUR_KEY_HERE",
								LOBSTERPAY_API_URL: "http://localhost:3001",
							},
						},
					},
				};
				return reply
					.header("Content-Type", "application/json")
					.header(
						"Content-Disposition",
						'attachment; filename="lobsterpay-mcp-config.json"',
					)
					.send(JSON.stringify(config, null, 2));
			}

			default:
				return reply
					.status(404)
					.send({ code: "not_found", message: `Unknown format: ${format}` });
		}
	});
}

function buildOpenApiSpec() {
	return {
		openapi: "3.0.3",
		info: {
			title: "LobsterPay Agent API",
			version: "0.1.0",
			description:
				"Permissioned payment API for AI agents on Solana. Authenticate with an API key to make payments, swaps, and x402 purchases within vault policy limits.",
		},
		servers: [{ url: "{baseUrl}", variables: { baseUrl: { default: "http://localhost:3001" } } }],
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
