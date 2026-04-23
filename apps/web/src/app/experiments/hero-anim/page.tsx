"use client";

import { HeroVisual, type HeroVisualMode } from "@/components/landing/hero-visual";

const MODES: Array<{
  mode: HeroVisualMode;
  label: string;
  blurb: string;
  speed: number;
}> = [
  { mode: "spin-shimmer-45", label: "V1 · SPIN + SHIMMER 45°", blurb: "Y-axis rotation, 3D z-buffered, eased velocity, diagonal bar sweeps over.", speed: 1.4 },
  { mode: "galaxy", label: "V2 · GALAXY (CHAR FLOW)", blurb: "Static silhouette, each cell cycles ramp chars with angular + radial phase. No geometric rotation.", speed: 1.0 },
  { mode: "lit-3d", label: "V3 · LIT 3D (DONUT-STYLE)", blurb: "Y-rotation with full-ramp char-by-depth shading, like donut.c. Char density tracks surface luminance.", speed: 1.4 },
  { mode: "spin-glitch", label: "SPIN + GLITCH", blurb: "Y-axis rotation with periodic char scramble pulses.", speed: 1.4 },
  { mode: "spin", label: "SPIN", blurb: "Y-axis rotation. Silhouette compresses on X.", speed: 1.4 },
  { mode: "tumble", label: "TUMBLE", blurb: "Y + X rotation simultaneously. Pitches and yaws.", speed: 1.0 },
  { mode: "pulse", label: "PULSE", blurb: "Scale breathing 0.85 ↔ 1.05. No rotation.", speed: 1.6 },
  { mode: "wave", label: "WAVE", blurb: "Per-row sine displacement. Underwater current.", speed: 2.0 },
  { mode: "shimmer", label: "SHIMMER", blurb: "Vertical bright bar sweeps left → right.", speed: 1.0 },
  { mode: "glitch", label: "GLITCH", blurb: "Static silhouette + periodic char scramble.", speed: 1.2 },
];

export default function HeroAnimExperimentsPage() {
  return (
    <main className="exp-page">
      <div className="exp-toc">
        <div className="label-mono">HERO-ANIM · LIVE EXPERIMENTS</div>
        <div className="label-mono text-ghost">scroll to compare. current production default: `galaxy`.</div>
      </div>
      <div className="exp-anim-grid">
        {MODES.map((m) => (
          <section key={m.mode} className="exp-anim-cell" id={`mode-${m.mode}`}>
            <div className="exp-anim-label">
              <span className="label-mono">{m.label}</span>
              <span className="text-ghost">{m.blurb}</span>
            </div>
            <div className="exp-anim-canvas-wrap">
              <HeroVisual
                mode={m.mode}
                opacity={0.95}
                cellPx={9}
                rotationSpeed={m.speed}
                respectReducedMotion={false}
              />
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
