"use client";

import { Nav } from "@/components/nav";
import toast from "react-hot-toast";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

const SKILL_FORMATS = [
	{
		id: "skill-json",
		icon: "{ }",
		title: "Skill JSON",
		description:
			"Structured tool definitions with auth, endpoints, parameters, and response schemas. Works with any agent framework that accepts tool specs.",
		filename: "skill.json",
		best: "Custom agent frameworks",
	},
	{
		id: "agent-prompt",
		icon: "📝",
		title: "Agent Prompt",
		description:
			"Plain-text instructions with examples. Copy-paste into your agent's system prompt or instruction file.",
		filename: "agent-prompt.md",
		best: "LLM-based agents (GPT, Claude API, etc.)",
	},
	{
		id: "openapi",
		icon: "📐",
		title: "OpenAPI Spec",
		description:
			"OpenAPI 3.0 specification. Import into Swagger, Postman, or any OpenAPI-compatible tool or agent.",
		filename: "openapi.json",
		best: "OpenAPI tools, Postman, code generation",
	},
	{
		id: "mcp-config",
		icon: "🔌",
		title: "MCP Server Config",
		description:
			"Drop-in config for Claude Code or Claude Desktop. Adds LobsterPay as native tools in your Claude session.",
		filename: "mcp-config.json",
		best: "Claude Code, Claude Desktop",
	},
];

function SkillCard({
	icon,
	title,
	description,
	filename,
	best,
}: {
	icon: string;
	title: string;
	description: string;
	filename: string;
	best: string;
}) {
	const handleDownload = async () => {
		try {
			const res = await fetch(`${API_URL}/v1/skills/download/${filename}`);
			if (!res.ok) throw new Error("Download failed");

			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = `lobsterpay-${filename}`;
			a.click();
			URL.revokeObjectURL(url);
			toast.success(`Downloaded ${filename}`);
		} catch {
			toast.error("Download failed — is the API running?");
		}
	};

	const handleCopyUrl = () => {
		navigator.clipboard.writeText(
			`${API_URL}/v1/skills/download/${filename}`,
		);
		toast.success("URL copied");
	};

	return (
		<div
			className="card"
			style={{
				padding: 24,
				display: "flex",
				flexDirection: "column",
				gap: 12,
			}}
		>
			<div style={{ display: "flex", alignItems: "center", gap: 12 }}>
				<div
					style={{
						fontSize: "1.25rem",
						width: 40,
						height: 40,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						background: "var(--bg-raised)",
						borderRadius: "var(--radius-md)",
						flexShrink: 0,
					}}
				>
					{icon}
				</div>
				<div>
					<div
						style={{
							fontSize: "1rem",
							fontWeight: 500,
							letterSpacing: "-0.01em",
							color: "var(--text-primary)",
						}}
					>
						{title}
					</div>
					<div className="label-mono" style={{ marginTop: 2 }}>
						{best}
					</div>
				</div>
			</div>

			<p
				style={{
					fontSize: "0.875rem",
					color: "var(--text-tertiary)",
					lineHeight: 1.5,
					flex: 1,
				}}
			>
				{description}
			</p>

			<div style={{ display: "flex", gap: 8 }}>
				<button className="btn btn-primary btn-sm" onClick={handleDownload}>
					Download
				</button>
				<button className="btn btn-ghost btn-sm" onClick={handleCopyUrl}>
					Copy URL
				</button>
			</div>
		</div>
	);
}

