"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

const navItems = [
	{ href: "/dashboard", label: "Dashboard" },
	{ href: "/keys", label: "Keys" },
	{ href: "/policy", label: "Policy" },
	{ href: "/activity", label: "Activity" },
];

export function Nav() {
	const pathname = usePathname();

	return (
		<nav
			style={{
				borderBottom: "1px solid var(--border-subtle)",
				background: "rgba(5, 5, 7, 0.8)",
				backdropFilter: "blur(12px)",
				WebkitBackdropFilter: "blur(12px)",
				position: "sticky",
				top: 0,
				zIndex: 50,
			}}
		>
			<div
				style={{
					maxWidth: 1120,
					margin: "0 auto",
					padding: "0 16px",
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					height: 56,
					gap: 12,
				}}
			>
				{/* Logo */}
				<Link
					href="/dashboard"
					style={{
						fontSize: "1.125rem",
						fontWeight: 600,
						letterSpacing: "-0.02em",
						textDecoration: "none",
						color: "var(--text-primary)",
						flexShrink: 0,
					}}
				>
					<span style={{ color: "var(--accent)" }}>L</span>Pay
				</Link>

				{/* Tab bar — scrollable on mobile */}
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 2,
						background: "var(--bg-raised)",
						borderRadius: "var(--radius-pill)",
						padding: 3,
						overflowX: "auto",
						flexShrink: 1,
						minWidth: 0,
					}}
				>
					{navItems.map((item) => {
						const isActive = pathname === item.href;
						return (
							<Link
								key={item.href}
								href={item.href}
								style={{
									fontSize: "0.8125rem",
									fontWeight: isActive ? 500 : 400,
									letterSpacing: "-0.02em",
									textDecoration: "none",
									color: isActive ? "var(--text-primary)" : "var(--text-tertiary)",
									padding: "6px 14px",
									borderRadius: "var(--radius-pill)",
									background: isActive ? "var(--bg-card)" : "transparent",
									boxShadow: isActive ? "inset 0 0 0 1px var(--border-default)" : "none",
									transition: "all 0.15s ease",
									whiteSpace: "nowrap",
									flexShrink: 0,
								}}
							>
								{item.label}
							</Link>
						);
					})}
				</div>

				{/* Right side */}
				<div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
					<div
						className="label-mono"
						style={{
							display: "flex",
							alignItems: "center",
							gap: 5,
						}}
					>
						<span className="status-dot status-dot-active" />
						<span style={{ display: "none" }} className="devnet-label">Devnet</span>
					</div>
					<WalletMultiButton />
				</div>
			</div>

			{/* Show "Devnet" text only on larger screens */}
			<style>{`
				@media (min-width: 640px) {
					.devnet-label { display: inline !important; }
				}
			`}</style>
		</nav>
	);
}
