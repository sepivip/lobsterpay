import { Section } from "./section";

const STEPS = [
	{
		n: "01",
		title: "Create a vault",
		body: "Connect your wallet, sign one transaction. You get a program-controlled vault PDA on Solana and a fee vault for tx gas - no seed phrases, no hot wallets to manage.",
		hint: "1 wallet signature · ~5 seconds",
	},
	{
		n: "02",
		title: "Set limits, issue a key",
		body: "Choose which tokens can move, pick per-tx and daily caps, whitelist destinations. Issue an API key with its own override limits - pause or revoke it any time.",
		hint: "On-chain policy · enforced before any payment",
	},
	{
		n: "03",
		title: "Agent spends - you watch",
		body: "Point an AI agent at the key. It calls /v1/agent/actions/pay for payments, /v1/agent/actions/x402 for paywalled APIs, /v1/agent/actions/swap for DEX quotes. Every action lands in your activity feed with a tx signature.",
		hint: "Your keys never leave your wallet",
	},
];

export function HowItWorks() {
	return (
		<Section
			id="how-it-works"
			eyebrow="HOW IT WORKS"
			title="Three steps from wallet to agent spend"
			blurb="A vault is the boundary. Your wallet signs policy, the agent signs nothing - it just asks the API, which enforces your limits both off-chain (before the tx) and on-chain (inside the program)."
		>
			<div className="hiw-grid">
				{STEPS.map((step) => (
					<div key={step.n} className="hiw-step">
						<div className="hiw-step-num">{step.n}</div>
						<div className="hiw-step-body">
							<h3 className="hiw-step-title">{step.title}</h3>
							<p className="hiw-step-text">{step.body}</p>
							<span className="label-mono hiw-step-hint">{step.hint}</span>
						</div>
					</div>
				))}
			</div>
		</Section>
	);
}
