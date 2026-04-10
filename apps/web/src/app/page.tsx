"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function Home() {
	const { connected } = useWallet();
	const router = useRouter();

	useEffect(() => {
		if (connected) {
			router.push("/dashboard");
		}
	}, [connected, router]);

	return (
		<main className="hero-gradient" style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
			{/* Top bar */}
			<header
				style={{
					padding: "20px 32px",
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
				}}
			>
				<div
					style={{
						fontSize: "1.125rem",
						fontWeight: 600,
						letterSpacing: "-0.02em",
					}}
				>
					<span style={{ color: "var(--accent)" }}>Lobster</span>
					<span>Pay</span>
				</div>
				<WalletMultiButton />
			</header>

			{/* Hero */}
			<div
				style={{
					flex: 1,
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					justifyContent: "center",
					padding: "0 24px",
					textAlign: "center",
					maxWidth: 800,
					margin: "0 auto",
				}}
			>
				<div className="animate-in" style={{ marginBottom: 16 }}>
					<span className="label-mono">Solana Colosseum Hackathon</span>
				</div>

				<h1
					className="text-display animate-in animate-delay-1"
					style={{ marginBottom: 24 }}
				>
					Give agents limits,
					<br />
					<span style={{ color: "var(--accent)" }}>not seed phrases.</span>
				</h1>

				<p
					className="animate-in animate-delay-2"
					style={{
						fontSize: "1.125rem",
						fontWeight: 350,
						letterSpacing: "-0.01em",
						lineHeight: 1.6,
						color: "var(--text-secondary)",
						maxWidth: 560,
						marginBottom: 40,
					}}
				>
					Program-controlled vaults on Solana. Issue API keys with granular
					permissions. AI agents spend within approved limits — your private
					keys never leave your wallet.
				</p>

				<div className="animate-in animate-delay-3" style={{ display: "flex", gap: 12, alignItems: "center" }}>
					<WalletMultiButton />
				</div>

				{/* Feature pills */}
				<div
					className="animate-in animate-delay-4"
					style={{
						display: "flex",
						flexWrap: "wrap",
						gap: 8,
						justifyContent: "center",
						marginTop: 48,
					}}
				>
					{[
						"PDA-Controlled Vaults",
						"Per-TX Limits",
						"Daily Caps",
						"Mint Allowlists",
						"Instant Revocation",
						"x402 Payments",
					].map((feature) => (
						<span
							key={feature}
							style={{
								fontFamily: "var(--font-mono)",
								fontSize: "0.6875rem",
								fontWeight: 500,
								textTransform: "uppercase",
								letterSpacing: "0.06em",
								padding: "6px 14px",
								borderRadius: "var(--radius-pill)",
								background: "rgba(255,255,255,0.08)",
								border: "1px solid rgba(255,255,255,0.12)",
								color: "var(--text-secondary)",
							}}
						>
							{feature}
						</span>
					))}
				</div>
			</div>

			{/* Bottom tagline */}
			<footer
				className="animate-in animate-delay-5"
				style={{
					padding: "24px 32px",
					textAlign: "center",
				}}
			>
				<span className="label-mono">
					Built on Solana &middot; Anchor &middot; Open Source
				</span>
			</footer>
		</main>
	);
}
