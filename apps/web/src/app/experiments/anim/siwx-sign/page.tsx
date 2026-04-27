"use client";

import { AsciiStage } from "@/components/anim/ascii-stage";

/**
 * SIWX (Sign-In-with-X) auth flow visualization. Shows a challenge
 * arriving, a signature materializing byte-by-byte, and a SIGNED stamp.
 * Loops every 6s.
 */

const CHALLENGE = [
	"domain   · api.example.com",
	"nonce    · 7f3a2b...",
	"issuedAt · 2026-04-24T12:45Z",
	"expires  · +300s",
	"chainId  · solana:devnet",
];

const HEX = "0123456789abcdef";
function fakeSig(len: number, seed = 42): string {
	let s = "";
	let state = seed;
	for (let i = 0; i < len; i++) {
		state = (state * 1103515245 + 12345) & 0x7fffffff;
		s += HEX[state % 16];
	}
	return s;
}

export default function SiwxSign() {
	return (
		<div style={{ width: "100vw", height: "100vh", background: "var(--bg-deep, #0b0d11)" }}>
			<AsciiStage
				cols={120}
				rows={34}
				loopSeconds={6}
				onFrame={(grid, t) => {
					const { cols, rows } = grid;
					const cy = Math.floor(rows / 2);

					// Left panel: CHALLENGE
					grid.write(4, 2, "[ CHALLENGE ]");
					for (let i = 0; i < CHALLENGE.length; i++) {
						grid.write(4, 5 + i, CHALLENGE[i]);
					}

					// Right panel: SIGNATURE (fills in left→right as t progresses)
					const sigX = cols - 56;
					grid.write(sigX, 2, "[ SIGNATURE · ed25519 ]");
					const fullSig = fakeSig(128);
					const chars = Math.floor(t * fullSig.length);
					// Wrap into 4 rows of 32
					for (let i = 0; i < chars; i++) {
						const row = Math.floor(i / 32);
						const col = i % 32;
						grid.set(sigX + col, 5 + row, fullSig[i]);
					}

					// Middle arrow: challenge → signature
					const arrowY = cy;
					const arrowStart = 36;
					const arrowEnd = sigX - 2;
					for (let x = arrowStart; x < arrowEnd; x++) grid.set(x, arrowY, "-");
					grid.set(arrowEnd - 1, arrowY, ">");
					// Pulse
					const pulseX = arrowStart + Math.floor(t * (arrowEnd - arrowStart - 1));
					grid.set(pulseX, arrowY, "*");
					grid.write(arrowStart + 2, arrowY - 2, "lobsterpay");
					grid.write(arrowStart + 4, arrowY + 2, "relayer signs");

					// SIGNED stamp once t > 0.95
					if (t > 0.95) {
						const stamp = "[ AUTHORIZED ]";
						grid.write(Math.floor((cols - stamp.length) / 2), cy + 8, stamp);
					}

					const footer = "wallet auth for agents · no private keys";
					grid.write(Math.floor((cols - footer.length) / 2), rows - 2, footer);
				}}
			/>
		</div>
	);
}
