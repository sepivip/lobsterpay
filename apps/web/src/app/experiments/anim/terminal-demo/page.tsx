"use client";

import { AsciiStage } from "@/components/anim/ascii-stage";

/**
 * Fake terminal: types a curl command, waits, response streams in,
 * shows tx hash. The definitive "try it now" clip. Loops every 10s.
 */

const COMMAND = "$ curl -X POST https://api.lobsterpay.xyz/v1/agent/actions/pay \\";
const COMMAND_LINES = [
	"$ curl -X POST https://api.lobsterpay.xyz/v1/agent/actions/pay \\",
	"   -H 'authorization: Bearer lp_sk_...' \\",
	'   -d \'{ "destination": "<pubkey>", "amount": "250000" }\'',
];

const RESPONSE_LINES = [
	"{",
	'  "requestId": "3e2eef24-8646-446f-ae65-bc4fe34e1b10",',
	'  "status":    "confirmed",',
	'  "txSignature": "2vanrbeyh76VDkrvHJneE5J1K3CiQosxJ...",',
	'  "amountAtomic": "250000",',
	'  "serviceFee": "3750"',
	"}",
];

function typedPrefix(full: string, chars: number): string {
	return chars >= full.length ? full : full.slice(0, chars);
}

export default function TerminalDemo() {
	return (
		<div style={{ width: "100vw", height: "100vh", background: "var(--bg-deep, #0b0d11)" }}>
			<AsciiStage
				cols={120}
				rows={34}
				loopSeconds={10}
				onFrame={(grid, t, frame) => {
					const { cols, rows } = grid;

					// Terminal frame
					const tx = 6,
						ty = 2,
						tw = cols - 12,
						th = rows - 4;
					for (let i = 0; i < tw; i++) {
						grid.set(tx + i, ty, "-");
						grid.set(tx + i, ty + th - 1, "-");
					}
					for (let j = 0; j < th; j++) {
						grid.set(tx, ty + j, "|");
						grid.set(tx + tw - 1, ty + j, "|");
					}
					grid.set(tx, ty, "+");
					grid.set(tx + tw - 1, ty, "+");
					grid.set(tx, ty + th - 1, "+");
					grid.set(tx + tw - 1, ty + th - 1, "+");
					grid.write(tx + 2, ty, " agent-shell ~ ");

					// Phase
					// 0.0 - 0.4: type command
					// 0.4 - 0.55: wait (spinner)
					// 0.55 - 0.9: response streams in
					// 0.9 - 1.0: idle with prompt

					const contentX = tx + 2;
					let contentY = ty + 2;

					const cmdFull = COMMAND_LINES.join("\n");
					const cmdTotalChars = cmdFull.length;
					const cmdT = Math.min(1, t / 0.4);
					const cmdChars = Math.floor(cmdT * cmdTotalChars);
					const typedCmd = typedPrefix(cmdFull, cmdChars);
					const lines = typedCmd.split("\n");
					for (const line of lines) {
						grid.write(contentX, contentY, line);
						contentY++;
					}

					// Spinner + response
					if (t > 0.4) {
						contentY++;
						if (t < 0.55) {
							const spin = "|/-\\";
							const ch = spin[Math.floor((frame / 3) % spin.length)];
							grid.write(contentX, contentY, `  ${ch} waiting for chain...`);
						} else {
							grid.write(contentX, contentY, "  → confirmed on devnet");
							contentY += 2;
							const respT = Math.min(1, (t - 0.55) / 0.35);
							const respFull = RESPONSE_LINES.join("\n");
							const respChars = Math.floor(respT * respFull.length);
							const typedResp = typedPrefix(respFull, respChars);
							const respOutLines = typedResp.split("\n");
							for (const line of respOutLines) {
								grid.write(contentX, contentY, line);
								contentY++;
							}
						}
					}

					// Blinking cursor at end of whatever we've typed
					if (Math.floor(frame / 15) % 2 === 0) {
						const lastLine = lines[lines.length - 1] ?? "";
						if (t < 0.4) {
							grid.set(contentX + lastLine.length, ty + 2 + lines.length - 1, "_");
						}
					}
				}}
			/>
		</div>
	);
}
