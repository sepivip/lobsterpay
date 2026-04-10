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
		<div className={`card stat-card animate-in animate-delay-${delay}`}>
			<div className="label-mono mb-3">{label}</div>
			<div className="flex items-baseline gap-2">
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
				<span className="stat-value">{value}</span>
				{suffix && <span className="stat-suffix">{suffix}</span>}
			</div>
		</div>
	);
}

function ProgressBar({ spent, limit }: { spent: number; limit: number }) {
	const pct = limit > 0 ? Math.min((spent / limit) * 100, 100) : 0;
	return (
		<div className="progress-track">
			<div
				className="progress-fill"
				style={{
					width: `${pct}%`,
					background: pct > 80 ? "var(--warning)" : "var(--accent)",
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
		<div className="page">
			<Nav />
			<main className="page-content">
				{/* Page header */}
				<div className="page-header animate-in">
					<div>
						<h2 className="page-title">Dashboard</h2>
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
					<div className="text-center" style={{ padding: "48px 0" }}>
						<p className="text-ghost text-base">Loading...</p>
					</div>
				)}

				{error && !loading && (
					<div className="card p-5 mb-5">
						<p className="text-danger text-base">{error}</p>
					</div>
				)}

				{!loading && (
					<>
						{/* Stats grid */}
						<div className="grid-stats mb-5">
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
						<div className="card stat-card animate-in animate-delay-4 mb-5">
							<div className="flex items-center justify-between mb-3">
								<span className="label-mono">Daily Spend</span>
								<span className="text-sm text-tertiary font-mono">
									{dailySpent} / {dailyLimit} USDC
								</span>
							</div>
							<ProgressBar spent={dailySpent} limit={dailyLimit} />
						</div>

						{/* Recent activity */}
						<div className="card animate-in animate-delay-5 overflow-hidden">
							<div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
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
										className="card-row px-5"
									>
										<span className="text-base text-primary">
											{item.description || item.type}
										</span>
										{item.amount && (
											<span className="text-base font-mono text-tertiary">
												{item.amount} {item.mint || "USDC"}
											</span>
										)}
									</div>
								))
							) : (
								<div className="text-center" style={{ padding: "48px 24px" }}>
									<p className="text-ghost text-base">
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
