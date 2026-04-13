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
	swap: "SWAP",
	x402: "X402",
	withdrawal: "WITHDRAW",
	key_created: "KEY",
	pause_toggled: "SYSTEM",
};

function TypeBadge({ type }: { type: string }) {
	return (
		<span
			className="type-badge"
		>
			{TYPE_LABELS[type] || type}
		</span>
	);
}

export default function ActivityPage() {
	const { vault } = useVault();
	const [activity, setActivity] = useState<any[]>([]);
	const [loading, setLoading] = useState(true);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [filter, setFilter] = useState("All");

	const fetchActivity = useCallback(async (cursor?: string) => {
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
	}, [vault?.id]);

	useEffect(() => {
		fetchActivity();
	}, [fetchActivity]);

	const filteredActivity = activity.filter((item) => {
		if (filter === "All") return true;
		if (filter === "Payments") return item.type === "payment";
		if (filter === "Swaps") return item.type === "swap";
		if (filter === "System") return ["key_created", "pause_toggled"].includes(item.type);
		return true;
	});

	return (
		<div className="page">
			<Nav />
			<RequireWallet>
			<main className="page-content">
				{/* Header */}
				<div className="animate-in mb-6">
					<h2 className="page-title">Activity</h2>
					<span className="label-mono">
						{activity.length} event{activity.length !== 1 ? "s" : ""}
					</span>
				</div>

				{/* Filters */}
				<div className="animate-in animate-delay-1 flex gap-2 mb-4">
					{["All", "Payments", "Swaps", "System"].map((f) => (
						<button
							key={f}
							className={filter === f ? "btn btn-secondary btn-sm" : "btn btn-ghost btn-sm"}
							onClick={() => setFilter(f)}
						>
							{f}
						</button>
					))}
				</div>

				{/* Activity list */}
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
							{filteredActivity.map((item) => (
								<div key={item.id} className="activity-row">
									{/* Type */}
									<TypeBadge type={item.type} />

									{/* Description */}
									<div className="flex-1 min-w-0">
										<div className="text-base text-primary" style={{ letterSpacing: "-0.01em" }}>
											{item.description}
										</div>
										{item.txSignature && (
											<div className="font-mono text-ghost" style={{ fontSize: "0.75rem", marginTop: 2 }}>
												{item.txSignature}
											</div>
										)}
									</div>

									{/* Amount */}
									{item.amount && (
										<div className="text-right whitespace-nowrap">
											<div
												className="text-base font-mono text-primary"
												style={{ fontWeight: 500, letterSpacing: "-0.02em" }}
											>
												{item.amount}{" "}
												<span className="text-tertiary" style={{ fontWeight: 400 }}>
													{item.mint}
												</span>
											</div>
											{item.payload?.service_fee != null && (
												<div
													className="font-mono text-ghost"
													style={{ fontSize: "0.7rem", marginTop: 2 }}
												>
													net {item.payload.net_amount ?? "—"}
													{item.payload.net_amount != null ? " " : ""}
													· fee {item.payload.service_fee} {item.mint}
												</div>
											)}
										</div>
									)}

									{/* Status — only for tx-backed events */}
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

									{/* Time */}
									<div className="text-ghost whitespace-nowrap text-right" style={{ fontSize: "0.75rem", minWidth: 100 }}>
										{item.createdAt}
									</div>
								</div>
							))}
							{nextCursor && (
								<div className="text-center" style={{ padding: "16px 24px" }}>
									<button
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