export default function IntegratePage() {
	return (
		<div style={{ minHeight: "100vh", background: "var(--bg-deep)" }}>
			<Nav />
			<main style={{ maxWidth: 1120, margin: "0 auto", padding: "32px 24px" }}>
				{/* Header */}
				<div className="animate-in" style={{ marginBottom: 12 }}>
					<h2 className="text-heading" style={{ marginBottom: 4 }}>
						Agent Integration
					</h2>
					<span className="label-mono">
						Download skills for your AI agents
					</span>
				</div>

				<p
					className="animate-in animate-delay-1"
					style={{
						fontSize: "0.9375rem",
						color: "var(--text-tertiary)",
						lineHeight: 1.6,
						maxWidth: 640,
						marginBottom: 32,
					}}
				>
					Give your agent a skill file and an API key. It will know how to
					check balances, make payments, swap tokens, and pay 402-gated
					endpoints — all within the limits you set in your vault policy.
				</p>

				{/* Quick start */}
				<div
					className="card animate-in animate-delay-2"
					style={{ padding: 24, marginBottom: 24 }}
				>
					<div className="label-mono" style={{ marginBottom: 12 }}>
						Quick Start
					</div>
					<div
						style={{
							display: "flex",
							gap: 24,
							flexWrap: "wrap",
						}}
					>
						<div style={{ flex: "1 1 300px" }}>
							<div
								style={{
									fontSize: "0.875rem",
									color: "var(--text-secondary)",
									marginBottom: 8,
								}}
							>
								<strong style={{ color: "var(--text-primary)" }}>1.</strong>{" "}
								Create an API key in the{" "}
								<a
									href="/keys"
									style={{ color: "var(--accent)", textDecoration: "none" }}
								>
									Keys tab
								</a>
							</div>
							<div
								style={{
									fontSize: "0.875rem",
									color: "var(--text-secondary)",
									marginBottom: 8,
								}}
							>
								<strong style={{ color: "var(--text-primary)" }}>2.</strong>{" "}
								Download a skill file below
							</div>
							<div
								style={{
									fontSize: "0.875rem",
									color: "var(--text-secondary)",
								}}
							>
								<strong style={{ color: "var(--text-primary)" }}>3.</strong>{" "}
								Add the skill + key to your agent
							</div>
						</div>
						<div style={{ flex: "1 1 300px" }}>
							<div className="label-mono" style={{ marginBottom: 8 }}>
								Example (fetch)
							</div>
							<pre
								style={{
									background: "var(--bg-base)",
									border: "1px solid var(--border-subtle)",
									borderRadius: "var(--radius-md)",
									padding: "12px 16px",
									fontSize: "0.75rem",
									fontFamily: "var(--font-mono)",
									color: "var(--text-secondary)",
									overflow: "auto",
									lineHeight: 1.6,
									margin: 0,
								}}
							>{`fetch("${API_URL}/v1/agent/actions/pay", {
  method: "POST",
  headers: {
    "Authorization": "Bearer lp_live_xxx",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    mint: "EPjFWdd5...TDt1v",
    amountAtomic: "1000000",
    destinationOwner: "7xKX...m4Qp",
    idempotencyKey: "pay-001"
  })
})`}</pre>
						</div>
					</div>
				</div>

				{/* Skill download grid */}
				<div
					className="animate-in animate-delay-3"
					style={{
						display: "grid",
						gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
						gap: 12,
					}}
				>
					{SKILL_FORMATS.map((format) => (
						<SkillCard
							key={format.id}
							icon={format.icon}
							title={format.title}
							description={format.description}
							filename={format.filename}
							best={format.best}
						/>
					))}
				</div>

				{/* SDK section */}
				<div
					className="card animate-in animate-delay-4"
					style={{ padding: 24, marginTop: 24 }}
				>
					<div className="label-mono" style={{ marginBottom: 12 }}>
						TypeScript SDK
					</div>
					<pre
						style={{
							background: "var(--bg-base)",
							border: "1px solid var(--border-subtle)",
							borderRadius: "var(--radius-md)",
							padding: "12px 16px",
							fontSize: "0.75rem",
							fontFamily: "var(--font-mono)",
							color: "var(--text-secondary)",
							overflow: "auto",
							lineHeight: 1.6,
							margin: 0,
						}}
					>{`import { createClient } from "@lobsterpay/sdk";

const lp = createClient("lp_live_YOUR_KEY", "${API_URL}");

const vault = await lp.getVault();
console.log(vault.permissions);

const result = await lp.executePay({
  mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  amountAtomic: "1000000",
  destinationOwner: "7xKXmJ...m4Qp",
  idempotencyKey: "pay-001",
});`}</pre>
				</div>
			</main>
		</div>
	);
}
