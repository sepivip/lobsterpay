"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

const navItems = [
	{ href: "/dashboard", label: "Dashboard" },
	{ href: "/keys", label: "API Keys" },
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
					padding: "0 24px",
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					height: 56,
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: 28 }}>
					<Link
						href="/dashboard"
						style={{
							fontSize: "1.125rem",
							fontWeight: 600,
							letterSpacing: "-0.02em",
							textDecoration: "none",
							color: "var(--text-primary)",
							display: "flex",
							alignItems: "center",
							gap: 0,
						}}
					>
						<span style={{ color: "var(--accent)" }}>Lobster</span>
						<span>Pay</span>
					</Link>

					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: 2,
							background: "var(--bg-raised)",
							borderRadius: "var(--radius-pill)",
							padding: 3,
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
										padding: "6px 16px",
										borderRadius: "var(--radius-pill)",
										background: isActive ? "var(--bg-card)" : "transparent",
										boxShadow: isActive ? "inset 0 0 0 1px var(--border-default)" : "none",
										transition: "all 0.15s ease",
									}}
								>
									{item.label}
								</Link>
							);
						})}
					</div>
				</div>

				<div style={{ display: "flex", alignItems: "center", gap: 16 }}>
					<div className="label-mono" style={{ display: "flex", alignItems: "center", gap: 6 }}>
						<span className="status-dot status-dot-active" />
						Devnet
					</div>
					<WalletMultiButton />
				</div>
			</div>
		</nav>
	);
}
