"use client";

import { AsciiStage } from "@/components/anim/ascii-stage";

/**
 * Three agents on the left, one vault in the middle, one on-chain
 * destination on the right. Each agent fires requests at its own pace;
 * arrows flow through the vault and out. Loops every 8s.
 */

interface Agent {
	label: string;
	mint: string;
	period: number; // loop fraction between fires
	offset: number; // phase offset
}
const AGENTS: Agent[] = [
	{ label: "scraper-bot", mint: "USDC", period: 0.33, offset: 0.0 },
	{ label: "price-oracle", mint: "USDC", period: 0.25, offset: 0.12 },
	{ label: "tweet-bot", mint: "USDC", period: 0.5, offset: 0.45 },
];

export default function MultiAgent() {
	return (
		<div style={{ width: "100vw", height: "100vh", background: "var(--bg-deep, #0b0d11)" }}>
			<AsciiStage
				cols={120}
				rows={34}
				loopSeconds={8}
				onFrame={(grid, t) => {
					const { cols, rows } = grid;
					const cy = Math.floor(rows / 2);

					// Vault in middle
					const vaultX = Math.floor(cols / 2) - 10;
					const vaultW = 20,
						vaultH = 7;
					const vaultY = cy - Math.floor(vaultH / 2);
					for (let i = 0; i < vaultW; i++) {
						grid.set(vaultX + i, vaultY, "-");
						grid.set(vaultX + i, vaultY + vaultH - 1, "-");
					}
					for (let j = 0; j < vaultH; j++) {
						grid.set(vaultX, vaultY + j, "|");
						grid.set(vaultX + vaultW - 1, vaultY + j, "|");
					}
					grid.set(vaultX, vaultY, "+");
					grid.set(vaultX + vaultW - 1, vaultY, "+");
					grid.set(vaultX, vaultY + vaultH - 1, "+");
					grid.set(vaultX + vaultW - 1, vaultY + vaultH - 1, "+");
					grid.write(vaultX + Math.floor((vaultW - 5) / 2), vaultY + 2, "VAULT");
					grid.write(vaultX + Math.floor((vaultW - 12) / 2), vaultY + 4, "policy + cap");

					// Destination on far right
					const destX = cols - 18;
					grid.write(destX, cy - 2, "[ solana ]");
					grid.write(destX, cy - 0, "  devnet ");
					grid.write(destX, cy + 2, "onchain  ");

					// Agents on left + arrows
					const agentXEnd = 24;
					const rowSpacing = 6;
					const agentYStart = cy - Math.floor(((AGENTS.length - 1) / 2) * rowSpacing) - 2;
					for (let i = 0; i < AGENTS.length; i++) {
						const a = AGENTS[i];
						const ay = agentYStart + i * rowSpacing;
						grid.write(2, ay, `[ ${a.label.padEnd(14)}]`);
						grid.write(2, ay + 1, `  → ${a.mint}     `);

						// Arrow from agent to vault
						for (let x = agentXEnd; x < vaultX; x++) grid.set(x, ay, ".");
						// Pulse along arrow
						const phase = ((t + a.offset) % a.period) / a.period;
						const px = agentXEnd + Math.floor(phase * (vaultX - agentXEnd));
						if (px < vaultX) grid.set(px, ay, "*");
					}

					// Single arrow from vault to chain
					const outY = cy;
					for (let x = vaultX + vaultW; x < destX - 1; x++) grid.set(x, outY, "-");
					grid.set(destX - 2, outY, ">");
					// Pulse along output
					const outPhase = (t * 3) % 1;
					const outX = vaultX + vaultW + Math.floor(outPhase * (destX - vaultX - vaultW - 2));
					grid.set(outX, outY, "$");

					const footer = "one vault · many agents · one policy";
					grid.write(Math.floor((cols - footer.length) / 2), rows - 2, footer);
				}}
			/>
		</div>
	);
}
