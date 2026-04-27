"use client";

import { AsciiStage } from "@/components/anim/ascii-stage";

/**
 * Terminal-style boot log scrolling upward, then a final ASCII
 * lobster-pay wordmark materializes at the bottom. Loops every 10s.
 */

const BOOT_LINES = [
	"[boot] loading config.env ...............ok",
	"[boot] connecting to solana devnet ......ok",
	"[boot] loading anchor idl ...............ok",
	"[boot] relayer keypair ..................ok",
	"[vault] fee_vault PDA check .............ok",
	"[policy] allowedActions bitmask .........0b111",
	"[policy] per-tx cap .....................5.00 USDC",
	"[policy] daily cap ......................100.00 USDC",
	"[api] binding 0.0.0.0:8080 ..............ok",
	"[api] x402 routes .......................3 live",
	"[api]   → /v1/agent/actions/x402",
	"[api]   → /v1/agent/actions/x402-facilitator",
	"[api]   → /v1/agent/actions/x402-siwx",
	"[ready] agents may now pay",
	"",
];

const WORDMARK = [
	"  __     ___  ____  ___  _____  ___  ____  ____   __  __   __",
	" (  )   /   \\(  _ \\/ __)(_   _)/ __)(  __)(  _ \\ (  \\/  ) (__)",
	"  )(__ ( () )) _ (\\__ \\  )(  \\__ \\ ) _)  )   /  )    (   )(",
	" (____) \\__/(____/(___/ (__) (___/(____)(_)\\_) (_/\\/\\_) (__)",
];

export default function BootSequence() {
	return (
		<div style={{ width: "100vw", height: "100vh", background: "var(--bg-deep, #0b0d11)" }}>
			<AsciiStage
				cols={120}
				rows={34}
				loopSeconds={10}
				onFrame={(grid, t) => {
					const { cols, rows } = grid;

					// Boot phase: 0..0.75; wordmark reveal: 0.75..1
					const bootT = Math.min(1, t / 0.75);
					const revealT = Math.max(0, (t - 0.75) / 0.25);

					// Boot lines scroll from bottom up as more complete
					const linesShown = Math.floor(bootT * BOOT_LINES.length);
					for (let i = 0; i < linesShown; i++) {
						// Newest at bottom of boot area
						const y = 2 + (linesShown - 1 - i);
						if (y >= 0 && y < rows - 8) {
							grid.write(3, y, BOOT_LINES[i]);
						}
					}

					// Wordmark reveals left-to-right
					const wmY = rows - WORDMARK.length - 2;
					const wmW = WORDMARK[0].length;
					const wmX = Math.floor((cols - wmW) / 2);
					const revealCol = Math.floor(revealT * wmW);
					for (let row = 0; row < WORDMARK.length; row++) {
						for (let c = 0; c < WORDMARK[row].length && c < revealCol; c++) {
							const ch = WORDMARK[row][c];
							if (ch !== " ") grid.set(wmX + c, wmY + row, ch);
						}
					}
				}}
			/>
		</div>
	);
}
