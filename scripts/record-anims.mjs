#!/usr/bin/env node
// Batch-record ASCII animations from /experiments/anim/<slug> to MP4
// files for posting on X. Uses Playwright to record WebM, then ffmpeg
// (via ffmpeg-static) to transcode to H.264 MP4 at 1280x720.
//
// Requirements:
//   - dev server running at localhost:3000 (pnpm dev:web)
//   - pnpm add -w -D playwright ffmpeg-static
//   - npx playwright install chromium
//
// Usage:
//   node scripts/record-anims.mjs            # records all
//   node scripts/record-anims.mjs lobster-walk usdc-stream   # subset

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegPath from "ffmpeg-static";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "public", "marketing", "anim");
const TMP_DIR = path.join(ROOT, ".anim-recording-tmp");

// slug → seconds to record. Must be >= loopSeconds of the component so
// we capture at least one clean loop. 1-2s padding is fine (viewers see
// the loop wrap as a natural restart).
const ANIMS = [
	{ slug: "lobster-walk", seconds: 10 },
	{ slug: "usdc-stream", seconds: 8 },
	{ slug: "x402-handshake", seconds: 8 },
	{ slug: "policy-gate", seconds: 12 },
	{ slug: "boot-sequence", seconds: 12 },
	{ slug: "budget-ticker", seconds: 10 },
	{ slug: "multi-agent", seconds: 10 },
	{ slug: "fee-flow", seconds: 7 },
	{ slug: "siwx-sign", seconds: 8 },
	{ slug: "terminal-demo", seconds: 12 },
	{ slug: "rejected", seconds: 10 },
];

const BASE = process.env.ANIM_BASE_URL || "http://localhost:3000";
const VIEWPORT = { width: 1280, height: 720 };

async function main() {
	const argv = process.argv.slice(2);
	const want = argv.length > 0 ? new Set(argv) : null;
	const list = want ? ANIMS.filter((a) => want.has(a.slug)) : ANIMS;
	if (list.length === 0) {
		console.error("No anims matched:", argv.join(", "));
		process.exit(1);
	}

	mkdirSync(OUT_DIR, { recursive: true });
	if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true, force: true });
	mkdirSync(TMP_DIR, { recursive: true });

	const browser = await chromium.launch();

	for (const { slug, seconds } of list) {
		const url = `${BASE}/experiments/anim/${slug}`;
		const slugTmp = path.join(TMP_DIR, slug);
		mkdirSync(slugTmp, { recursive: true });
		console.log(`→ recording ${slug} (${seconds}s) from ${url}`);

		const context = await browser.newContext({
			viewport: VIEWPORT,
			recordVideo: { dir: slugTmp, size: VIEWPORT },
		});
		const page = await context.newPage();
		await page.goto(url, { waitUntil: "networkidle" });
		// Small settle to let RAF get up to speed + fonts stable
		await page.waitForTimeout(800);
		await page.waitForTimeout(seconds * 1000);
		await context.close(); // flushes the WebM

		// Find the produced WebM and rename
		const files = readdirSync(slugTmp).filter((f) => f.endsWith(".webm"));
		if (files.length === 0) {
			console.error(`!! no webm produced for ${slug}`);
			continue;
		}
		const webmPath = path.join(slugTmp, files[0]);
		const mp4Path = path.join(OUT_DIR, `${slug}.mp4`);

		// Transcode: scale to 1280x720 (in case source differs), H.264
		// (yuv420p for broad compatibility), 30fps, silent. CRF 20 keeps
		// sharp ASCII edges without bloating file size.
		console.log(`  → transcoding to ${mp4Path}`);
		await transcode(webmPath, mp4Path);
	}

	await browser.close();
	rmSync(TMP_DIR, { recursive: true, force: true });
	console.log(`\n✓ done. mp4s in ${OUT_DIR}`);
}

function transcode(input, output) {
	return new Promise((resolve, reject) => {
		const args = [
			"-y",
			"-i",
			input,
			"-vf",
			`scale=${VIEWPORT.width}:${VIEWPORT.height}:force_original_aspect_ratio=decrease,pad=${VIEWPORT.width}:${VIEWPORT.height}:(ow-iw)/2:(oh-ih)/2:color=0x0b0d11,fps=30`,
			"-c:v",
			"libx264",
			"-pix_fmt",
			"yuv420p",
			"-preset",
			"medium",
			"-crf",
			"20",
			"-movflags",
			"+faststart",
			"-an",
			output,
		];
		const proc = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
		let stderr = "";
		proc.stderr.on("data", (b) => {
			stderr += b.toString();
		});
		proc.on("exit", (code) => {
			if (code === 0) resolve();
			else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-500)}`));
		});
	});
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
