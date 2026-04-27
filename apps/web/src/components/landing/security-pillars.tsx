import { Section } from "./section";

const PILLARS = [
	{
		title: "On-chain limits",
		body: "Per-tx cap, daily cap, mint allowlist, destination allowlist, and action bitmask live inside the Policy PDA. The Anchor program enforces every rule before a single lamport moves.",
	},
	{
		title: "Agent can't sign",
		body: "Agents never hold a keypair. They hold a scoped HTTP bearer token. Our relayer hot wallet signs txs, but only the authorized_agent set on your policy - and it cannot bypass any of your limits.",
	},
	{
		title: "Revocable in one tap",
		body: "Revoke an API key → every in-flight request is rejected. Emergency-pause the vault → all agent actions stop until you unpause. Policy updates land in a single signed tx.",
	},
	{
		title: "Full audit trail",
		body: "Every action - approved, rejected, on-chain, failed - is logged with its Solana tx signature and reason. The activity feed links straight to explorer.solana.com for independent verification.",
	},
];

export function SecurityPillars() {
	return (
		<Section
			eyebrow="SECURITY"
			title="Why your keys stay home"
			blurb="The vault is a Solana program account, not a wallet file. It has rules written onto it, and the program refuses every transaction that violates them - even if the relayer or our API is compromised."
		>
			<div className="security-grid">
				{PILLARS.map((p) => (
					<div key={p.title} className="security-pillar">
						<h3 className="security-title">{p.title}</h3>
						<p className="security-body">{p.body}</p>
					</div>
				))}
			</div>
		</Section>
	);
}
