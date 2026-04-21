"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import Image from "next/image";
import Link from "next/link";

export default function Home() {
	const { connected } = useWallet();

	return (
		<main className="hero-gradient flex flex-col" style={{ minHeight: "100vh" }}>
			{/* Top bar — logo always links home; wallet button always present so
				users can disconnect or switch wallets. */}
			<header className="flex items-center justify-between" style={{ padding: "20px 32px" }}>
				<Link href="/" aria-label="LobsterPay home" style={{ display: "inline-flex", alignItems: "center" }}>
					<Image
						src="/logo-wordmark.svg"
						alt="LobsterPay"
						width={1187}
						height={214}
						priority
						style={{ height: 28, width: "auto" }}
					/>
				</Link>
				<div className="flex items-center gap-3">
					{connected && (
						<Link href="/dashboard" className="btn btn-primary">
							Open Dashboard
						</Link>
					)}
					<WalletMultiButton />
				</div>
			</header>

			{/* Hero */}
			<div className="landing-hero">
				<div className="animate-in hero-symbol">
					<Image
						src="/logo.svg"
						alt="LobsterPay"
						width={201}
						height={214}
						priority
					/>
				</div>

				<div className="animate-in mb-4">
					<span className="label-mono">KEYS STAY HOME. AGENTS GO OUT.</span>
				</div>

				<h1 className="text-display animate-in animate-delay-1 mb-5">
					Give agents limits,
					<br />
					<span className="text-accent">not seed phrases.</span>
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

				<div className="animate-in animate-delay-3 flex gap-3 items-center">
					{connected ? (
						<Link href="/dashboard" className="btn btn-primary">
							Open Dashboard
						</Link>
					) : (
						<WalletMultiButton />
					)}
				</div>

				{/* Feature pills */}
				<div className="animate-in animate-delay-4 flex flex-wrap gap-2 justify-center mt-5" style={{ marginTop: 48 }}>
					{[
						"PDA-Controlled Vaults",
						"Per-TX Limits",
						"Daily Caps",
						"Mint Allowlists",
						"Instant Revocation",
						"x402 Payments",
					].map((feature) => (
						<span key={feature} className="feature-pill">
							{feature}
						</span>
					))}
				</div>
			</div>

			{/* Bottom tagline */}
			<footer className="animate-in animate-delay-5 text-center" style={{ padding: "24px 32px" }}>
				<span className="label-mono">
					Built on Solana &middot; Anchor &middot; Open Source
				</span>
			</footer>
		</main>
	);
}
