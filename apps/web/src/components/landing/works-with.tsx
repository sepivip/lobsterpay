import { Section } from "./section";

// Names only - avoiding third-party logo assets for licensing cleanliness.
// Order by agent popularity in the Solana/AI dev crowd.
const AGENTS = [
	"Claude Code",
	"Claude Desktop",
	"Cursor",
	"Windsurf",
	"Codex CLI",
	"Gemini CLI",
	"OpenAI GPT",
	"Any MCP client",
	"Any HTTP client",
];

export function WorksWith() {
	return (
		<Section
			eyebrow="WORKS WITH"
			title="Any agent that speaks HTTP"
			blurb="Four skill formats ship in the box: Skill JSON, Agent Prompt, OpenAPI 3.0, and MCP server config. Drop one into your agent and it picks up check_vault, make_payment, get_swap_quote, execute_swap, and pay_x402."
		>
			<div className="works-with-grid">
				{AGENTS.map((name) => (
					<div key={name} className="works-with-tile">
						{name}
					</div>
				))}
			</div>
		</Section>
	);
}
