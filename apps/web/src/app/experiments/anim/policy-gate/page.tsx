"use client";

import { AsciiStage } from "@/components/anim/ascii-stage";

/**
 * Requests flow in from the left. A policy gate in the middle either
 * passes them through (→ ✓) or bounces them back (✗). Each request is
 * a short labeled packet (e.g. `PAY 0.05`, `PAY 500`, `SWAP…`).
 */

interface Req {
	label: string;
	allowed: boolean;
}
const REQS: Req[] = [
	{ label: "PAY 0.05 USDC", allowed: true },
	{ label: "PAY 500 USDC", allowed: false },
	{ label: "SWAP 2 SOL", allowed: true },
	{ label: "PAY unknown", allowed: false },
	{ label: "PAY 0.25 USDC", allowed: true },
	{ label: "x402 call", allowed: true },
	{ label: "PAY 999 USDC", allowed: false },
	{ label: "SWAP 0.1 SOL", allowed: true },
];

export default function PolicyGate() {
	return (
		<div style={{ width: "100vw", height: "100vh", background: "var(--bg-deep, #0b0d11)" }}>
			<AsciiStage
				cols={120}
				rows={34}
				loopSeconds={10}
				onFrame={(grid, t) => {
					const { cols, rows } = grid;
					const cy = Math.floor(rows / 2);

					// Gate in the middle
					const gateX = Math.floor(cols / 2);
					for (let y = 4; y < rows - 4; y++) {
						grid.set(gateX, y, "|");
						grid.set(gateX + 1, y, "|");
					}
					grid.write(gateX - 4, 2, "[ POLICY ]");

					// Reject/accept indicators
					grid.write(gateX + 4, cy - 5, "→ allow");
					grid.write(gateX + 4, cy + 5, "✗ reject");

					// Requests stream rightward
					const n = REQS.length;
					for (let i = 0; i < n; i++) {
						const phase = (t + i / n) % 1;
						const rx = Math.floor(phase * (cols - 4));
						const req = REQS[i];
						// Y depends on whether it gets deflected after the gate
						let ry = cy;
						if (rx > gateX + 1) {
							if (req.allowed) {
								ry = cy - 3; // goes up toward allow
							} else {
								ry = cy + 3; // deflected down toward reject
							}
						}
						const prefix = req.allowed ? "→ " : "→ ";
						const text =
							rx > gateX + 1
								? req.allowed
									? "✓ " + req.label
									: "✗ " + req.label
								: prefix + req.label;
						// Only draw if the packet's start is on-canvas
						if (rx >= -req.label.length && rx < cols) {
							grid.write(rx - Math.floor(text.length / 2), ry, text);
						}
					}

					// Left label
					grid.write(2, 2, "[ agent requests ]");

					const footer = "lobsterpay · off-chain policy, on-chain settlement";
					grid.write(Math.floor((cols - footer.length) / 2), rows - 2, footer);
				}}
			/>
		</div>
	);
}
