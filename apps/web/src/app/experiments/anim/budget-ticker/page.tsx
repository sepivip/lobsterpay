"use client";

import { AsciiStage } from "@/components/anim/ascii-stage";

/**
 * Big daily-budget counter ticking down as line items scroll past. Shows
 * the vault absorbing agent requests against a cap. Loops every 8s.
 */

const LINE_ITEMS = [
	{ agent: "scraper-bot", amount: 0.5, mint: "USDC" },
	{ agent: "price-oracle", amount: 0.25, mint: "USDC" },
	{ agent: "tweet-scheduler", amount: 1.0, mint: "USDC" },
	{ agent: "rpc-agent", amount: 0.05, mint: "USDC" },
	{ agent: "data-agent", amount: 2.0, mint: "USDC" },
	{ agent: "scraper-bot", amount: 0.5, mint: "USDC" },
	{ agent: "arb-bot", amount: 3.5, mint: "USDC" },
	{ agent: "newsletter", amount: 0.1, mint: "USDC" },
];

export default function BudgetTicker() {
	return (
		<div style={{ width: "100vw", height: "100vh", background: "var(--bg-deep, #0b0d11)" }}>
			<AsciiStage
				cols={120}
				rows={34}
				loopSeconds={8}
				onFrame={(grid, t) => {
					const { cols, rows } = grid;

					const CAP = 100.0;
					const totalSpent = LINE_ITEMS.reduce((s, it) => s + it.amount, 0);
					const spent = totalSpent * t;
					const remaining = Math.max(0, CAP - spent);

					// Big center number
					const big = `${remaining.toFixed(2)}`;
					const bigLine = `${big.padStart(8, " ")}  USDC  remaining`;
					grid.write(Math.floor((cols - bigLine.length) / 2), 6, bigLine);
					const bigSub = `daily cap 100.00 · resets 00:00 UTC`;
					grid.write(Math.floor((cols - bigSub.length) / 2), 8, bigSub);

					// Progress bar
					const barWidth = 60;
					const filled = Math.floor((spent / CAP) * barWidth);
					const barX = Math.floor((cols - barWidth) / 2);
					grid.write(barX - 2, 10, "[");
					grid.write(barX + barWidth, 10, "]");
					for (let i = 0; i < barWidth; i++) {
						grid.set(barX + i, 10, i < filled ? "#" : "·");
					}

					// Line items scrolling up from the bottom
					const firstVisibleY = 14;
					const lastVisibleY = rows - 4;
					const scrollRows = lastVisibleY - firstVisibleY;
					const n = LINE_ITEMS.length;
					for (let i = 0; i < n; i++) {
						const y = lastVisibleY - Math.floor((t * n + i) % n);
						const item = LINE_ITEMS[i];
						const line = `${new Date(Date.now() - i * 30000).toISOString().slice(11, 19)}  ${item.agent.padEnd(20)}  ${item.amount.toFixed(2)} ${item.mint}`;
						if (y >= firstVisibleY && y <= lastVisibleY) {
							grid.write(Math.floor((cols - line.length) / 2), y, line);
						}
					}

					// Top label
					const label = "[ vault budget · live ]";
					grid.write(Math.floor((cols - label.length) / 2), 2, label);

					const footer = "lobsterpay · caps agents cannot exceed, settled on-chain";
					grid.write(Math.floor((cols - footer.length) / 2), rows - 2, footer);
				}}
			/>
		</div>
	);
}
