"use client";

import { Nav } from "@/components/nav";
import { useState } from "react";

interface MockKey {
	id: string;
	prefix: string;
	label: string;
	status: "active" | "revoked";
	createdAt: string;
	lastUsedAt: string | null;
}

const MOCK_KEYS: MockKey[] = [
	{
		id: "1",
		prefix: "lp_live_",
		label: "SeekerClaw Production",
		status: "active",
		createdAt: "2026-04-08",
		lastUsedAt: "2026-04-10",
	},
	{
		id: "2",
		prefix: "lp_test_",
		label: "Dev Testing",
		status: "active",
		createdAt: "2026-04-05",
		lastUsedAt: "2026-04-09",
	},
	{
		id: "3",
		prefix: "lp_live_",
		label: "Old Agent Key",
		status: "revoked",
		createdAt: "2026-03-20",
		lastUsedAt: "2026-04-01",
	},
];

export default function KeysPage() {
	const [showCreate, setShowCreate] = useState(false);

	return (
		<div style={{ minHeight: "100vh", background: "var(--bg-deep)" }}>
			<Nav />
			<main style={{ maxWidth: 1120, margin: "0 auto", padding: "32px 24px" }}>
				{/* Header */}
				<div
					className="animate-in"
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						marginBottom: 32,
					}}
				>
					<div>
						<h2 className="text-heading" style={{ marginBottom: 4 }}>
							API Keys
						</h2>
						<span className="label-mono">
							{MOCK_KEYS.filter((k) => k.status === "active").length} active keys
						</span>
					</div>
					<button
						className="btn btn-primary"
						onClick={() => setShowCreate(!showCreate)}
					>
						Create Key
					</button>
				</div>

				{/* Create form (collapsed) */}
				{showCreate && (
					<div
						className="card animate-in"
						style={{ padding: 24, marginBottom: 16 }}
					>
						<div className="label-mono" style={{ marginBottom: 16 }}>
							New API Key
						</div>
						<div
							style={{
								display: "grid",
								gridTemplateColumns: "1fr 1fr",
								gap: 12,
								marginBottom: 16,
							}}
						>
							<div>
								<label
									style={{
										display: "block",
										fontSize: "0.8125rem",
										color: "var(--text-tertiary)",
										marginBottom: 6,
									}}
								>
									Label
								</label>
								<input
									className="input"
									placeholder="e.g. SeekerClaw Production"
								/>
							</div>
							<div>
								<label
									style={{
										display: "block",
										fontSize: "0.8125rem",
										color: "var(--text-tertiary)",
										marginBottom: 6,
									}}
								>
									Expires (optional)
								</label>
								<input className="input" type="date" />
							</div>
						</div>
						<div style={{ display: "flex", gap: 8 }}>
							<button className="btn btn-primary btn-sm">Generate Key</button>
							<button
								className="btn btn-ghost btn-sm"
								onClick={() => setShowCreate(false)}
							>
								Cancel
							</button>
						</div>
					</div>
				)}

				{/* Keys table */}
				<div className="card animate-in animate-delay-1" style={{ overflow: "hidden" }}>
					<table style={{ width: "100%", borderCollapse: "collapse" }}>
						<thead>
							<tr>
								<th className="table-header">Key</th>
								<th className="table-header">Label</th>
								<th className="table-header">Status</th>
								<th className="table-header">Created</th>
								<th className="table-header">Last Used</th>
								<th className="table-header" style={{ textAlign: "right" }}>
									Actions
								</th>
							</tr>
						</thead>
						<tbody>
							{MOCK_KEYS.map((key) => (
								<tr key={key.id} className="table-row">
									<td className="table-cell">
										<code
											style={{
												fontFamily: "var(--font-mono)",
												fontSize: "0.8125rem",
												color: "var(--text-primary)",
												background: "var(--bg-raised)",
												padding: "2px 8px",
												borderRadius: "var(--radius-sm)",
											}}
										>
											{key.prefix}••••••••
										</code>
									</td>
									<td className="table-cell" style={{ color: "var(--text-primary)" }}>
										{key.label}
									</td>
									<td className="table-cell">
										<span
											className={`badge ${
												key.status === "active"
													? "badge-success"
													: "badge-danger"
											}`}
										>
											<span
												className={`status-dot ${
													key.status === "active"
														? "status-dot-active"
														: "status-dot-revoked"
												}`}
											/>
											{key.status}
										</span>
									</td>
									<td className="table-cell">{key.createdAt}</td>
									<td className="table-cell">{key.lastUsedAt || "Never"}</td>
									<td className="table-cell" style={{ textAlign: "right" }}>
										{key.status === "active" && (
											<button className="btn btn-danger btn-sm">Revoke</button>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</main>
		</div>
	);
}
