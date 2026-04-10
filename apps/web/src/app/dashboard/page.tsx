"use client";

import { Nav } from "@/components/nav";
import { useWallet } from "@solana/wallet-adapter-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

function StatCard({
	label,
	value,
	suffix,
	status,
	delay,
}: {
	label: string;
	value: string;
	suffix?: string;
	status?: "active" | "paused" | "none";
	delay: number;
}) {
	return (
		<div
			className={`card animate-in animate-delay-${delay}`}
			style={{ padding: "20px 24px" }}
		>
			<div className="label-mono" style={{ marginBottom: 12 }}>
				{label}
			</div>
			<div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
				{status && (
					<span
						className={`status-dot ${
							status === "active"
								? "status-dot-active"
								: status === "paused"
									? "status-dot-paused"
									: ""
						}`}
						style={{ alignSelf: "center" }}
					/>
				)}
				<span
					style={{
						fontSize: "1.75rem",
						fontWeight: 400,
						letterSpacing: "-0.03em",
						lineHeight: 1,
					}}
				>
					{value}
				</span>
				{suffix && (
					<span
						style={{
							fontSize: "0.875rem",
							color: "var(--text-tertiary)",
							fontWeight: 400,
						}}
					>
						{suffix}
					</span>
				)}
			</div>
		</div>
	);
}

function ProgressBar({ spent, limit }: { spent: number; limit: number }) {
	const pct = limit > 0 ? Math.min((spent / limit) * 100, 100) : 0;
	return (
		<div
			style={{
				width: "100%",
				height: 4,
				background: "var(--border-subtle)",
				borderRadius: 2,
				overflow: "hidden",
			}}
		>
			<div
				style={{
					width: `${pct}%`,
					height: "100%",
					background: pct > 80 ? "var(--warning)" : "var(--accent)",
					borderRadius: 2,
					transition: "width 0.3s ease",
				}}
			/>
		</div>
	);
}

export default function DashboardPage() {
	const { connected, publicKey } = useWallet();
	const router = useRouter();

	useEffect(() => {
		if (!connected) router.push("/");
	}, [connected, router]);

	if (!connected || !publicKey) return null;

	const truncatedKey = `${publicKey.toString().slice(0, 4)}...${publicKey.toString().slice(-4)}`;

	return (
		<div style={{ minHeight: "100vh", background: "var(--bg-deep)" }}>
			<Nav />
			<main style={{ maxWidth: 1120, margin: "0 auto", padding: "32px 24px" }}>
				{/* Page header */}
				<div
					className="animate-in"
					style={{
						display: "flex",
						alignItems: "baseline",
						justifyContent: "space-between",
						marginBottom: 32,
					}}
				>
					<div>
						<h2 className="text-heading" style={{ marginBottom: 4 }}>
							Dashboard
						</h2>
						<span className="label-mono">{truncatedKey}</span>
					</div>
					<button className="btn btn-primary">Create Vault</button>
				</div>

				{/* Stats grid */}
				<div
					style={{
						display: "grid",
						gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
						gap: 12,
						marginBottom: 24,
					}}
				>
					<StatCard
						label="Vault Status"
						value="No vault"
						status="none"
						delay={1}
					/>
					<StatCard
						label="USDC Balance"
						value="—"
						suffix="USDC"
						delay={2}
					/>
					<StatCard
						label="Active API Keys"
						value="0"
						suffix="keys"
						delay={3}
					/>
				</div>

				{/* Daily spend */}
				<div
					className="card animate-in animate-delay-4"
					style={{ padding: "20px 24px", marginBottom: 24 }}
				>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							marginBottom: 12,
						}}
					>
						<span className="label-mono">Daily Spend</span>
						<span
							style={{
								fontSize: "0.8125rem",
								color: "var(--text-tertiary)",
								fontFamily: "var(--font-mono)",
							}}
						>
							0 / 0 USDC
						</span>
					</div>
					<ProgressBar spent={0} limit={0} />
				</div>

				{/* Recent activity */}
				<div className="card animate-in animate-delay-5" style={{ overflow: "hidden" }}>
					<div
						style={{
							padding: "16px 24px",
							borderBottom: "1px solid var(--border-subtle)",
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
						}}
					>
						<span className="label-mono">Recent Activity</span>
						<button
							className="btn btn-ghost btn-sm"
							onClick={() => router.push("/activity")}
						>
							View All
						</button>
					</div>
					<div
						style={{
							padding: "48px 24px",
							textAlign: "center",
						}}
					>
						<p style={{ color: "var(--text-ghost)", fontSize: "0.875rem" }}>
							No activity yet. Payments and swaps will appear here.
						</p>
					</div>
				</div>
			</main>
		</div>
	);
}
