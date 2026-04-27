"use client";

import { AsciiStage, type Grid } from "@/components/anim/ascii-stage";

/**
 * USDC streaming from a vault box on the left to a destination box on
 * the right, via a pipeline of `$` symbols flowing rightward. A counter
 * below shows the cumulative amount transferred, synchronized to the
 * pulses that cross the finish line.
 *
 * Monochrome, loops every 6 seconds. Target 16:9 for a Twitter cut.
 */

const BOX_W = 18;
const BOX_H = 7;
const STREAM_CHARS = ["$", "$", ".", "·", "$", ".", " ", "$"];
const PULSE_VALUE = 0.25; // USDC per pulse that reaches the destination

function drawBox(
	grid: Grid,
	x: number,
	y: number,
	w: number,
	h: number,
	label: string,
	sub: string,
) {
	// corners + edges
	grid.set(x, y, "+");
	grid.set(x + w - 1, y, "+");
	grid.set(x, y + h - 1, "+");
	grid.set(x + w - 1, y + h - 1, "+");
	for (let i = 1; i < w - 1; i++) {
		grid.set(x + i, y, "-");
		grid.set(x + i, y + h - 1, "-");
	}
	for (let j = 1; j < h - 1; j++) {
		grid.set(x, y + j, "|");
		grid.set(x + w - 1, y + j, "|");
	}
	// label centered
	const labelX = x + Math.floor((w - label.length) / 2);
	grid.write(labelX, y + 2, label);
	const subX = x + Math.floor((w - sub.length) / 2);
	grid.write(subX, y + 4, sub);
}

export default function UsdcStream() {
	return (
		<div style={{ width: "100vw", height: "100vh", background: "var(--bg-deep, #0b0d11)" }}>
			<AsciiStage
				cols={120}
				rows={34}
				loopSeconds={6}
				onFrame={(grid, t) => {
					const { cols, rows } = grid;

					const centerY = Math.floor(rows / 2);
					const leftX = 8;
					const rightX = cols - BOX_W - 8;
					const boxTopY = centerY - Math.floor(BOX_H / 2);

					drawBox(grid, leftX, boxTopY, BOX_W, BOX_H, "VAULT", "policy-gated");
					drawBox(grid, rightX, boxTopY, BOX_W, BOX_H, "API", "paid endpoint");

					// Pipeline between the boxes, on the middle row of the boxes.
					const pipeY = centerY;
					const pipeStart = leftX + BOX_W;
					const pipeEnd = rightX;
					const pipeLen = pipeEnd - pipeStart;
					// Base pipe glyphs
					for (let x = pipeStart; x < pipeEnd; x++) grid.set(x, pipeY, "-");
					// Arrow head approaching destination
					grid.set(pipeEnd - 1, pipeY, ">");

					// Flowing $ pulses. 8 pulses evenly spaced along the pipe, each
					// marching right at 1 * pipeLen per loop. The phase of each pulse
					// is offset so they form a continuous stream.
					const pulses = 8;
					for (let i = 0; i < pulses; i++) {
						const phase = (t + i / pulses) % 1;
						const px = pipeStart + Math.floor(phase * pipeLen);
						const ch = STREAM_CHARS[i % STREAM_CHARS.length];
						if (ch !== " " && px > pipeStart && px < pipeEnd - 1) {
							grid.set(px, pipeY, ch);
						}
					}

					// Counter below the pipeline. Total increments by PULSE_VALUE each
					// time a pulse (that started at phase 0) reaches the destination.
					// At time t in a loop, `pulses` pulses have completed one trip; use
					// a running total tied to loop count + within-loop progress.
					// For the loop itself, just show the amount delivered SO FAR in
					// this loop, rising from 0 → pulses * PULSE_VALUE.
					const delivered = Math.floor(t * pulses) * PULSE_VALUE;
					const countLine = `transferred · ${delivered.toFixed(2)} USDC`;
					grid.write(Math.floor((cols - countLine.length) / 2), centerY + 5, countLine);

					// Caption
					const caption = "lobsterpay · vault → destination, in every x402 dance";
					grid.write(Math.floor((cols - caption.length) / 2), rows - 3, caption);
				}}
			/>
		</div>
	);
}
