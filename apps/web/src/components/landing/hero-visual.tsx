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
 * Honors prefers-reduced-motion (paints one static frame, no RAF
 * loop). Cancels the RAF loop when off-screen via IntersectionObserver
 * and re-arms when scrolled back into view, so a hidden hero is not
 * burning ~60fps + GC churn.
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
 * but warps the (u, v) → (ox, oy) projection differently per frame.
 *
 *   spin     - Y-axis rotation. Silhouette compresses on X as it turns.
 *   tumble   - Y + X rotation simultaneously. Lobster pitches and yaws.
 *   pulse    - No rotation. Scale breathes between ~0.85 and 1.05.
 *   glitch   - Mostly static; periodically corrupts ~3% of body cells
 *              with random ramp chars for ~120 ms then snaps back.
 *   wave     - No rotation. Each row is sine-displaced horizontally for
 *              an underwater-current feel.
 *   shimmer  - No rotation. A vertical bar of brighter chars sweeps
 *              left→right; cells outside the bar stay at base brightness.
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
  /** Animation rate (radians/sec for rotations, cycles/sec for pulse/wave). */
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
      respectReducedMotion &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let mask: Uint8Array | null = null;
    let maskW = 0;
    let maskH = 0;
    // Per-mask-cell halo chars, picked once. Empty string = no halo.
    let haloChars: string[] = [];
    let raf = 0;
    let visible = true;
    let angle = 0;
    // Wall-clock seconds since mount, independent of rotationSpeed. Used
    // for effects (like the diagonal shimmer sweep) that should pace the
    // same regardless of how fast the lobster is spinning.
    let wallTime = 0;
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
    // Cursor position in output-cell coordinates. -1 means not hovering.
    let hoverCol = -1;
    let hoverRow = -1;
    // Set true on cleanup so any in-flight loadMask().then() bails out
    // before scheduling RAF on an unmounted canvas.
    let cancelled = false;

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
      if (!octx) return;
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
      // Pre-pick a halo char for each EMPTY mask cell that touches the
      // silhouette edge. Sparse (~20% of edge cells) so the halo reads
      // as a soft scatter, not a thick outline.
      haloChars = new Array(w * h).fill("");
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
          haloChars[v * w + u] = HALO_CHARS[Math.floor(Math.random() * HALO_CHARS.length)];
        }
      }
    }

    function resize() {
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = canvas.getBoundingClientRect();
      cssWidth = width;
      cssHeight = height;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      outCols = Math.ceil(width / cellPx);
      outRows = Math.ceil(height / cellPx);
      occupancy = new Uint8Array(outCols * outRows);
      haloIdxGrid = new Uint8Array(outCols * outRows);
      zBuffer = new Float32Array(outCols * outRows);
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
        case "shimmer":
        case "glitch":
        case "spin":
        case "spin-shimmer-45":
        case "spin-glitch":
        case "lit-3d":
        default: {
          // shimmer + glitch render the silhouette statically; the
          // animation is in the per-cell render below.
          // spin / spin-shimmer-45 / spin-glitch / lit-3d = Y rotation;
          // shimmer / glitch on their own = no rotation.
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
      // resized exactly once in loadMask(); we just refill / zero here.
      if (proj.rowSineAmp > 0) {
        for (let v = 0; v < maskH; v++) {
          rowOffsets[v] =
            Math.sin(v * proj.rowSineFreq + (proj.rowSinePhase ?? 0)) *
            proj.rowSineAmp *
            maskW;
        }
      } else if (rowOffsets.length > 0 && rowOffsets[0] !== 0) {
        // Last frame may have left non-zero values from wave mode if
        // the user switched modes; clear once so the (rowOff ?? 0) sites
        // below see zeros for non-wave modes.
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
        zBuffer.fill(-Infinity);
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
      // paint over.
      for (let v = 0; v < maskH; v++) {
        const rowOff = rowOffsets[v] ?? 0;
        for (let u = 0; u < maskW; u++) {
          const ch = haloChars[v * maskW + u];
          if (!ch) continue;
          const du = u - maskW / 2;
          const dv = v - maskH / 2;
          const ox = Math.round(cx + (du * proj.sx + rowOff) * fit);
          const oy = Math.round(cy + dv * proj.sy * fit);
          if (ox < 0 || ox >= outCols || oy < 0 || oy >= outRows) continue;
          const idx = oy * outCols + ox;
          if (occupancy[idx] === 0) {
            occupancy[idx] = 1;
            haloIdxGrid[idx] = HALO_CHARS.indexOf(ch);
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
      // of the duty cycle, then re-enters. Driven by wallTime so it's
      // independent of spin velocity / rotationSpeed.
      const shimmerCenter =
        mode === "shimmer" ? ((Math.sin(a) + 1) / 2) * outCols : -1;
      const shimmerBand = Math.max(2, Math.floor(outCols * 0.06));
      const diagShimmerBand = Math.max(3, Math.floor(outCols * 0.08));
      const diagSweepFull = outCols + outRows + diagShimmerBand * 2;
      let diagShimmerK = -9999;
      if (mode === "spin-shimmer-45") {
        const phase = (t % SS45_SHIMMER_PERIOD) / SS45_SHIMMER_PERIOD;
        if (phase < SS45_SHIMMER_DUTY) {
          diagShimmerK =
            (phase / SS45_SHIMMER_DUTY) * diagSweepFull - diagShimmerBand;
        }
      }
      // Glitch only applies to glitch / spin-glitch modes. spin-shimmer-45
      // deliberately has NO glitch - the sequence should feel clean.
      const glitchActive =
        (mode === "glitch" && Math.floor(a * 4) % 7 === 0) ||
        (mode === "spin-glitch" && Math.floor(a * 4) % 5 === 0);

      ctx.font = `${cellPx}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.textBaseline = "top";
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
                const fade = Math.min(
                  (distance - diagShimmerBand) / diagShimmerBand,
                  1,
                );
                alpha = 1 - fade * (1 - baseAlpha);
              }
            } else if (mode === "galaxy") {
              // V2 - silhouette stays static, each cell cycles through
              // the ramp on its own phase. Phase = global wall-clock +
              // angular position from center + slight radial twist.
              // Visually reads as a galaxy spiral: density bands flow
              // outward and rotate around the lobster's center.
              const dc = c - outCols / 2;
              const dr = r - outRows / 2;
              const radius = Math.sqrt(dc * dc + dr * dr);
              const ang = Math.atan2(dr, dc); // [-π, π]
              const phase =
                t * 4.0 + // global cycle speed
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
              const depthNorm = Math.max(
                -1,
                Math.min(1, zBuffer[i] / (maskW / 2)),
              );
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
            ctx.fillStyle = `rgba(255,255,255,${alpha})`;
            ctx.fillText(ch, c * cellPx, r * cellPx);
          } else {
            ctx.fillStyle = "rgba(255,255,255,0.55)";
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
      wallTime += dt;
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
      paint(angle, wallTime);
    }
    // (re)start the RAF loop. Safe to call repeatedly; if `raf` is
    // already non-zero it just no-ops via the `cancelled || !visible`
    // guard inside tick on the next frame, but we want to start cleanly.
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

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    loadMask()
      .then(() => {
        // Bail out if the component already unmounted while the SVG
        // was loading. Without this guard we would schedule an RAF
        // tick on a canvas that React has detached.
        if (cancelled) return;
        paint(angle, wallTime);
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

    // Cursor tracking - translate pointer client coords into output-cell
    // grid coords so the body render loop can do a cheap distance check.
    const onPointerMove = (e: PointerEvent) => {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      hoverCol = Math.floor((e.clientX - rect.left) / cellPx);
      hoverRow = Math.floor((e.clientY - rect.top) / cellPx);
    };
    const onPointerLeave = () => {
      hoverCol = -1;
      hoverRow = -1;
    };
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerleave", onPointerLeave);

    return () => {
      cancelled = true;
      stopLoop();
      ro.disconnect();
      io.disconnect();
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
    };
  }, [cellPx, rotationSpeed, src, respectReducedMotion, mode]);

  return (
    <canvas
      ref={canvasRef}
      className="hero-visual-canvas"
      style={{ opacity }}
      aria-hidden="true"
    />
  );
}
