"use client";

import { useState } from "react";
import { Section } from "./section";

const ITEMS = [
	{
		q: "Is LobsterPay on mainnet yet?",
		a: "No - currently on Solana devnet for the Colosseum hackathon. The program is audited (B+ grade, all Critical and Important findings fixed) and ready for mainnet deploy post-hackathon. The exact same instructions and limits behave identically on mainnet; you'd just fund with real USDC.",
	},
	{
		q: "What's x402?",
		a: "HTTP 402 Payment Required reinvented for agents: when an API returns a 402 with payment requirements in the body, the agent calls pay_x402 on LobsterPay instead of a human filling out a card form. We handle the Solana payment, the API retries with proof, and the agent gets the paywalled data.",
	},
	{
		q: "How do I revoke a key mid-task?",
		a: "Dashboard → Keys → click the key → Revoke. Takes effect the instant the DB update lands - any in-flight agent request hitting that key after revoke returns 401. For a vault-wide kill-switch, Emergency Pause on the Policy page blocks all agent actions on-chain until you unpause.",
	},
	{
		q: "What stops a compromised relayer from draining vaults?",
		a: "The Anchor program. The relayer can sign but cannot bypass the policy. If the relayer tries to exceed maxPerTxAmountAtomic, the on-chain check fails with AmountExceedsPerTxLimit. Same for daily caps, allowlists, and paused state. The relayer is also hard-capped at 10,000 lamports of fee reimbursement per action.",
	},
	{
		q: "Do I pay gas on every agent payment?",
		a: "Not directly. Our relayer pays the ~5,000 lamport network fee, and the Anchor program reimburses the relayer from your vault's fee_vault PDA (bounded at 10k lamports per action). You top up the fee_vault once with a small SOL amount, and agent txs work until it runs out.",
	},
	{
		q: "What happens if I lose my wallet?",
		a: "Exactly what you'd expect for a self-custodial product - same as losing the keys to any Solana wallet. There's no backdoor. But every vault's funds stay on-chain at a deterministic PDA derived from the owner wallet, so you can recover access by restoring the wallet from its seed phrase.",
	},
	{
		q: "Why Solana instead of Ethereum / L2s?",
		a: "Speed and cost. Agent payments are small and frequent - a research agent might make 50 tx/day. On Solana devnet that's ~$0 in gas; on an L2 it's still non-trivial. Sub-second confirmation also matters when an agent is waiting on a paywall.",
	},
	{
		q: "Can I run my own relayer?",
		a: "Not in v1. The service-wide relayer is a product simplification: your vault's fee_vault pays for gas, and the program's 10k lamport cap prevents relayer abuse. Self-hosted relayers are on the roadmap for teams that need custom signing keys or on-prem deployment.",
	},
];

export function FAQ() {
	const [open, setOpen] = useState<number | null>(null);
	return (
		<Section
			id="faq"
			eyebrow="FAQ"
			title="Questions you'd have if you weren't in a hurry"
		>
			<div className="faq-list">
				{ITEMS.map((item, i) => {
					const isOpen = open === i;
					return (
						<div key={item.q} className={`faq-item${isOpen ? " faq-item-open" : ""}`}>
							<button
								type="button"
								className="faq-question"
								onClick={() => setOpen(isOpen ? null : i)}
								aria-expanded={isOpen}
							>
								<span>{item.q}</span>
								<span className="faq-indicator">{isOpen ? "−" : "+"}</span>
							</button>
							{isOpen && <div className="faq-answer">{item.a}</div>}
						</div>
					);
				})}
			</div>
		</Section>
	);
}
