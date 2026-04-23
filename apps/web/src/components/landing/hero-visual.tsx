"use client";

import { useEffect, useRef } from "react";

/**
 * The animated lobster centerpiece on the right side of the landing
 * hero. The site's logo silhouette is rasterized to a 2D mask, then
 * rotated on the Y-axis each frame; depth drives char density (front
 * = dense `@` / `#`, back = sparse `.` / ` `). Pure ASCII on a
 * canvas. No assets beyond /logo.svg.
 *
 * Pipeline:
 *  1. On mount, draw /logo.svg into an offscreen canvas at mask
 *     resolution and read alpha → boolean occupancy grid.
 *  2. Each frame, walk the lit mask cells, rotate (u, v, 0) around Y,
 *     project to the output ASCII grid, write the depth-mapped char
 *     into a Z-buffer so the front of the slab paints over the back.
 *
 * Honors prefers-reduced-motion by painting an initial static frame
 * and skipping the RAF loop; pointer hover still triggers a coalesced
 * one-off repaint so the @ -> $ swap remains interactive even when
 * animation is paused. Cancels the RAF loop when off-screen via
 * IntersectionObserver and re-arms when scrolled back into view, so a
 * hidden hero is not burning ~60fps + GC churn.
 */

/**
 * Ghostty-style text-symbol ramp. Order is light → dense; we use the
 * dense end (~80% along) for the solid silhouette and the lighter end
 * for the optional edge halo. No block-drawing chars - this is
 * monospace-typewriter ASCII art, not pixel art.
 */
const RAMP = " .'\",:;~+=*oxX&%$@";
const FILL_CHAR_INDEX = RAMP.length - 1; // dense `@` for the lobster body
const HOVER_FILL_CHAR = "$"; // swapped in for `@` within HOVER_RADIUS_CELLS of cursor
const HOVER_RADIUS_CELLS = 8; // radius in output cells (≈ 72px at cellPx=9)

// Shimmer-45 pacing. Spin is continuous (velocity eased so the silhouette
// lingers longer at the wide views and accelerates through the edge-on
// flip - never actually stops). Shimmer bar sweeps concurrently on its
// own wall-clock schedule so the two effects never fully align.
const SS45_SHIMMER_PERIOD = 5.5; // seconds for one full sweep cycle
const SS45_SHIMMER_DUTY = 0.75; // fraction of period the bar is on-canvas

/**
 * Pool of "halo" chars sprinkled into cells just outside the lobster
 * silhouette to give the shape a soft, drawn-by-hand edge. Picked once
 * per cell at mask-load time so they stay stable while the lobster
 * spins (no per-frame flicker).
 */
const HALO_CHARS = "+*=~.";

/**
 * Animation modes - each one re-uses the same mask-rasterize pipeline
 * but warps the (u, v) → (ox, oy) projection differently per frame, or
 * (for the static modes) leaves the silhouette in place and animates
 * per-cell character / brightness instead.
 *
 *   spin             - Y-axis rotation. Silhouette compresses on X as
 *                      it turns. Z-buffered so front cells occlude back.
 *   spin-shimmer-45  - Continuous Y-axis spin (velocity-eased: slower
 *                      through the edge-on flip, faster through wide
 *                      views) with a 45° diagonal bright bar sweeping
 *                      across on its own wall-clock timer. Production
 *                      experiment grid winner V1.
 *   spin-glitch      - Y-axis spin plus periodic char-scramble pulses.
 *   tumble           - Independent X and Y axis scaling driven by two
 *                      out-of-phase cosines (sx = cos(a),
 *                      sy = cos(a * 0.7)). Approximates a pitch + yaw
 *                      look without true 3D rotation - there is no
 *                      z-buffer, no perspective, no surface normals.
 *                      Kept as a cheap comparison mode; for a
 *                      true-3D-feeling spin, see `spin` or `lit-3d`.
 *   pulse            - No rotation. Scale breathes between ~0.85 and
 *                      ~1.05.
 *   glitch           - Mostly static; periodically corrupts ~4% of body
 *                      cells with random ramp chars for ~250ms.
 *   wave             - No rotation. Each row is sine-displaced
 *                      horizontally for an underwater-current feel.
 *   shimmer          - No rotation. A vertical bar of brighter chars
 *                      sweeps left→right; cells outside the bar stay
 *                      at base brightness.
 *   galaxy           - Static silhouette; each cell cycles through the
 *                      ramp on its own phase = animTime + angular
 *                      position from center + radial twist. Reads as
 *                      density bands flowing outward and rotating
 *                      around the lobster. Production hero default.
 *   lit-3d           - Y-axis spin like `spin`, but every visible cell
 *                      picks its char from the FULL ramp by depth:
 *                      front = dense `@`, back = sparse `.`. donut.c-
 *                      style luminance-via-density.
 */
