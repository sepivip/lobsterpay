import Link from "next/link";

const ANIMS: Array<{ slug: string; title: string; blurb: string }> = [
	{
		slug: "lobster-walk",
		title: "#1 · LOBSTER WALK",
		blurb:
			"ASCII lobster walking left-to-right, leaving a USDC trail. Loop-friendly, 10-12s cut for X.",
	},
	{
		slug: "usdc-stream",
		title: "#4 · USDC STREAM",
		blurb:
			"Vault → ATA pipeline with $ symbols flowing between ASCII endpoints. Counter ticks the transferred amount.",
	},
];

export default function AnimExperimentsIndex() {
	return (
		<main className="exp-page">
			<div className="exp-toc">
				<div className="label-mono">ANIM · SHORTS FOR X</div>
				<div className="label-mono text-ghost">
					preview each → we batch-record the approved ones via playwright → mp4.
				</div>
			</div>
			<div className="exp-anim-grid">
				{ANIMS.map((a) => (
					<section key={a.slug} className="exp-anim-cell">
						<div className="exp-anim-label">
							<span className="label-mono">{a.title}</span>
							<span className="text-ghost">{a.blurb}</span>
							<span className="label-mono text-ghost">
								<Link href={`/experiments/anim/${a.slug}`}>open fullscreen →</Link>
							</span>
						</div>
						<div className="exp-anim-canvas-wrap" style={{ aspectRatio: "16 / 9" }}>
							<iframe
								src={`/experiments/anim/${a.slug}?embed=1`}
								style={{ width: "100%", height: "100%", border: 0, background: "var(--bg-deep)" }}
								title={a.title}
							/>
						</div>
					</section>
				))}
			</div>
		</main>
	);
}
