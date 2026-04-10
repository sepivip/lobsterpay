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
	const colors: Record<string, string> = {
		payment: "var(--accent)",
		swap: "#7c5cfc",
		x402: "#ffa502",
		withdrawal: "var(--text-tertiary)",
		key_created: "var(--success)",
		pause_toggled: "var(--warning)",
	};
	const color = colors[type] || "var(--text-tertiary)";
	return (
		<span
			style={{
				fontFamily: "var(--font-mono)",
				fontSize: "0.625rem",
				fontWeight: 500,
				textTransform: "uppercase",
				letterSpacing: "0.08em",
				padding: "3px 8px",
				borderRadius: "var(--radius-pill)",
				background: `${color}18`,
				color: color,
				border: `1px solid ${color}30`,
			}}
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
		<div style={{ minHeight: "100vh", background: "var(--bg-deep)" }}>
			<Nav />
			<RequireWallet>
			<main style={{ maxWidth: 1120, margin: "0 auto", padding: "32px 24px" }}>
				{/* Header */}
				<div className="animate-in" style={{ marginBottom: 32 }}>
					<h2 className="text-heading" style={{ marginBottom: 4 }}>
						Activity
					</h2>
					<span className="label-mono">
						{activity.length} event{activity.length !== 1 ? "s" : ""}
					</span>
				</div>

				{/* Filters */}
				<div
					className="animate-in animate-delay-1"
					style={{
						display: "flex",
						gap: 6,
						marginBottom: 16,
					}}
				>
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
				<div className="card animate-in animate-delay-2" style={{ overflow: "hidden" }}>
					{loading && activity.length === 0 ? (
						<div style={{ padding: "48px 24px", textAlign: "center" }}>
							<p style={{ color: "var(--text-ghost)", fontSize: "0.875rem" }}>
								Loading...
							</p>
						</div>
					) : filteredActivity.length === 0 ? (
						<div style={{ padding: "48px 24px", textAlign: "center" }}>
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
							{filteredActivity.map((item, index) => (
								<div
									key={item.id}
									style={{
										display: "flex",
										alignItems: "center",
										gap: 16,
										padding: "16px 24px",
										borderBottom:
											index < filteredActivity.length - 1
												? "1px solid var(--border-subtle)"
												: "none",
										transition: "background 0.1s ease",
									}}
									onMouseEnter={(e) =>
										(e.currentTarget.style.background = "var(--bg-raised)")
									}
									onMouseLeave={(e) =>
										(e.currentTarget.style.background = "transparent")
									}
								>
									{/* Type */}
									<TypeBadge type={item.type} />

									{/* Description */}
									<div style={{ flex: 1, minWidth: 0 }}>
										<div
											style={{
												fontSize: "0.875rem",
												color: "var(--text-primary)",
												letterSpacing: "-0.01em",
											}}
										>
											{item.description}
										</div>
										{item.txSignature && (
											<div
												style={{
													fontSize: "0.75rem",
													fontFamily: "var(--font-mono)",
													color: "var(--text-ghost)",
													marginTop: 2,
												}}
											>
												{item.txSignature}
											</div>
										)}
									</div>

									{/* Amount */}
									{item.amount && (
										<div
											style={{
												fontSize: "0.875rem",
												fontFamily: "var(--font-mono)",
												fontWeight: 500,
												color: "var(--text-primary)",
												letterSpacing: "-0.02em",
												textAlign: "right",
												whiteSpace: "nowrap",
											}}
										>
											{item.amount}{" "}
											<span style={{ color: "var(--text-tertiary)", fontWeight: 400 }}>
												{item.mint}
											</span>
										</div>
									)}

									{/* Status */}
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

									{/* Time */}
									<div
										style={{
											fontSize: "0.75rem",
											color: "var(--text-ghost)",
											whiteSpace: "nowrap",
											minWidth: 100,
											textAlign: "right",
										}}
									>
										{item.createdAt}
									</div>
								</div>
							))}
							{nextCursor && (
								<div style={{ padding: "16px 24px", textAlign: "center" }}>
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
