import { Section } from "./section";

export function Pricing() {
	return (
		<Section
			eyebrow="PRICING"
			title="One fee, no subscription"
			blurb="LobsterPay is free to install. We take a small fee on each successful payment - your vault covers its own network gas out of a SOL reserve you deposit once."
		>
			<div className="pricing-grid">
				<div className="pricing-card">
					<div className="label-mono pricing-eyebrow">SERVICE FEE</div>
					<div className="pricing-big">1.5%</div>
					<div className="pricing-sub">
						Taken from each agent payment - split on-chain by the Anchor program:
						98.5% → your destination, 1.5% → LobsterPay treasury.
					</div>
				</div>
				<div className="pricing-card">
					<div className="label-mono pricing-eyebrow">NETWORK GAS</div>
					<div className="pricing-big">~0.00001 SOL / tx</div>
					<div className="pricing-sub">
						Paid by our relayer, then reimbursed from your vault's fee_vault PDA
						(hard-capped at 10,000 lamports per action). Deposit once, the
						relayer handles the rest.
					</div>
				</div>
				<div className="pricing-card">
					<div className="label-mono pricing-eyebrow">SUBSCRIPTION</div>
					<div className="pricing-big">$0</div>
					<div className="pricing-sub">
						No seat fee, no API-call minimums. Install the SDK, create a vault,
						fund it with USDC. If your agent doesn't spend, you don't pay.
					</div>
				</div>
			</div>
		</Section>
	);
}
