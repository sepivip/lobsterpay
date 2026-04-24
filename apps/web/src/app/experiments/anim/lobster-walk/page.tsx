"use client";

import { AsciiStage, type Grid } from "@/components/anim/ascii-stage";

/**
 * Lobster walks left → right across a monochrome ASCII stage, leaving a
 * fading USDC trail. Loops every 8 seconds. Target 16:9 for Twitter cut.
 *
 * The lobster sprite has two leg frames that alternate every ~0.25s so
 * the walk cycle reads as motion, not a slide.
 */

// Sprite is 22 cols × 7 rows. Two leg frames for the walk cycle.
const LOBSTER_A = [
	"    _,===,_   ",
	"  /    ^    \\ ",
	"<=(  o   o  )=>",
	"  \\   __   / ",
	"   )_/  \\_(  ",
	"   /      \\  ",
	"  //      \\\\ ",
].map((r) => r.padEnd(22));

const LOBSTER_B = [
	"    _,===,_   ",
	"  /    ^    \\ ",
	"<=(  o   o  )=>",
	"  \\   __   / ",
	"   )_/  \\_(  ",
	"  (        )  ",
	"  /\\      /\\ ",
].map((r) => r.padEnd(22));

const SPRITE_W = 22;
const SPRITE_H = 7;

const TRAIL_TOKENS = ["$0.05", "$0.10", "$0.02", "$0.25"];

function drawSprite(grid: Grid, sprite: string[], x: number, y: number) {
	for (let row = 0; row < sprite.length; row++) {
		for (let col = 0; col < sprite[row].length; col++) {
			const ch = sprite[row][col];
			if (ch !== " ") grid.set(x + col, y + row, ch);
		}
	}
}

export default function LobsterWalk() {
	return (
		<div style={{ width: "100vw", height: "100vh", background: "var(--bg-deep, #0b0d11)" }}>
			<AsciiStage
				cols={120}
				rows={34}
				loopSeconds={8}
				onFrame={(grid, t) => {
					const { cols, rows } = grid;

					// Ground line (dashed)
					const groundY = Math.floor(rows * 0.72);
					for (let x = 0; x < cols; x++) {
						if (x % 3 !== 2) grid.set(x, groundY, "-");
					}

					// Lobster position — enters from the far left, exits at the far right.
					// Pad the travel range beyond the canvas so the loop wrap is off-screen.
					const travel = cols + SPRITE_W + 8;
					const lobsterX = Math.floor(-SPRITE_W - 4 + travel * t);
					const lobsterY = groundY - SPRITE_H;

					// Trail of tokens behind the lobster, fading left.
					// Space them every ~12 cols behind the body; only draw if within canvas.
					for (let i = 1; i <= 6; i++) {
						const trailX = lobsterX - i * 12;
						if (trailX < -6 || trailX > cols - 1) continue;
						// Fade effect: older trails get lighter chars + smaller text
						const token = TRAIL_TOKENS[i % TRAIL_TOKENS.length];
						const chars = i <= 2 ? token : i <= 4 ? token.replace("$", "·") : "·";
						grid.write(trailX, groundY - 1, chars);
					}

					// Lobster itself (alternating leg frames every ~quarter loop)
					const legFrame = Math.floor(t * 16) % 2 === 0 ? LOBSTER_A : LOBSTER_B;
					drawSprite(grid, legFrame, lobsterX, lobsterY);

					// Caption
					const caption = "lobsterpay · agent payments on solana";
					grid.write(Math.floor((cols - caption.length) / 2), rows - 3, caption);
				}}
			/>
		</div>
	);
}
