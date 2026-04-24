"use client";

import { Nav } from "@/components/nav";
import { RequireWallet } from "@/components/require-wallet";
import { EmptyState } from "@/components/empty-state";
import { useState, useEffect, useCallback } from "react";
import { useVault } from "@/hooks/useVault";
import { api } from "@/lib/api";
import toast from "react-hot-toast";

const TYPE_LABELS: Record<string, string> = {
	payment: "PAY",
	payment_failed: "PAY FAIL",
	swap: "SWAP",
	x402: "X402",
	x402_facilitator: "X402 FACILITATOR",
	x402_facilitator_confirmed: "X402 CONFIRMED",
	x402_facilitator_expired: "X402 EXPIRED",
	x402_siwx: "X402 SIWX",
	x402_siwx_signed: "X402 SIWX SIGNED",
	withdrawal: "WITHDRAW",
	key_created: "KEY +",
	key_revoked: "KEY −",
	pause_toggled: "PAUSE",
	policy_update: "POLICY",
	vault_created: "VAULT",
	fee_vault_initialize_intent: "FEE INIT",
	fee_vault_deposit_intent: "FEE +",
	fee_vault_withdraw_intent: "FEE −",
};

interface ActivityItem {
	id: string;
	type: string;
	title: string;
	description?: string;
	metaLines?: string[];
	amount?: string | null;
	mint?: string | null;
	txSignature?: string | null;
	explorerUrl?: string | null;
	status?: string | null;
	createdAt: string;
	payload?: Record<string, unknown>;
}

function TypeBadge({ type }: { type: string }) {
	return (
		<span className="type-badge">
			{TYPE_LABELS[type] ?? type.toUpperCase()}
		</span>
	);
}

function formatTime(iso: string): string {
	try {
		const d = new Date(iso);
		const diffMs = Date.now() - d.getTime();
		const diffSec = Math.floor(diffMs / 1000);
		if (diffSec < 60) return `${diffSec}s ago`;
		const diffMin = Math.floor(diffSec / 60);
		if (diffMin < 60) return `${diffMin}m ago`;
		const diffHr = Math.floor(diffMin / 60);
		if (diffHr < 24) return `${diffHr}h ago`;
		return d.toLocaleString(undefined, {
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		});
	} catch {
		return iso;
	}
}

export default function ActivityPage() {
	const { vault } = useVault();
	const [activity, setActivity] = useState<ActivityItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [filter, setFilter] = useState("All");
	const [expanded, setExpanded] = useState<string | null>(null);

	const fetchActivity = useCallback(
		async (cursor?: string) => {
			if (!vault?.id) {
				setActivity([]);
				setLoading(false);
				return;
			}
			setLoading(true);
			try {
				const res = await api.listActivity(vault.id, cursor);
				if (cursor) {
					setActivity((prev) => [...prev, ...res.items]);
				} else {
					setActivity(res.items);
				}
				setNextCursor(res.nextCursor);
			} catch {
				toast.error("Failed to load activity");
			} finally {
				setLoading(false);
			}
		},
		[vault?.id],
	);

	useEffect(() => {
		fetchActivity();
	}, [fetchActivity]);

	const filteredActivity = activity.filter((item) => {
		if (filter === "All") return true;
		if (filter === "Payments") return item.type === "payment" || item.type === "payment_failed";
		if (filter === "Swaps") return item.type === "swap";
		if (filter === "System") {
			return [
				"key_created",
				"key_revoked",
				"policy_update",
				"vault_created",
				"fee_vault_initialize_intent",
				"fee_vault_deposit_intent",
				"fee_vault_withdraw_intent",
			].includes(item.type);
		}
		return true;
	});

	return (
		<div className="page">
			<Nav />
			<RequireWallet>
				<main className="page-content">
					<div className="animate-in mb-6">
						<h2 className="page-title">Activity</h2>
						<span className="label-mono">
							{activity.length} event{activity.length !== 1 ? "s" : ""}
						</span>
					</div>

					<div className="animate-in animate-delay-1 flex gap-2 mb-4">
						{["All", "Payments", "Swaps", "System"].map((f) => (
							<button
								type="button"
								key={f}
								className={filter === f ? "btn btn-secondary btn-sm" : "btn btn-ghost btn-sm"}
								onClick={() => setFilter(f)}
							>
								{f}
							</button>
						))}
					</div>

					<div className="card animate-in animate-delay-2 overflow-hidden">
						{loading && activity.length === 0 ? (
							<div className="text-center" style={{ padding: "48px 24px" }}>
								<p className="text-ghost text-base">Loading...</p>
							</div>
						) : filteredActivity.length === 0 ? (
							<div style={{ padding: "48px 24px" }} className="text-center">
								{!vault ? (
									<EmptyState
										icon="📊"
										title="No vault yet"
										description="Create a vault to start tracking payments, swaps, and agent activity."
										action="create-vault"
									/>
								) : (
									<EmptyState
										icon="📋"
										title="No activity yet"
										description="Payments, swaps, and policy changes will appear here as agents use your vault."
									/>
								)}
							</div>
						) : (
							<>
								{filteredActivity.map((item) => {
									const isOpen = expanded === item.id;
									const hasDetails = (item.metaLines && item.metaLines.length > 0) || item.payload;
									return (
										<div key={item.id} className="activity-row activity-row-v2">
											<div className="activity-head">
												<TypeBadge type={item.type} />

												<div className="activity-main">
													<div className="activity-title">
														{item.title ?? item.description ?? item.type}
													</div>
													{item.metaLines && item.metaLines.length > 0 && (
														<div className="activity-meta">
															{item.metaLines.map((line, i) => (
																<span key={i} className="activity-meta-line">
																	{line}
																</span>
															))}
														</div>
													)}
													{item.txSignature && (
														<div className="activity-tx">
															<a
																href={item.explorerUrl ?? "#"}
																target="_blank"
																rel="noopener noreferrer"
																className="activity-tx-link"
															>
																tx {item.txSignature.slice(0, 8)}…{item.txSignature.slice(-8)} ↗
															</a>
														</div>
													)}
												</div>

												{item.amount && (
													<div className="activity-amount">
														<span className="activity-amount-value">{item.amount}</span>
														<span className="activity-amount-mint">{item.mint}</span>
													</div>
												)}

												{item.status && (
													<span
														className={`badge ${
															item.status === "confirmed"
																? "badge-success"
																: item.status === "failed"
																	? "badge-danger"
																	: "badge-warning"
														}`}
													>
														{item.status}
													</span>
												)}

												<div className="activity-time">{formatTime(item.createdAt)}</div>

												{hasDetails && (
													<button
														type="button"
														className="activity-expand"
														onClick={() => setExpanded(isOpen ? null : item.id)}
														aria-label={isOpen ? "Collapse" : "Expand"}
													>
														{isOpen ? "−" : "+"}
													</button>
												)}
											</div>

											{isOpen && item.payload && (
												<pre className="activity-payload">
													{JSON.stringify(item.payload, null, 2)}
												</pre>
											)}
										</div>
									);
								})}
								{nextCursor && (
									<div className="text-center" style={{ padding: "16px 24px" }}>
										<button
											type="button"
											className="btn btn-ghost btn-sm"
											onClick={() => fetchActivity(nextCursor)}
											disabled={loading}
										>
											{loading ? "Loading..." : "Load More"}
										</button>
									</div>
								)}
							</>
						)}
					</div>
				</main>
			</RequireWallet>
		</div>
	);
}
