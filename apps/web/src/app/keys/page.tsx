"use client";

import { Nav } from "@/components/nav";
import { useState, useEffect, useCallback } from "react";
import { useVault } from "@/hooks/useVault";
import { api } from "@/lib/api";
import toast from "react-hot-toast";

export default function KeysPage() {
	const { vault } = useVault();
	const [showCreate, setShowCreate] = useState(false);
	const [keys, setKeys] = useState<any[]>([]);
	const [loading, setLoading] = useState(true);
	const [label, setLabel] = useState("");
	const [expiresAt, setExpiresAt] = useState("");
	const [creating, setCreating] = useState(false);
	const [newRawKey, setNewRawKey] = useState<string | null>(null);

	const fetchKeys = useCallback(async () => {
		if (!vault?.id) {
			setKeys([]);
			setLoading(false);
			return;
		}
		setLoading(true);
		try {
			const res = await api.listApiKeys(vault.id);
			setKeys(res.items);
		} catch {
			toast.error("Failed to load API keys");
		} finally {
			setLoading(false);
		}
	}, [vault?.id]);

	useEffect(() => {
		fetchKeys();
	}, [fetchKeys]);

	const handleCreate = async () => {
		if (!vault?.id || !label.trim()) {
			toast.error("Please enter a label");
			return;
		}
		setCreating(true);
		try {
			const data: { label: string; expiresAt?: string } = { label: label.trim() };
			if (expiresAt) data.expiresAt = new Date(expiresAt).toISOString();
			const result = await api.createApiKey(vault.id, data);
			setNewRawKey(result.rawKey || result.key || null);
			toast.success("API key created");
			setLabel("");
			setExpiresAt("");
			setShowCreate(false);
			await fetchKeys();
		} catch (err: any) {
			toast.error(err.message || "Failed to create key");
		} finally {
			setCreating(false);
		}
	};

	const handleRevoke = async (keyId: string) => {
		if (!vault?.id) return;
		try {
			await api.revokeApiKey(vault.id, keyId);
			toast.success("Key revoked");
			await fetchKeys();
		} catch (err: any) {
			toast.error(err.message || "Failed to revoke key");
		}
	};

	const activeCount = keys.filter((k) => k.status === "active").length;

	return (
		<div style={{ minHeight: "100vh", background: "var(--bg-deep)" }}>
			<Nav />
			<main style={{ maxWidth: 1120, margin: "0 auto", padding: "32px 24px" }}>
				{/* Raw key reveal modal */}
				{newRawKey && (
					<div
						style={{
							position: "fixed",
							inset: 0,
							background: "rgba(0,0,0,0.6)",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							zIndex: 100,
						}}
						onClick={() => setNewRawKey(null)}
					>
						<div
							className="card"
							style={{ padding: 32, maxWidth: 560, width: "100%" }}
							onClick={(e) => e.stopPropagation()}
						>
							<div className="label-mono" style={{ marginBottom: 12, color: "var(--warning)" }}>
								Save This Key Now
							</div>
							<p style={{ fontSize: "0.875rem", color: "var(--text-tertiary)", marginBottom: 16 }}>
								This is the only time you will see this key. Copy it and store it securely.
							</p>
							<code
								style={{
									display: "block",
									fontFamily: "var(--font-mono)",
									fontSize: "0.8125rem",
									background: "var(--bg-raised)",
									padding: "12px 16px",
									borderRadius: "var(--radius-sm)",
									wordBreak: "break-all",
									marginBottom: 16,
									color: "var(--text-primary)",
								}}
							>
								{newRawKey}
							</code>
							<div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
								<button
									className="btn btn-secondary btn-sm"
									onClick={() => {
										navigator.clipboard.writeText(newRawKey);
										toast.success("Copied to clipboard");
									}}
								>
									Copy
								</button>
								<button
									className="btn btn-primary btn-sm"
									onClick={() => setNewRawKey(null)}
								>
									Done
								</button>
							</div>
						</div>
					</div>
				)}

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
							{activeCount} active key{activeCount !== 1 ? "s" : ""}
						</span>
					</div>
					<button
						className="btn btn-primary"
						onClick={() => setShowCreate(!showCreate)}
						disabled={!vault}
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
									value={label}
									onChange={(e) => setLabel(e.target.value)}
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
								<input
									className="input"
									type="date"
									value={expiresAt}
									onChange={(e) => setExpiresAt(e.target.value)}
								/>
							</div>
						</div>
						<div style={{ display: "flex", gap: 8 }}>
							<button
								className="btn btn-primary btn-sm"
								onClick={handleCreate}
								disabled={creating}
							>
								{creating ? "Generating..." : "Generate Key"}
							</button>
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
					{loading ? (
						<div style={{ padding: "48px 24px", textAlign: "center" }}>
							<p style={{ color: "var(--text-ghost)", fontSize: "0.875rem" }}>
								Loading...
							</p>
						</div>
					) : keys.length === 0 ? (
						<div style={{ padding: "48px 24px", textAlign: "center" }}>
							<p style={{ color: "var(--text-ghost)", fontSize: "0.875rem" }}>
								{vault ? "No API keys yet. Create one to get started." : "Connect wallet and create a vault first."}
							</p>
						</div>
					) : (
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
								{keys.map((key) => (
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
												{key.prefix || key.keyPrefix || "lp_"}••••••••
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
										<td className="table-cell">
											{key.createdAt ? new Date(key.createdAt).toLocaleDateString() : "\u2014"}
										</td>
										<td className="table-cell">
											{key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : "Never"}
										</td>
										<td className="table-cell" style={{ textAlign: "right" }}>
											{key.status === "active" && (
												<button
													className="btn btn-danger btn-sm"
													onClick={() => handleRevoke(key.id)}
												>
													Revoke
												</button>
											)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
				</div>
			</main>
		</div>
	);
}