export type HeroVisualMode =
	| "spin"
	| "spin-shimmer-45"
	| "spin-glitch"
	| "tumble"
	| "pulse"
	| "glitch"
	| "wave"
	| "shimmer"
	| "galaxy"
	| "lit-3d";

interface Props {
	/** Canvas opacity. Hero centerpiece wants this high (0.7–1.0). */
	opacity?: number;
	/** Output cell size in px. Smaller = finer detail, more CPU. */
	cellPx?: number;
	/** Animation rate, in radians per second for the angle-driven modes
	 *  (spin, spin-shimmer-45, spin-glitch, tumble, pulse, wave, shimmer,
	 *  lit-3d - the accumulated angle is fed directly into Math.sin /
	 *  Math.cos), and as a unit-less multiplier on the per-cell phase
	 *  cycle for `galaxy` (which uses animation-time, not raw angle).
	 *  `glitch` uses angle only to drive its scramble trigger; the visual
	 *  is otherwise static. */
	rotationSpeed?: number;
	/** SVG to rasterize. Defaults to the site's /logo.svg. */
	src?: string;
	/** When false, animate even if the user has reduced-motion enabled. */
	respectReducedMotion?: boolean;
	/** Animation style - see HeroVisualMode docstring. Default: spin. */
	mode?: HeroVisualMode;
}

