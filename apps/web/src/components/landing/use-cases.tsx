import { Section } from "./section";

const CASES = [
	{
		icon: "📚",
		title: "Research agents",
		blurb: "Pay per-call for paid APIs (arxiv paywalls, scientific databases, Bloomberg feeds). Issue a key with a $10/day cap and let the agent pull what it needs without a corporate card in the loop.",
		example: "check_vault → pay_x402 → fetch content",
	},
	{
		icon: "🛠️",
		title: "Coding & deploy agents",
		blurb: "Give your build agent a key scoped to Railway, Vercel, AWS metered endpoints. Per-tx caps prevent a runaway loop from draining the budget.",
		example: "make_payment · memo=\"prod deploy #1247\"",
	},
	{
		icon: "📈",
		title: "Trading & market-data agents",
		blurb: "Subscribe to market data feeds (CoinGecko Pro, Birdeye, Helius) from an agent account. Revoke the key the moment the strategy changes.",
		example: "pay_x402 on paywalled candles · swap USDC→SOL",
	},
];

export function UseCases() {
	return (
		<Section
			eyebrow="USE CASES"
			title="What agents actually buy"
			blurb="LobsterPay is a spending boundary, not a wallet replacement. The owner keeps the treasury; the vault is what the agent is allowed to touch."
		>
			<div className="usecases-grid">
				{CASES.map((c) => (
					<div key={c.title} className="usecase-card">
						<div className="usecase-icon">{c.icon}</div>
						<h3 className="usecase-title">{c.title}</h3>
						<p className="usecase-blurb">{c.blurb}</p>
						<code className="usecase-example">{c.example}</code>
					</div>
				))}
			</div>
		</Section>
	);
}
