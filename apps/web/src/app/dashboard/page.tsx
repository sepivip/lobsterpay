"use client";

import { Nav } from "@/components/nav";
import { useWallet } from "@solana/wallet-adapter-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { useVault } from "@/hooks/useVault";
import { api } from "@/lib/api";
import toast from "react-hot-toast";

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
	const { vault, loading, error, refresh, createVault } = useVault();
	const [recentActivity, setRecentActivity] = useState<any[]>([]);
	const [creating, setCreating] = useState(false);

	useEffect(() => {
		if (!connected) router.push("/");
	}, [connected, router]);

	// Fetch recent activity when vault is available
	useEffect(() => {
		if (vault?.id) {
			api.listActivity(vault.id).then((res) => {
				setRecentActivity(res.items.slice(0, 5));
			}).catch(() => {});
		}
	}, [vault?.id]);

	if (!connected || !publicKey) return null;

	const truncatedKey = `${publicKey.toString().slice(0, 4)}...${publicKey.toString().slice(-4)}`;

	const handleCreateVault = async () => {
		setCreating(true);
		const toastId = toast.loading("Creating vault — please approve the transaction in your wallet...");
		try {
			const signature = await createVault();
			toast.success(
				`Vault created! Tx: ${signature.slice(0, 8)}...${signature.slice(-8)}`,
				{ id: toastId, duration: 6000 }
			);
		} catch (err: any) {
			toast.error(err?.message || error || "Failed to create vault", {
				id: toastId,
			});
		} finally {
			setCreating(false);
		}
	};

	const vaultStatus = vault
		? vault.paused
			? "paused"
			: "active"
		: "none";

	const vaultStatusLabel = vault
		? vault.paused
			? "Paused"
			: "Active"
		: "No vault";

	const vaultPda = vault?.vaultPda
		? `${vault.vaultPda.slice(0, 4)}...${vault.vaultPda.slice(-4)}`
		: null;

	const dailySpent = vault?.policy?.dailySpent ?? 0;
	const dailyLimit = vault?.policy?.dailyLimitUsdc ?? 0;
	const activeKeys = vault?.activeKeyCount ?? 0;

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
						<span className="label-mono">
							{vaultPda ? `Vault ${vaultPda}` : truncatedKey}
						</span>
					</div>
					{!vault && !loading && (
						<button
							className="btn btn-primary"
							onClick={handleCreateVault}
							disabled={creating}
						>
							{creating ? "Creating..." : "Create Vault"}
						</button>
					)}
				</div>

				{loading && (
					<div style={{ textAlign: "center", padding: "48px 0" }}>
						<p style={{ color: "var(--text-ghost)", fontSize: "0.875rem" }}>
							Loading...
						</p>
					</div>
				)}

				{error && !loading && (
					<div className="card" style={{ padding: 24, marginBottom: 24 }}>
						<p style={{ color: "var(--danger)", fontSize: "0.875rem" }}>{error}</p>
					</div>
				)}

				{!loading && (
					<>
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
								value={vaultStatusLabel}
								status={vaultStatus}
								delay={1}
							/>
							<StatCard
								label="USDC Balance"
								value={vault ? (vault.balanceUsdc ?? "0") : "\u2014"}
								suffix="USDC"
								delay={2}
							/>
							<StatCard
								label="Active API Keys"
								value={String(activeKeys)}
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
									{dailySpent} / {dailyLimit} USDC
								</span>
							</div>
							<ProgressBar spent={dailySpent} limit={dailyLimit} />
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
							{recentActivity.length > 0 ? (
								recentActivity.map((item: any, index: number) => (
									<div
										key={item.id}
										style={{
											padding: "12px 24px",
											borderBottom:
												index < recentActivity.length - 1
													? "1px solid var(--border-subtle)"
													: "none",
											display: "flex",
											alignItems: "center",
											justifyContent: "space-between",
										}}
									>
										<span style={{ fontSize: "0.875rem", color: "var(--text-primary)" }}>
											{item.description || item.type}
										</span>
										{item.amount && (
											<span
												style={{
													fontSize: "0.875rem",
													fontFamily: "var(--font-mono)",
													color: "var(--text-tertiary)",
												}}
											>
												{item.amount} {item.mint || "USDC"}
											</span>
										)}
									</div>
								))
							) : (
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
							)}
						</div>
					</>
				)}
			</main>
		</div>
	);
}
