"use client";

import { AsciiStage, type Grid } from "@/components/anim/ascii-stage";

/**
 * Rejected request dramatized: a large PAY request approaches, hits
 * the policy, bounces back as a big [ DENIED ] stamp with a reason.
 * Cycles through a few different reasons. Loops every 8s.
 */

const SCENARIOS = [
	{ req: "PAY 500 USDC", reason: "EXCEEDS DAILY CAP (100)" },
	{ req: "PAY unknown", reason: "DESTINATION NOT IN ALLOWLIST" },
	{ req: "PAY 999 USDC", reason: "EXCEEDS PER-TX CAP (5)" },
	{ req: "SWAP →", reason: "VAULT PAUSED BY OWNER" },
];

function drawBigX(grid: Grid, cx: number, cy: number, size: number) {
	for (let i = -size; i <= size; i++) {
		grid.set(cx + i, cy + i, "X");
		grid.set(cx + i, cy - i, "X");
	}
}

export default function Rejected() {
	return (
		<div style={{ width: "100vw", height: "100vh", background: "var(--bg-deep, #0b0d11)" }}>
			<AsciiStage
				cols={120}
				rows={34}
				loopSeconds={8}
				onFrame={(grid, t) => {
					const { cols, rows } = grid;
					const cy = Math.floor(rows / 2);

					// Pick scenario by loop quadrant
					const scenarioIdx = Math.floor(t * SCENARIOS.length) % SCENARIOS.length;
					const sub_t = (t * SCENARIOS.length) % 1;
					const s = SCENARIOS[scenarioIdx];

					// Request approaches from the left for the first 0.5 of sub_t
					const travelT = Math.min(1, sub_t / 0.4);
					const reqX = Math.floor(-20 + travelT * (cols / 2 - 10));
					const reqText = `→ ${s.req}`;
					if (sub_t < 0.5) {
						grid.write(reqX, cy, reqText);
					}

					// Big X flashes at sub_t > 0.4
					if (sub_t >= 0.4) {
						drawBigX(grid, Math.floor(cols / 2), cy, 4);
					}

					// DENIED banner after 0.5
					if (sub_t >= 0.5) {
						const banner = "[ DENIED ]";
						grid.write(Math.floor((cols - banner.length) / 2), cy + 6, banner);
						const reasonText = `reason · ${s.reason}`;
						grid.write(Math.floor((cols - reasonText.length) / 2), cy + 8, reasonText);
					}

					// Top label
					grid.write(4, 2, "[ policy enforcement ]");

					const footer = "vaults say no · even when agents say yes";
					grid.write(Math.floor((cols - footer.length) / 2), rows - 2, footer);
				}}
			/>
		</div>
	);
}
