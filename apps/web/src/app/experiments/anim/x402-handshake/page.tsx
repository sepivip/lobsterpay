"use client";

import { AsciiStage, type Grid } from "@/components/anim/ascii-stage";

/**
 * Three-panel x402 dance: GET → 402+SIGN → 200 OK. Loops every 6s.
 * The cursor moves left→right through the steps, emphasizing one at a time.
 */

function box(g: Grid, x: number, y: number, w: number, h: number, active: boolean) {
	const corner = active ? "*" : "+";
	const edge = active ? "=" : "-";
	g.set(x, y, corner);
	g.set(x + w - 1, y, corner);
	g.set(x, y + h - 1, corner);
	g.set(x + w - 1, y + h - 1, corner);
	for (let i = 1; i < w - 1; i++) {
		g.set(x + i, y, edge);
		g.set(x + i, y + h - 1, edge);
	}
	for (let j = 1; j < h - 1; j++) {
		g.set(x, y + j, "|");
		g.set(x + w - 1, y + j, "|");
	}
}

export default function X402Handshake() {
	return (
		<div style={{ width: "100vw", height: "100vh", background: "var(--bg-deep, #0b0d11)" }}>
			<AsciiStage
				cols={120}
				rows={34}
				loopSeconds={6}
				onFrame={(grid, t) => {
					const { cols, rows } = grid;
					const cy = Math.floor(rows / 2);
					const BW = 24,
						BH = 9;
					const gap = Math.floor((cols - BW * 3) / 4);
					const y0 = cy - Math.floor(BH / 2);

					const step = Math.floor(t * 3); // 0, 1, 2
					const labels = [
						{ title: "GET /resource", sub1: "agent calls api", sub2: "no credentials" },
						{ title: "402 + PAY", sub1: "lobsterpay signs", sub2: "usdc on solana" },
						{ title: "200 OK", sub1: "api responds", sub2: "content released" },
					];

					for (let i = 0; i < 3; i++) {
						const x = gap + i * (BW + gap);
						const active = i === step;
						box(grid, x, y0, BW, BH, active);
						const lab = labels[i];
						grid.write(x + Math.floor((BW - lab.title.length) / 2), y0 + 2, lab.title);
						grid.write(x + Math.floor((BW - lab.sub1.length) / 2), y0 + 4, lab.sub1);
						grid.write(x + Math.floor((BW - lab.sub2.length) / 2), y0 + 6, lab.sub2);

						// arrow to next step
						if (i < 2) {
							const ax = x + BW;
							const arrowEnd = ax + gap;
							for (let k = ax; k < arrowEnd; k++) grid.set(k, cy, i < step ? "=" : "-");
							grid.set(arrowEnd - 1, cy, ">");
						}
					}

					// footer
					const footer = "x402 · pay-per-call, no accounts";
					grid.write(Math.floor((cols - footer.length) / 2), rows - 3, footer);
				}}
			/>
		</div>
	);
}
