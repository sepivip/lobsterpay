"use client";

import { Nav } from "@/components/nav";
import { CopyableAddress } from "@/components/copyable-address";
import { DepositFeesModal } from "@/components/deposit-fees-modal";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useVault } from "@/hooks/useVault";
import { api } from "@/lib/api";
import { buildInitializeFeeVaultTx } from "@/lib/solana";
import toast from "react-hot-toast";

function StatCard({
	label,
	value,
	suffix,
	status,
	delay,
	warning,
}: {
	label: string;
	value: string;
	suffix?: string;
	status?: "active" | "paused" | "none";
	delay: number;
	warning?: boolean;
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
				<span
					className="stat-value"
					style={warning ? { color: "var(--warning)" } : undefined}
				>
					{value}
				</span>
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

function formatSol(lamports: bigint | null): string {
	if (lamports === null) return "\u2014";
	// Display up to 4 decimal places
	const sol = Number(lamports) / 1e9;
	return sol.toLocaleString(undefined, {
		minimumFractionDigits: 0,
		maximumFractionDigits: 4,
	});
}

export default function DashboardPage() {
	const { connected, publicKey, sendTransaction } = useWallet();
	const { connection } = useConnection();
	const router = useRouter();
	const {
		vault,
		loading,
		error,
		feeBalance,
		feeBalanceLow,
		feeVaultInitialized,
		tokenBalances,
		refresh,
		refreshFeeBalance,
		createVault,
	} = useVault();
	const [recentActivity, setRecentActivity] = useState<any[]>([]);
	const [creating, setCreating] = useState(false);
	const [initializingFeeVault, setInitializingFeeVault] = useState(false);
	const [depositOpen, setDepositOpen] = useState(false);

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

	const handleInitializeFeeVault = async () => {
		if (!publicKey || !sendTransaction) return;
		setInitializingFeeVault(true);
		const toastId = toast.loading(
			"Initializing fee vault — please approve the transaction..."
		);
		try {
			const { transaction } = await buildInitializeFeeVaultTx(
				publicKey,
				connection
			);
			const signature = await sendTransaction(transaction, connection);
			await connection.confirmTransaction(signature, "confirmed");
			await refreshFeeBalance();
			toast.success(
				`Fee vault initialized! Tx: ${signature.slice(0, 8)}...`,
				{ id: toastId, duration: 5000 }
			);
		} catch (err: any) {
			const rejected =
				err?.message?.includes("User rejected") ||
				err?.message?.includes("rejected the request");
			if (rejected) {
				toast.dismiss(toastId);
				toast("Transaction rejected");
			} else {
				toast.error(err?.message || "Failed to initialize fee vault", {
					id: toastId,
				});
			}
		} finally {
			setInitializingFeeVault(false);
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

	const vaultPdaFull = vault?.vault_pda || vault?.vaultPda || null;
	const vaultPda = vaultPdaFull
		? `${vaultPdaFull.slice(0, 4)}...${vaultPdaFull.slice(-4)}`
		: null;

	const dailySpent = vault?.policy?.dailySpent ?? 0;
	const dailyLimit = vault?.policy?.dailyLimitUsdc ?? 0;

	const feeBalanceValue = feeVaultInitialized
		? formatSol(feeBalance)
		: "\u2014";

	// Resolve on-chain token balances for display
	const KNOWN_MINTS: Record<string, string> = {
		"4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU": "USDC",
		"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": "USDC",
	};
	const primaryBalance = tokenBalances.find((t) => KNOWN_MINTS[t.mint] === "USDC");
	const primaryBalanceDisplay = primaryBalance
		? primaryBalance.uiAmount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })
		: "0";

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
						{/* Fee vault init prompt */}
						{vault && !feeVaultInitialized && (
							<div
								className="card p-5 mb-5 animate-in"
								style={{
									borderColor: "var(--warning)",
									background:
										"color-mix(in srgb, var(--warning) 8%, var(--bg-raised))",
								}}
							>
								<div className="flex items-center justify-between gap-4 flex-wrap">
									<div>
										<div
											className="text-md text-primary"
											style={{ fontWeight: 500, marginBottom: 4 }}
										>
											Initialize Fee Vault
										</div>
										<div className="text-sm text-tertiary">
											One-time setup. Your agent uses the fee vault to pay
											Solana network fees for on-chain actions.
										</div>
									</div>
									<button
										className="btn btn-primary btn-sm"
										onClick={handleInitializeFeeVault}
										disabled={initializingFeeVault}
									>
										{initializingFeeVault
											? "Signing..."
											: "Initialize Fee Vault"}
									</button>
								</div>
							</div>
						)}

						{/* Low fee balance warning */}
						{vault && feeVaultInitialized && feeBalanceLow && (
							<div
								className="card p-5 mb-5 animate-in"
								style={{
									borderColor: "var(--warning)",
									background:
										"color-mix(in srgb, var(--warning) 8%, var(--bg-raised))",
								}}
							>
								<div className="flex items-center justify-between gap-4 flex-wrap">
									<div>
										<div
											className="text-md text-primary"
											style={{ fontWeight: 500, marginBottom: 4 }}
										>
											Fee balance low
										</div>
										<div className="text-sm text-tertiary">
											Your fee vault has less than 0.01 SOL. Agent transactions
											may fail.
										</div>
									</div>
									<button
										className="btn btn-primary btn-sm"
										onClick={() => setDepositOpen(true)}
									>
										Top Up
									</button>
								</div>
							</div>
						)}

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
								value={vault ? primaryBalanceDisplay : "\u2014"}
								suffix="USDC"
								delay={2}
							/>
							<StatCard
								label="Fee Balance"
								value={feeBalanceValue}
								suffix="SOL"
								delay={3}
								warning={feeVaultInitialized && feeBalanceLow}
							/>
						</div>

						{/* Fee vault actions */}
						{vault && feeVaultInitialized && (
							<div className="flex justify-end mb-5 animate-in animate-delay-3">
								<button
									className="btn btn-secondary btn-sm"
									onClick={() => setDepositOpen(true)}
								>
									Deposit Fees
								</button>
							</div>
						)}

						{/* Vault addresses */}
						{vault && vaultPdaFull && (
							<div className="card animate-in animate-delay-3 mb-5" style={{ padding: "20px 24px" }}>
								<div className="label-mono" style={{ marginBottom: 8 }}>Vault Addresses</div>
								<CopyableAddress
									label="Vault PDA"
									address={vaultPdaFull}
								/>
								{(vault.fee_vault_pda || vault.feeVaultPda) && (
									<CopyableAddress
										label="Fee Vault"
										address={vault.fee_vault_pda || vault.feeVaultPda}
									/>
								)}
								{vault.policy_pda || vault.policyPda ? (
									<CopyableAddress
										label="Policy"
										address={vault.policy_pda || vault.policyPda}
									/>
								) : null}
								{tokenBalances.length > 0 && (
									<>
										<div className="label-mono" style={{ marginTop: 16, marginBottom: 8 }}>Token Balances</div>
										{tokenBalances.map((tb) => (
											<div
												key={tb.mint}
												className="flex items-center justify-between"
												style={{ padding: "8px 0", borderBottom: "1px solid var(--border-subtle)" }}
											>
												<div style={{ minWidth: 0 }}>
													<span className="text-sm text-primary" style={{ fontWeight: 500 }}>
														{KNOWN_MINTS[tb.mint] || `${tb.mint.slice(0, 4)}...${tb.mint.slice(-4)}`}
													</span>
													{!KNOWN_MINTS[tb.mint] && (
														<span className="text-sm text-ghost" style={{ marginLeft: 8, fontFamily: "var(--font-mono)" }}>
															{tb.mint.slice(0, 8)}...
														</span>
													)}
												</div>
												<span className="text-sm text-primary" style={{ fontFamily: "var(--font-mono)", fontWeight: 500 }}>
													{tb.uiAmount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: tb.decimals })}
												</span>
											</div>
										))}
									</>
								)}
								<div className="text-sm text-tertiary" style={{ marginTop: 12, lineHeight: 1.6 }}>
									To fund the vault, send SPL tokens (e.g. USDC) to the vault&apos;s
									Associated Token Account. Open the Vault PDA in Explorer to find token accounts,
									or transfer directly using the vault PDA as the owner address.
								</div>
							</div>
						)}

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
								recentActivity.map((item: any) => (
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

			<DepositFeesModal
				open={depositOpen}
				onClose={() => setDepositOpen(false)}
				onSuccess={async () => {
					await refreshFeeBalance();
					await refresh();
				}}
			/>
		</div>
	);
}
