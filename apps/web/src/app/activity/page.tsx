"use client";

import { Nav } from "@/components/nav";

interface MockActivity {
	id: string;
	type: "payment" | "swap" | "x402" | "withdrawal" | "key_created" | "pause_toggled";
	txSignature: string | null;
	amount: string | null;
	mint: string | null;
	status: "confirmed" | "failed" | "pending";
	createdAt: string;
	description: string;
}

const MOCK_ACTIVITY: MockActivity[] = [
	{
		id: "1",
		type: "payment",
		txSignature: "3dnv4ycrJZW1f63qPj3c...QMQJgwkzRXMN",
		amount: "5.00",
		mint: "USDC",
		status: "confirmed",
		createdAt: "2026-04-10 14:32",
		description: "Pay to 7xKX...m4Qp",
	},
	{
		id: "2",
		type: "swap",
		txSignature: "2eFg8hPqRsT7uVwXyZ1a...bCdEfGhIjKlM",
		amount: "10.00",
		mint: "USDC",
		status: "confirmed",
		createdAt: "2026-04-10 13:15",
		description: "Swap USDC → SOL",
	},
	{
		id: "3",
		type: "payment",
		txSignature: null,
		amount: "50.00",
		mint: "USDC",
		status: "failed",
		createdAt: "2026-04-10 12:01",
		description: "Pay to 9mNe...x3Rp — exceeds per-tx limit",
	},
	{
		id: "4",
		type: "key_created",
		txSignature: null,
		amount: null,
		mint: null,
		status: "confirmed",
		createdAt: "2026-04-09 18:45",
		description: "API key created: SeekerClaw Production",
	},
	{
		id: "5",
		type: "pause_toggled",
		txSignature: null,
		amount: null,
		mint: null,
		status: "confirmed",
		createdAt: "2026-04-09 10:22",
		description: "Vault unpaused by owner",
	},
];

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
	return (
		<div style={{ minHeight: "100vh", background: "var(--bg-deep)" }}>
			<Nav />
			<main style={{ maxWidth: 1120, margin: "0 auto", padding: "32px 24px" }}>
				{/* Header */}
				<div className="animate-in" style={{ marginBottom: 32 }}>
					<h2 className="text-heading" style={{ marginBottom: 4 }}>
						Activity
					</h2>
					<span className="label-mono">
						{MOCK_ACTIVITY.length} events
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
					{["All", "Payments", "Swaps", "System"].map((filter, i) => (
						<button
							key={filter}
							className={i === 0 ? "btn btn-secondary btn-sm" : "btn btn-ghost btn-sm"}
						>
							{filter}
						</button>
					))}
				</div>

				{/* Activity list */}
				<div className="card animate-in animate-delay-2" style={{ overflow: "hidden" }}>
					{MOCK_ACTIVITY.map((item, index) => (
						<div
							key={item.id}
							style={{
								display: "flex",
								alignItems: "center",
								gap: 16,
								padding: "16px 24px",
								borderBottom:
									index < MOCK_ACTIVITY.length - 1
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
				</div>
			</main>
		</div>
	);
}
