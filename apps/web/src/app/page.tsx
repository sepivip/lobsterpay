"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import Image from "next/image";
import Link from "next/link";
import { HeroVisual } from "@/components/landing/hero-visual";
import { HowItWorks } from "@/components/landing/how-it-works";
import { TerminalDemo } from "@/components/landing/terminal-demo";
import { WorksWith } from "@/components/landing/works-with";
import { UseCases } from "@/components/landing/use-cases";
import { SecurityPillars } from "@/components/landing/security-pillars";
import { DevQuickstart } from "@/components/landing/dev-quickstart";
import { Pricing } from "@/components/landing/pricing";
import { FAQ } from "@/components/landing/faq";
import { SiteFooter } from "@/components/landing/site-footer";

export default function Home() {
	const { connected } = useWallet();

	return (
		<main className="hero-gradient flex flex-col" style={{ minHeight: "100vh" }}>
			{/* Top bar - logo always links home; wallet button always present so
				users can disconnect or switch wallets. */}
			<header className="landing-topbar">
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
				<nav className="landing-topbar-nav">
					<a href="#how-it-works" className="landing-topbar-link">How it works</a>
					<a href="#quickstart" className="landing-topbar-link">Quickstart</a>
					<a href="#faq" className="landing-topbar-link">FAQ</a>
				</nav>
				<div className="flex items-center gap-3">
					{connected && (
						<Link href="/dashboard" className="btn btn-primary btn-sm">
							Open Dashboard
						</Link>
					)}
					<WalletMultiButton />
				</div>
			</header>

			{/* Hero - 2-column on desktop: copy on the left, animated lobster
				on the right. Stacks vertically below 1024px. */}
			<div className="landing-hero landing-hero-split">
				<div className="landing-hero-content">
					<div className="animate-in mb-4">
						<span className="label-mono">KEYS STAY HOME. AGENTS GO OUT.</span>
					</div>

					<h1 className="text-display animate-in animate-delay-1 mb-5">
						Give agents limits,
						<br />
						<span className="text-accent">not seed phrases.</span>
					</h1>

					<p className="animate-in animate-delay-2 hero-sub">
						A permissioned payment layer for AI agents on Solana. Issue API keys
						scoped to a program-controlled vault - agents pay for services,
						x402-gated APIs, and swaps, without ever holding a private key.
					</p>

					<div className="landing-hero-cta-row animate-in animate-delay-3 flex gap-3 items-center">
						{connected ? (
							<Link href="/dashboard" className="btn btn-primary">
								Open Dashboard
							</Link>
						) : (
							<WalletMultiButton />
						)}
						<a href="#quickstart" className="btn btn-secondary">
							View Quickstart
						</a>
					</div>

					{/* Feature pills - 3 × 2 grid so every row has equal weight. */}
					<div className="animate-in animate-delay-4 feature-pill-grid feature-pill-grid-left">
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

				<div className="landing-hero-visual animate-in animate-delay-1">
					{/* respectReducedMotion=false - the spin IS the brand
						visual, not decorative motion; we'd rather everyone
						see it than respect a system setting that would hide
						our hero's centerpiece. */}
					<HeroVisual
						mode="galaxy"
						opacity={0.95}
						cellPx={9}
						rotationSpeed={1.4}
						respectReducedMotion={false}
					/>
				</div>
			</div>

			{/* Live terminal demo - shows what an agent call actually looks like */}
			<section className="landing-section landing-section-flush">
				<div className="landing-section-inner">
					<div className="landing-section-head">
						<span className="label-mono">LIVE · DEVNET</span>
						<h2 className="landing-section-title">
							A real agent call, live on devnet
						</h2>
						<p className="landing-section-blurb">
							Every LobsterPay endpoint returns JSON. Agents use Bearer auth, the server
							enforces your policy, and the response tells them exactly what happened -
							on-chain signature, net amount, service fee.
						</p>
					</div>
					<TerminalDemo />
				</div>
			</section>

			<HowItWorks />
			<WorksWith />
			<UseCases />
			<SecurityPillars />
			<DevQuickstart />
			<Pricing />
			<FAQ />

			<SiteFooter />
		</main>
	);
}
