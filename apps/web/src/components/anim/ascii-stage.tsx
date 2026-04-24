"use client";

import { useEffect, useRef } from "react";

/**
 * Bare-metal ASCII animation stage. Caller owns the render loop — just
 * writes into a fixed character grid (`Grid.set(x, y, ch)`) each frame
 * and we paint the buffer into a monospace <pre> via refs (skipping the
 * React reconciler; one DOM write per frame).
 *
 * Built for the shorts we'll record with Playwright → mp4 for X, so:
 *   - 16:9 aspect built in
 *   - loops cleanly (frame index wraps at `loopFrames`)
 *   - respects ?embed=1 query to strip the surrounding exp chrome
 */

export interface Grid {
	cols: number;
	rows: number;
	set: (x: number, y: number, ch: string) => void;
	write: (x: number, y: number, text: string) => void;
	clear: (ch?: string) => void;
	toString: () => string;
}

function makeGrid(cols: number, rows: number): Grid {
	const buf: string[] = new Array(cols * rows).fill(" ");
	return {
		cols,
		rows,
		set(x, y, ch) {
			if (x < 0 || y < 0 || x >= cols || y >= rows) return;
			buf[y * cols + x] = ch;
		},
		write(x, y, text) {
			for (let i = 0; i < text.length; i++) this.set(x + i, y, text[i]);
		},
		clear(ch = " ") {
			buf.fill(ch);
		},
		toString() {
			const rowsOut: string[] = [];
			for (let y = 0; y < rows; y++) {
				rowsOut.push(buf.slice(y * cols, (y + 1) * cols).join(""));
			}
			return rowsOut.join("\n");
		},
	};
}

interface Props {
	cols?: number;
	rows?: number;
	/** Wall-clock seconds per loop. Caller uses `t` (0..1) to drive animation. */
	loopSeconds?: number;
	/** Called every frame. Write into `grid`; `t` is 0..1 phase in the current loop. */
	onFrame: (grid: Grid, t: number, frame: number) => void;
}

export function AsciiStage({ cols = 120, rows = 34, loopSeconds = 8, onFrame }: Props) {
	const preRef = useRef<HTMLPreElement | null>(null);
	const gridRef = useRef<Grid | null>(null);
	const onFrameRef = useRef(onFrame);
	onFrameRef.current = onFrame;

	useEffect(() => {
		const grid = makeGrid(cols, rows);
		gridRef.current = grid;

		let raf = 0;
		let frame = 0;
		const start = performance.now();

		const tick = (now: number) => {
			const elapsed = (now - start) / 1000;
			const t = (elapsed % loopSeconds) / loopSeconds;
			grid.clear(" ");
			onFrameRef.current(grid, t, frame++);
			if (preRef.current) preRef.current.textContent = grid.toString();
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [cols, rows, loopSeconds]);

	return (
		<pre
			ref={preRef}
			className="anim-stage"
			style={{
				margin: 0,
				padding: 0,
				fontFamily: "var(--font-mono, ui-monospace, monospace)",
				fontSize: "clamp(8px, 1.1vw, 16px)",
				lineHeight: 1,
				letterSpacing: 0,
				color: "var(--text-primary, #fff)",
				background: "var(--bg-deep, #0b0d11)",
				whiteSpace: "pre",
				width: "100%",
				height: "100%",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				overflow: "hidden",
			}}
		/>
	);
}
