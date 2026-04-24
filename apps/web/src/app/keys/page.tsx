"use client";

import { Nav } from "@/components/nav";
import { RequireWallet } from "@/components/require-wallet";
import { EmptyState } from "@/components/empty-state";
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
		<div className="page">
			<Nav />
			<RequireWallet>
			<main className="page-content">
				{/* Raw key reveal modal */}
				{newRawKey && (
					<div
						className="modal-overlay"
						onClick={() => setNewRawKey(null)}
					>
						<div
							className="card modal-content"
							onClick={(e) => e.stopPropagation()}
						>
							<div className="label-mono mb-3 text-warning">
								Save This Key Now
							</div>
							<p className="text-base text-tertiary mb-4">
								This is the only time you will see this key. Copy it and store it securely.
							</p>
							<code className="code-inline mb-4" style={{ display: "block", wordBreak: "break-all", padding: "12px 16px" }}>
								{newRawKey}
							</code>
							<div className="flex gap-2 justify-end">
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
				<div className="page-header animate-in">
					<div>
						<h2 className="page-title">API Keys</h2>
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
					<div className="card p-5 animate-in mb-4">
						<div className="label-mono mb-4">New API Key</div>
						<div className="grid-2col mb-4" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
							<div>
								<label className="form-label">Label</label>
								<input
									className="input"
									placeholder="e.g. SeekerClaw Production"
									value={label}
									onChange={(e) => setLabel(e.target.value)}
								/>
							</div>
							<div>
								<label className="form-label">Expires (optional)</label>
								<input
									className="input input-date"
									type="date"
									value={expiresAt}
									onChange={(e) => setExpiresAt(e.target.value)}
									// Native <input type="date"> only opens its picker when the user
									// clicks the calendar icon at the right edge - clicks on the
									// "mm/dd/yyyy" placeholder text do nothing. showPicker() (Chrome
									// 99+, Firefox 101+, Safari 16+) opens the picker on any click
									// inside the input. Optional chain for older browser fallback.
									onClick={(e) => e.currentTarget.showPicker?.()}
								/>
							</div>
						</div>
						<div className="flex gap-2">
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
				<div className="card animate-in animate-delay-1 overflow-hidden">
					{loading ? (
						<div className="text-center" style={{ padding: "48px 24px" }}>
							<p className="text-ghost text-base">Loading...</p>
						</div>
					) : keys.length === 0 ? (
						<div className="p-4">
							{!vault ? (
								<EmptyState
									icon="🔐"
									title="No vault yet"
									description="Create a vault first, then issue API keys for your AI agents."
									action="create-vault"
								/>
							) : (
								<EmptyState
									icon="🔑"
									title="No API keys"
									description="Create an API key to let agents interact with your vault. Keys can be scoped with custom limits."
									action={{ label: "Create Key", onClick: () => setShowCreate(true) }}
								/>
							)}
						</div>
					) : (
						<table className="w-full" style={{ borderCollapse: "collapse" }}>
							<thead>
								<tr>
									<th className="table-header">Key</th>
									<th className="table-header">Label</th>
									<th className="table-header">Status</th>
									<th className="table-header">Created</th>
									<th className="table-header">Last Used</th>
									<th className="table-header text-right">Actions</th>
								</tr>
							</thead>
							<tbody>
								{keys.map((key) => (
									<tr key={key.id} className="table-row">
										<td className="table-cell">
											<code className="code-inline">
												{key.prefix || key.keyPrefix || "lp_"}••••••••
											</code>
										</td>
										<td className="table-cell text-primary">{key.label}</td>
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
										<td className="table-cell text-right">
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
			</RequireWallet>
		</div>
	);
}
