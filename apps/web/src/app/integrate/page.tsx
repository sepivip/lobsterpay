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
			toast.error("Download failed - is the API running?");
		}
	};

	const handleCopyUrl = () => {
		navigator.clipboard.writeText(
			`${API_URL}/v1/skills/download/${filename}`,
		);
		toast.success("URL copied");
	};

	return (
		<div className="card p-5 flex flex-col gap-3">
			<div className="flex items-center gap-3">
				<div className="skill-icon">{icon}</div>
				<div>
					<div className="text-lg text-primary" style={{ fontWeight: 500, letterSpacing: "-0.01em" }}>
						{title}
					</div>
					<div className="label-mono" style={{ marginTop: 2 }}>{best}</div>
				</div>
			</div>

			<p className="text-base text-tertiary flex-1" style={{ lineHeight: 1.5 }}>
				{description}
			</p>

			<div className="flex gap-2">
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
		<div className="page">
			<Nav />
			<main className="page-content">
				{/* Header */}
				<div className="animate-in mb-3">
					<h2 className="page-title">Agent Integration</h2>
					<span className="label-mono">
						Download skills for your AI agents
					</span>
				</div>

				<p className="animate-in animate-delay-1 text-md text-tertiary mb-6" style={{ lineHeight: 1.6, maxWidth: 640 }}>
					Give your agent a skill file and an API key. It will know how to
					check balances, make payments, swap tokens, and pay 402-gated
					endpoints - all within the limits you set in your vault policy.
				</p>

				{/* Quick start */}
				<div className="card p-5 animate-in animate-delay-2 mb-5">
					<div className="label-mono mb-3">Quick Start</div>
					<div className="flex gap-5 flex-wrap">
						<div style={{ flex: "1 1 300px" }}>
							<div className="text-base text-secondary mb-2">
								<strong className="text-primary">1.</strong>{" "}
								Create an API key in the{" "}
								<a href="/keys" className="text-accent" style={{ textDecoration: "none" }}>
									Keys tab
								</a>
							</div>
							<div className="text-base text-secondary mb-2">
								<strong className="text-primary">2.</strong>{" "}
								Download a skill file below
							</div>
							<div className="text-base text-secondary">
								<strong className="text-primary">3.</strong>{" "}
								Add the skill + key to your agent
							</div>
						</div>
						<div style={{ flex: "1 1 300px" }}>
							<div className="label-mono mb-2">Example (fetch)</div>
							<pre className="code-block">{`fetch("${API_URL}/v1/agent/actions/pay", {
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
				<div className="animate-in animate-delay-3 grid-cards">
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
				<div className="card p-5 animate-in animate-delay-4 mt-5">
					<div className="label-mono mb-3">TypeScript SDK</div>
					<pre className="code-block">{`import { createClient } from "@lobsterpay/sdk";

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
