"use client";

import { AsciiStage } from "@/components/anim/ascii-stage";

/**
 * A payment enters at the top and splits into two streams: 98.5% to the
 * merchant destination and 1.5% to the lobsterpay treasury. Shows the
 * exact fee economics visually. Loops every 5s.
 */

export default function FeeFlow() {
	return (
		<div style={{ width: "100vw", height: "100vh", background: "var(--bg-deep, #0b0d11)" }}>
			<AsciiStage
				cols={120}
				rows={34}
				loopSeconds={5}
				onFrame={(grid, t) => {
					const { cols, rows } = grid;
					const midX = Math.floor(cols / 2);

					// Source box at top center
					const srcY = 2;
					const srcW = 22;
					const srcX = midX - Math.floor(srcW / 2);
					for (let i = 0; i < srcW; i++) {
						grid.set(srcX + i, srcY, "-");
						grid.set(srcX + i, srcY + 4, "-");
					}
					for (let j = 0; j < 5; j++) {
						grid.set(srcX, srcY + j, "|");
						grid.set(srcX + srcW - 1, srcY + j, "|");
					}
					grid.set(srcX, srcY, "+");
					grid.set(srcX + srcW - 1, srcY, "+");
					grid.set(srcX, srcY + 4, "+");
					grid.set(srcX + srcW - 1, srcY + 4, "+");
					grid.write(srcX + 2, srcY + 2, "  VAULT  100.00");

					// Split point
					const splitY = 10;
					for (let y = srcY + 5; y <= splitY; y++) grid.set(midX, y, "|");

					// Left branch (98.5%) -> destination
					const destY = rows - 7;
					const destX = 12;
					for (let x = destX + 10; x <= midX; x++) grid.set(x, splitY, "-");
					for (let y = splitY; y <= destY - 2; y++) grid.set(destX + 10, y, "|");
					grid.set(destX + 10, splitY, "+");
					grid.write(midX - 25, splitY - 1, "98.5% →");

					const destW = 22;
					for (let i = 0; i < destW; i++) {
						grid.set(destX + i, destY, "-");
						grid.set(destX + i, destY + 4, "-");
					}
					for (let j = 0; j < 5; j++) {
						grid.set(destX, destY + j, "|");
						grid.set(destX + destW - 1, destY + j, "|");
					}
					grid.set(destX, destY, "+");
					grid.set(destX + destW - 1, destY, "+");
					grid.set(destX, destY + 4, "+");
					grid.set(destX + destW - 1, destY + 4, "+");
					grid.write(destX + 2, destY + 2, "DEST   98.50");

					// Right branch (1.5%) -> treasury
					const treaX = cols - destX - destW;
					for (let x = midX + 1; x <= treaX + 10; x++) grid.set(x, splitY, "-");
					for (let y = splitY; y <= destY - 2; y++) grid.set(treaX + 10, y, "|");
					grid.set(treaX + 10, splitY, "+");
					grid.write(midX + 3, splitY - 1, "→ 1.5%");

					for (let i = 0; i < destW; i++) {
						grid.set(treaX + i, destY, "-");
						grid.set(treaX + i, destY + 4, "-");
					}
					for (let j = 0; j < 5; j++) {
						grid.set(treaX, destY + j, "|");
						grid.set(treaX + destW - 1, destY + j, "|");
					}
					grid.set(treaX, destY, "+");
					grid.set(treaX + destW - 1, destY, "+");
					grid.set(treaX, destY + 4, "+");
					grid.set(treaX + destW - 1, destY + 4, "+");
					grid.write(treaX + 2, destY + 2, "TREAS   1.50");

					// Flowing pulses
					// Main pipe: srcY+5 → splitY
					const mainPulses = 4;
					for (let i = 0; i < mainPulses; i++) {
						const phase = (t + i / mainPulses) % 1;
						const y = srcY + 5 + Math.floor(phase * (splitY - srcY - 5));
						grid.set(midX, y, "$");
					}
					// Left pipe pulses
					for (let i = 0; i < 4; i++) {
						const phase = (t + i / 4) % 1;
						const px = midX - Math.floor(phase * (midX - destX - 10));
						grid.set(px, splitY, "$");
					}
					for (let i = 0; i < 3; i++) {
						const phase = (t + i / 3) % 1;
						const py = splitY + Math.floor(phase * (destY - 2 - splitY));
						grid.set(destX + 10, py, "$");
					}
					// Right pipe pulses (smaller stream to show 1.5%)
					for (let i = 0; i < 2; i++) {
						const phase = (t + i / 2) % 1;
						const px = midX + Math.floor(phase * (treaX + 10 - midX));
						grid.set(px, splitY, "·");
					}
					for (let i = 0; i < 1; i++) {
						const phase = t % 1;
						const py = splitY + Math.floor(phase * (destY - 2 - splitY));
						grid.set(treaX + 10, py, "·");
					}

					const footer = "transparent 1.5% fee · 98.5% to merchant";
					grid.write(Math.floor((cols - footer.length) / 2), rows - 2, footer);
				}}
			/>
		</div>
	);
}