export function HeroVisual({
	opacity = 0.85,
	cellPx = 9,
	rotationSpeed = 0.45,
	src = "/logo.svg",
	respectReducedMotion = true,
	mode = "spin",
}: Props) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		const reduced =
			respectReducedMotion && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

		// Pull the design-system mono font from the CSS custom property
		// instead of hardcoding a ui-monospace fallback chain. Keeps the
		// ASCII hero in the same GeistMono voice as buttons, mono labels,
		// and tx signatures across the rest of the site.
		//
		// IMPORTANT: read `--font-geist-mono` directly (the next/font
		// runtime variable that resolves to the actual `__variable_xxxxx`
		// font-family string) rather than `--font-mono`. The latter is
		// defined as `var(--font-geist-mono), ui-monospace, ...` and
		// getComputedStyle().getPropertyValue() does NOT resolve nested
		// var() references; it returns the literal text. Canvas ctx.font
		// cannot parse `var()`, so it would silently fall back to the
		// default sans font and break the monospace alignment of the
		// ASCII grid. Reading the leaf variable + appending our fallbacks
		// here gives ctx.font a value it can actually parse. Computed
		// once at effect setup; ctx.font assignment per frame just
		// composes it with cellPx.
		const geistMono = getComputedStyle(document.documentElement)
			.getPropertyValue("--font-geist-mono")
			.trim();
		const monoFallbacks = "ui-monospace, SFMono-Regular, Menlo, monospace";
		const monoFamily = geistMono ? `${geistMono}, ${monoFallbacks}` : monoFallbacks;
		const ctxFontString = `${cellPx}px ${monoFamily}`;

		let mask: Uint8Array | null = null;
		let maskW = 0;
		let maskH = 0;
		// Per-mask-cell halo index, picked once at load. -1 = no halo; any
		// non-negative value is an index into HALO_CHARS. Storing numbers
		// instead of the chars themselves lets the per-frame halo pass skip
		// HALO_CHARS.indexOf() when seeding haloIdxGrid.
		let haloIdxMask: Int8Array = new Int8Array(0);
		let raf = 0;
		let visible = true;
		let angle = 0;
		// Cumulative ANIMATION-frame seconds since mount, independent of
		// rotationSpeed. Pauses when the RAF loop pauses (off-screen via
		// IntersectionObserver, or reduced-motion honored), so it is not
		// strictly wall-clock - "animation time" is the right mental
		// model. Used for effects (the diagonal shimmer sweep, the
		// galaxy per-cell phase) that should pace the same regardless
		// of how fast the lobster is spinning.
		let animTime = 0;
		let lastT = 0;
		let outCols = 0;
		let outRows = 0;
		/**
		 * Per-output-cell occupancy:
		 *   0 = empty
		 *   1 = halo (rendered with a HALO_CHARS char)
		 *   2 = body (rendered with the dense fill char)
		 * Body always overwrites halo, so the silhouette stays crisp.
		 */
		let occupancy = new Uint8Array(0);
		let haloIdxGrid = new Uint8Array(0);
		// Z-buffer (per output cell) - for the spinning modes we treat the
		// mask as a thin slab being rotated around Y, then draw only the
		// FRONT-most cell at each output pixel and shade by depth. Without
		// this the silhouette reads as a flat 2D scale instead of a 3D spin.
		// Higher zBuffer value = closer to camera. Initialized to -Infinity
		// each frame.
		let zBuffer = new Float32Array(0);
		// Per-row x-offset cache for wave mode. Allocated once at mask load
		// (size = maskH) instead of per-frame to avoid GC churn.
		let rowOffsets = new Float32Array(0);
		// Cached canvas CSS pixel size, updated in resize() so paint() does
		// not need getBoundingClientRect() per frame (forces layout).
		let cssWidth = 0;
		let cssHeight = 0;
		// Pointer -> cell conversion uses PointerEvent.offsetX/Y directly
		// (relative to the target element's padding edge, which equals the
		// CSS pixel position inside the canvas since the canvas has no
		// padding). No rect caching needed; no window scroll listener.
		// Matters on /experiments/hero-anim where 10 HeroVisual instances
		// used to each register their own scroll listener + rect-query.
		// Cursor position in output-cell coordinates. -1 means not hovering.
		let hoverCol = -1;
		let hoverRow = -1;
		// Set true on cleanup so any in-flight loadMask().then() bails out
		// before scheduling RAF on an unmounted canvas.
		let cancelled = false;
		// RAF id for one-off repaints triggered by hover events when the
		// main animation loop is stopped (off-screen, or reduced-motion).
		// 0 = none scheduled. Coalesced via flag so a burst of pointermove
		// events within one frame triggers exactly one repaint.
		let pendingHoverPaint = 0;

		async function loadMask() {
			const img = new Image();
			// crossOrigin must be set BEFORE src so the request is made with
			// CORS headers; setting it after src is a no-op in some browsers
			// and would taint the canvas (breaking getImageData below).
			img.crossOrigin = "anonymous";
			img.src = src;
			await new Promise<void>((resolve, reject) => {
				img.onload = () => resolve();
				img.onerror = () => reject(new Error(`Failed to load ${src}`));
			});
			// ~120 cells tall - fine enough for the lobster's claws and legs to
			// read at hero size, coarse enough to render in <2ms per frame.
			const targetH = 120;
			const aspect = img.width / img.height;
			const w = Math.round(targetH * aspect);
			const h = targetH;
			const off = document.createElement("canvas");
			off.width = w;
			off.height = h;
			const octx = off.getContext("2d");
			if (!octx) {
				// Throw so the loadMask().catch() in the effect surfaces
				// a console warning. Returning silently would leave mask
				// unset and the user staring at an unexplained blank
				// canvas with no diagnostic clue.
				throw new Error("Failed to acquire 2D context for hero mask offscreen canvas");
			}
			octx.drawImage(img, 0, 0, w, h);
			const data = octx.getImageData(0, 0, w, h).data;
			const out = new Uint8Array(w * h);
			for (let i = 0; i < out.length; i++) {
				out[i] = data[i * 4 + 3] > 128 ? 1 : 0;
			}
			mask = out;
			maskW = w;
			maskH = h;
			// Allocate the per-row offset cache here (size known after load)
			// so paint() can refill instead of re-allocate every frame.
			rowOffsets = new Float32Array(h);
			// Pre-pick a halo INDEX (into HALO_CHARS) for each EMPTY mask
			// cell that touches the silhouette edge. Sparse (~20% of edge
			// cells) so the halo reads as a soft scatter, not a thick
			// outline. -1 means "no halo here"; non-negative is the char
			// index. Storing numbers (not the chars themselves) removes a
			// per-frame HALO_CHARS.indexOf() from the halo projection loop.
			haloIdxMask = new Int8Array(w * h);
			haloIdxMask.fill(-1);
			for (let v = 1; v < h - 1; v++) {
				for (let u = 1; u < w - 1; u++) {
					if (out[v * w + u]) continue; // skip body cells
					// Edge cell = empty cell adjacent to a body cell
					const isEdge =
						out[(v - 1) * w + u] ||
						out[(v + 1) * w + u] ||
						out[v * w + u - 1] ||
						out[v * w + u + 1];
					if (!isEdge) continue;
					if (Math.random() > 0.2) continue;
					haloIdxMask[v * w + u] = Math.floor(Math.random() * HALO_CHARS.length);
				}
			}
		}

		function resize() {
			if (!canvas) return;
			const dpr = window.devicePixelRatio || 1;
			const rect = canvas.getBoundingClientRect();
			cssWidth = rect.width;
			cssHeight = rect.height;
			canvas.width = Math.floor(rect.width * dpr);
			canvas.height = Math.floor(rect.height * dpr);
			ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
			outCols = Math.ceil(rect.width / cellPx);
			outRows = Math.ceil(rect.height / cellPx);
			occupancy = new Uint8Array(outCols * outRows);
			haloIdxGrid = new Uint8Array(outCols * outRows);
			zBuffer = new Float32Array(outCols * outRows);
			// Changing canvas.width / canvas.height clears the canvas. If
			// the RAF loop is currently idle (reduced-motion honored, or
			// scrolled off-screen), the canvas would stay blank until the
			// loop next runs or the user moves the pointer. Schedule a
			// one-off repaint via the same coalesced helper used by hover.
			schedulePaintIfIdle();
		}

		/**
		 * Compute per-mode (sx, sy, dx, dy, dy-row-offset-fn, glitch?) so the
		 * single projection loop below stays branch-free for the hot path.
		 */
		function projectFor(a: number) {
			switch (mode) {
				case "tumble": {
					// Y rotation drives x compression; X rotation tilts y.
					const cos = Math.cos(a);
					const cosX = Math.cos(a * 0.7); // slightly different period
					return { sx: cos, sy: cosX, rowSineAmp: 0, rowSineFreq: 0 };
				}
				case "pulse": {
					// Scale 0.85 → 1.05 via cos(a) - slow breathing.
					const s = 0.95 + Math.cos(a) * 0.1;
					return { sx: s, sy: s, rowSineAmp: 0, rowSineFreq: 0 };
				}
				case "wave": {
					// No scaling; per-row horizontal sine displacement.
					return {
						sx: 1,
						sy: 1,
						rowSineAmp: 0.04, // 4% of mask width
						rowSineFreq: 0.2, // wave length in mask cells
						rowSinePhase: a,
					};
				}
				case "galaxy": {
					// Static silhouette - animation comes from per-cell char
					// cycling, not geometric warp.
					return { sx: 1, sy: 1, rowSineAmp: 0, rowSineFreq: 0 };
				}
				default: {
					// Catches: spin, spin-shimmer-45, spin-glitch, lit-3d
					// (all Y-rotating) plus shimmer, glitch (no rotation;
					// the animation lives in the per-cell render below).
					const spinning =
						mode === "spin" ||
						mode === "spin-shimmer-45" ||
						mode === "spin-glitch" ||
						mode === "lit-3d";
					const cos = spinning ? Math.cos(a) : 1;
					return { sx: cos, sy: 1, rowSineAmp: 0, rowSineFreq: 0 };
				}
			}
		}

		function paint(a: number, t: number) {
			if (!canvas || !ctx || !mask) return;
			ctx.clearRect(0, 0, cssWidth, cssHeight);

			const proj = projectFor(a) as {
				sx: number;
				sy: number;
				rowSineAmp: number;
				rowSineFreq: number;
				rowSinePhase?: number;
			};
			const fit = Math.min((outCols * 0.9) / maskW, (outRows * 0.9) / maskH);
			const cx = outCols / 2;
			const cy = outRows / 2;

			// Per-row x-offset for wave mode (precomputed so we don't sin()
			// per pixel). Cache lives at the effect-closure level and is
			// sized exactly once in loadMask(); we refill / zero here.
			if (proj.rowSineAmp > 0) {
				for (let v = 0; v < maskH; v++) {
					rowOffsets[v] =
						Math.sin(v * proj.rowSineFreq + (proj.rowSinePhase ?? 0)) * proj.rowSineAmp * maskW;
				}
			} else if (rowOffsets.length > 0) {
				// Always clear when not in wave mode. Checking just rowOffsets[0]
				// is unsafe - row 0 can legitimately be 0 in wave mode (when
				// rowSinePhase is a multiple of π) while later rows still hold
				// stale non-zero offsets that would warp the projection. fill(0)
				// is ~120 floats; cost is negligible vs. the bug it prevents.
				rowOffsets.fill(0);
			}

			occupancy.fill(0);
			haloIdxGrid.fill(0);
			// Reset z-buffer to "infinitely far back" so any cell wins on
			// first write. Only spinning modes consult it.
			const isSpinning =
				mode === "spin" ||
				mode === "spin-shimmer-45" ||
				mode === "spin-glitch" ||
				mode === "lit-3d";
			if (isSpinning) {
				zBuffer.fill(Number.NEGATIVE_INFINITY);
			}
			// True 3D Y-rotation: rx = du·cos(a), rz = du·sin(a). The earlier
			// implementation used only `du * cos(a)` (X-scale) and discarded
			// depth, which read as a flat 2D squash. With rz we get:
			//   - perspective foreshortening (closer half projects wider, far
			//     half projects narrower)
			//   - z-buffer self-occlusion (front cells hide back cells at the
			//     same projected pixel - naturally cuts the silhouette in half
			//     during the spin instead of double-painting through)
			//   - depth-shaded alpha at render time (front bright, back dim)
			const cosA = Math.cos(a);
			const sinA = Math.sin(a);
			// Perspective strength. ~0.0035 per mask-unit gives a noticeable
			// "barrel" feel at hero size without warping the silhouette
			// grotesquely. Tune up for more drama, down for flatter.
			const perspK = 0.0045;

			// Halo pass - flat projection (no depth), runs first so body can
			// paint over. Reads halo index directly from haloIdxMask; the
			// char string lookup is deferred to render time.
			for (let v = 0; v < maskH; v++) {
				const rowOff = rowOffsets[v] ?? 0;
				for (let u = 0; u < maskW; u++) {
					const haloIdx = haloIdxMask[v * maskW + u];
					if (haloIdx < 0) continue;
					const du = u - maskW / 2;
					const dv = v - maskH / 2;
					const ox = Math.round(cx + (du * proj.sx + rowOff) * fit);
					const oy = Math.round(cy + dv * proj.sy * fit);
					if (ox < 0 || ox >= outCols || oy < 0 || oy >= outRows) continue;
					const outIdx = oy * outCols + ox;
					if (occupancy[outIdx] === 0) {
						occupancy[outIdx] = 1;
						haloIdxGrid[outIdx] = haloIdx;
					}
				}
			}

			// Body pass - z-buffered for spinning modes (so the visible half
			// is always the front-most), flat for the rest (pulse, wave,
			// shimmer, glitch).
			for (let v = 0; v < maskH; v++) {
				const rowOff = rowOffsets[v] ?? 0;
				for (let u = 0; u < maskW; u++) {
					if (!mask[v * maskW + u]) continue;
					const du = u - maskW / 2;
					const dv = v - maskH / 2;
					let ox: number;
					let rz = 0;
					if (isSpinning) {
						const rx = du * cosA;
						rz = du * sinA;
						const persp = 1 + rz * perspK;
						ox = Math.round(cx + rx * persp * fit);
					} else {
						ox = Math.round(cx + (du * proj.sx + rowOff) * fit);
					}
					const oy = Math.round(cy + dv * proj.sy * fit);
					if (ox < 0 || ox >= outCols || oy < 0 || oy >= outRows) continue;
					const idx = oy * outCols + ox;
					if (isSpinning) {
						// Z-test: only paint if this cell is closer than what's
						// already there. Same projected pixel from the back half
						// loses to the front half automatically.
						if (rz <= zBuffer[idx]) continue;
						zBuffer[idx] = rz;
					}
					occupancy[idx] = 2;
				}
			}

			// Mode-specific overlay state computed once per frame.
			//
			// shimmer (vertical bar): position is a 0..outCols x value; band
			// distance is |c - center|.
			//
			// spin-shimmer-45: concurrent with the (eased) spin - the bar
			// sweeps the full diagonal once every SS45_SHIMMER_PERIOD seconds
			// on its own wall-clock timer, pauses off-canvas during the rest
			// of the duty cycle, then re-enters. Driven by animTime so it's
			// independent of spin velocity / rotationSpeed.
			// Scale by (outCols - 1) so the bar center stays inside the valid
			// column range [0, outCols - 1] even at sin(a) === 1 (which would
			// otherwise put the center at outCols, slightly skewing the right-
			// edge distance check).
			const shimmerCenter =
				mode === "shimmer" ? ((Math.sin(a) + 1) / 2) * Math.max(0, outCols - 1) : -1;
			const shimmerBand = Math.max(2, Math.floor(outCols * 0.06));
			const diagShimmerBand = Math.max(3, Math.floor(outCols * 0.08));
			const diagSweepFull = outCols + outRows + diagShimmerBand * 2;
			let diagShimmerK = -9999;
			if (mode === "spin-shimmer-45") {
				const phase = (t % SS45_SHIMMER_PERIOD) / SS45_SHIMMER_PERIOD;
				if (phase < SS45_SHIMMER_DUTY) {
					diagShimmerK = (phase / SS45_SHIMMER_DUTY) * diagSweepFull - diagShimmerBand;
				}
			}
			// Glitch only applies to glitch / spin-glitch modes. spin-shimmer-45
			// deliberately has NO glitch - the sequence should feel clean.
			const glitchActive =
				(mode === "glitch" && Math.floor(a * 4) % 7 === 0) ||
				(mode === "spin-glitch" && Math.floor(a * 4) % 5 === 0);

			ctx.font = ctxFontString;
			ctx.textBaseline = "top";
			// Set fillStyle ONCE (white) and modulate per-cell brightness via
			// globalAlpha. Building a fresh `rgba(255,255,255,${alpha})` string
			// per cell would allocate ~5000 strings per frame, ~300k/sec at
			// 60fps - significant GC churn, especially with 10 instances on
			// /experiments/hero-anim. Single fixed fillStyle + per-cell
			// globalAlpha is the canonical zero-alloc canvas pattern.
			ctx.fillStyle = "rgb(255,255,255)";
			const fillCh = RAMP[FILL_CHAR_INDEX];
			for (let r = 0; r < outRows; r++) {
				for (let c = 0; c < outCols; c++) {
					const i = r * outCols + c;
					const occ = occupancy[i];
					if (occ === 0) continue;
					if (occ === 2) {
						// Body - bright bar brightens cells near the band, body
						// elsewhere stays at a slight dim base for contrast.
						let ch = fillCh;
						let alpha = 1;
						if (mode === "shimmer") {
							const distance = Math.abs(c - shimmerCenter);
							alpha = distance < shimmerBand ? 1 : 0.4;
						} else if (mode === "spin-shimmer-45") {
							// Diagonal bar at slope -1 (line c + r = k). Inside the
							// band: full bright (alpha 1). Outside: smooth ease 1.0
							// → 0.78 over one band-width, then constant 0.78. When
							// bar is parked off-canvas (k = -9999), distance is huge
							// → all cells render at the 0.78 base, which still reads
							// as a clearly visible silhouette.
							const distance = Math.abs(c + r - diagShimmerK);
							const baseAlpha = 0.78;
							if (distance < diagShimmerBand) {
								alpha = 1;
							} else {
								const fade = Math.min((distance - diagShimmerBand) / diagShimmerBand, 1);
								alpha = 1 - fade * (1 - baseAlpha);
							}
						} else if (mode === "galaxy") {
							// V2 - silhouette stays static; each cell cycles through
							// the ramp on its own phase = animation-time + angular
							// position from center + slight radial twist. Reads as
							// a galaxy spiral: density bands flow outward and rotate
							// around the lobster's center. `t` is animTime (paused
							// when RAF is paused), and `rotationSpeed` scales the
							// cycle rate so the same prop semantics that drive the
							// rotating modes also tune the cycling speed here.
							const dc = c - outCols / 2;
							const dr = r - outRows / 2;
							const radius = Math.sqrt(dc * dc + dr * dr);
							const ang = Math.atan2(dr, dc); // [-π, π]
							const phase =
								t * 4.0 * rotationSpeed + // cycle rate, scaled by prop
								ang * 2.5 + // 2.5 cycles per revolution → spiral arms
								radius * 0.18; // radial twist
							// Skip RAMP[0] (space) so cells are always visible. Use
							// mod that handles negative phases correctly.
							const span = RAMP.length - 1;
							const idx = ((Math.floor(phase) % span) + span) % span;
							ch = RAMP[idx + 1];
							alpha = 0.95;
						}
						if (glitchActive && Math.random() < 0.04) {
							ch = RAMP[Math.floor(Math.random() * (RAMP.length - 1)) + 1];
						}
						// Depth shading for spinning modes - front cells render
						// brighter, back cells dimmer. zBuffer holds rz in roughly
						// [-maskW/2, +maskW/2]; normalize to [-1, 1] where +1 =
						// closest. lit-3d takes this further: char is picked from
						// the full ramp by depth, donut.c-style - front cells get
						// dense `@`, back cells get sparse `.`.
						if (isSpinning) {
							const depthNorm = Math.max(-1, Math.min(1, zBuffer[i] / (maskW / 2)));
							alpha *= 0.55 + 0.45 * ((depthNorm + 1) / 2);
							if (mode === "lit-3d") {
								// V3 - map depth directly to full ramp position. (depthNorm+1)/2
								// ∈ [0,1]; multiply by (ramp length - 1) (skip space at index 0).
								if (ch === fillCh) {
									const lum = (depthNorm + 1) / 2;
									const idx = 1 + Math.round(lum * (RAMP.length - 2));
									ch = RAMP[idx];
								}
							} else if (ch === fillCh) {
								if (depthNorm < -0.3) ch = "%";
								else if (depthNorm < 0.1) ch = "&";
							}
						}
						// Cursor proximity swap LAST so it always wins, regardless
						// of which mode-specific char selection happened above.
						// Squared-distance compare keeps the inner loop sqrt-free.
						if (hoverCol >= 0) {
							const dc = c - hoverCol;
							const dr = r - hoverRow;
							if (dc * dc + dr * dr <= HOVER_RADIUS_CELLS * HOVER_RADIUS_CELLS) {
								ch = HOVER_FILL_CHAR;
							}
						}
						ctx.globalAlpha = alpha;
						ctx.fillText(ch, c * cellPx, r * cellPx);
					} else {
						ctx.globalAlpha = 0.55;
						ctx.fillText(HALO_CHARS[haloIdxGrid[i]], c * cellPx, r * cellPx);
					}
				}
			}
		}

		function tick(t: number) {
			if (cancelled || !visible || !mask) {
				raf = 0;
				return;
			}
			raf = requestAnimationFrame(tick);
			const dt = (t - lastT) / 1000;
			lastT = t;
			animTime += dt;
			if (mode === "spin-shimmer-45") {
				// Velocity-eased continuous spin per user feedback ("slower
				// when it flips, never stops"). Multiplier maps to ~0.35 at
				// the edge-on views (angle ~= π/2, 3π/2 where the silhouette
				// is compressed to a vertical line - the "flip" moment) and
				// ~1.25 at the wide views (angle ~= 0, π - full silhouette
				// facing camera). cos(a) is 1 at wide and 0 at edge, so
				// (0.35 + 0.9·|cos|) gives high velocity at wide, low at edge.
				// Net effect: lobster moves quickly through the readable poses
				// and slows down through the compressed flip transition.
				const ease = 0.35 + 0.9 * Math.abs(Math.cos(angle));
				angle += dt * rotationSpeed * ease;
			} else {
				angle += dt * rotationSpeed;
			}
			// Wrap angle into [0, 2π) to keep Math.sin / Math.cos precise
			// over long sessions. Full modulo (not a single subtract) because
			// a backgrounded tab or a sleep/wake cycle can produce a huge
			// `dt`, advancing `angle` by multiple revolutions in one step.
			// The `((x % tau) + tau) % tau` form is robust against both large
			// positive dt and any signed edge case.
			const tau = Math.PI * 2;
			angle = ((angle % tau) + tau) % tau;
			paint(angle, animTime);
		}
		// (re)start the RAF loop. Idempotent: the `raf !== 0` check makes
		// repeated calls a no-op while the loop is already running. Also
		// bails when reduced-motion is honored, the component is cancelled,
		// or the mask has not loaded yet.
		function startLoop() {
			if (cancelled || raf !== 0 || reduced || !mask) return;
			lastT = performance.now();
			raf = requestAnimationFrame(tick);
		}
		function stopLoop() {
			if (raf !== 0) {
				cancelAnimationFrame(raf);
				raf = 0;
			}
		}
		// Schedule a single coalesced repaint when the main RAF loop is
		// NOT running (reduced-motion honored, scrolled off-screen, or
		// not yet started because the mask is still loading). Used by
		// resize() to paint once after the canvas gets cleared on a
		// dimension change, and by pointer handlers so the @→$ hover
		// swap still works while the main loop is paused. A burst of
		// calls within one frame coalesces to exactly one paint via the
		// `pendingHoverPaint !== 0` guard. Function declaration (not
		// arrow) so it's hoisted - resize() is called during effect
		// setup BEFORE pointer handlers are wired.
		function schedulePaintIfIdle() {
			if (cancelled || !mask || raf !== 0 || pendingHoverPaint !== 0) return;
			pendingHoverPaint = requestAnimationFrame(() => {
				pendingHoverPaint = 0;
				if (cancelled || !mask) return;
				paint(angle, animTime);
			});
		}

		const ro = new ResizeObserver(resize);
		ro.observe(canvas);
		resize();

		loadMask()
			.then(() => {
				// Bail out if the component already unmounted while the SVG
				// was loading. Without this guard we would schedule an RAF
				// tick on a canvas that React has detached.
				if (cancelled) return;
				paint(angle, animTime);
				startLoop();
			})
			.catch((err) => {
				if (cancelled) return;
				console.warn("HeroVisual mask load failed:", err);
			});

		// IntersectionObserver: actually CANCEL the RAF loop when the canvas
		// scrolls off-screen so the renderer is not burning ~60fps + GC for
		// a hidden element. Re-arm when it returns to view.
		const io = new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					visible = e.isIntersecting;
					if (visible) startLoop();
					else stopLoop();
				}
			},
			{ threshold: 0 },
		);
		io.observe(canvas);

		// Cursor tracking - PointerEvent.offsetX/Y is already relative to
		// the target element, so no client-rect math (and no rect cache /
		// scroll listener) is needed to translate to cell coords.
		// Mouse-only filter. The @ -> $ swap is a cursor-proximity effect;
		// touch interactions can fire pointermove during a scroll/drag and
		// then never deliver a clean pointerleave, leaving hover stuck on
		// after the user lifts their finger. Ignoring touch + pen pointers
		// keeps the effect desktop-cursor-scoped where it belongs.
		const onPointerMove = (e: PointerEvent) => {
			if (e.pointerType !== "mouse") return;
			hoverCol = Math.floor(e.offsetX / cellPx);
			hoverRow = Math.floor(e.offsetY / cellPx);
			schedulePaintIfIdle();
		};
		const clearHover = () => {
			if (hoverCol === -1 && hoverRow === -1) return;
			hoverCol = -1;
			hoverRow = -1;
			schedulePaintIfIdle();
		};
		canvas.addEventListener("pointermove", onPointerMove);
		// pointerleave for the normal exit; pointercancel as a safety net
		// for touch / interrupted gestures that bypass leave.
		canvas.addEventListener("pointerleave", clearHover);
		canvas.addEventListener("pointercancel", clearHover);

		return () => {
			cancelled = true;
			stopLoop();
			if (pendingHoverPaint !== 0) {
				cancelAnimationFrame(pendingHoverPaint);
				pendingHoverPaint = 0;
			}
			ro.disconnect();
			io.disconnect();
			canvas.removeEventListener("pointermove", onPointerMove);
			canvas.removeEventListener("pointerleave", clearHover);
			canvas.removeEventListener("pointercancel", clearHover);
		};
	}, [cellPx, rotationSpeed, src, respectReducedMotion, mode]);

	return (
		// The canvas is purely decorative, so aria-hidden hides it from
		// assistive tech. tabIndex={-1} removes it from the keyboard
		// tab order (and silences Biome's noAriaHiddenOnFocusable rule
		// which treats <canvas> as potentially focusable). Pointer
		// interaction still works for the hover @ -> $ swap; keyboard
		// users do not need it because the canvas conveys no info that
		// is not also expressed in the surrounding copy.
		<canvas
			ref={canvasRef}
			className="hero-visual-canvas"
			style={{ opacity }}
			aria-hidden="true"
			tabIndex={-1}
		/>
	);
}
