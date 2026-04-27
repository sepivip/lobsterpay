import Link from "next/link";

const ANIMS: Array<{ slug: string; title: string; blurb: string }> = [
	{
		slug: "lobster-walk",
		title: "#1 · LOBSTER WALK",
		blurb: "Mascot walks left→right leaving a USDC trail.",
	},
	{
		slug: "usdc-stream",
		title: "#2 · USDC STREAM",
		blurb: "Vault → API pipeline with $ pulses + running counter.",
	},
	{
		slug: "x402-handshake",
		title: "#3 · x402 HANDSHAKE",
		blurb: "Three-panel: GET → 402 + PAY → 200 OK.",
	},
	{
		slug: "policy-gate",
		title: "#4 · POLICY GATE",
		blurb: "Requests stream in; gate allows or deflects each.",
	},
	{
		slug: "boot-sequence",
		title: "#5 · BOOT SEQUENCE",
		blurb: "Terminal logs scroll, then wordmark reveals.",
	},
	{
		slug: "budget-ticker",
		title: "#6 · BUDGET TICKER",
		blurb: "Big USDC counter ticks down as agents spend.",
	},
	{
		slug: "multi-agent",
		title: "#7 · MULTI-AGENT",
		blurb: "Many agents · one vault · one policy.",
	},
	{
		slug: "fee-flow",
		title: "#8 · FEE FLOW",
		blurb: "Payment splits 98.5% merchant / 1.5% treasury.",
	},
	{
		slug: "siwx-sign",
		title: "#9 · SIWX SIGN",
		blurb: "Challenge → signature materializes → AUTHORIZED.",
	},
	{
		slug: "terminal-demo",
		title: "#10 · TERMINAL DEMO",
		blurb: "Fake terminal types a curl, streams the response.",
	},
	{
		slug: "rejected",
		title: "BONUS · REJECTED",
		blurb: "Request hits the cap, DENIED stamp, reason shown.",
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
