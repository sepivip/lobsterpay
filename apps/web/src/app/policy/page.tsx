"use client";

import { Nav } from "@/components/nav";
import { useState, useEffect } from "react";
import { useVault } from "@/hooks/useVault";
import { api } from "@/lib/api";
import toast from "react-hot-toast";

function ToggleRow({
	label,
	description,
	checked,
	onChange,
}: {
	label: string;
	description: string;
	checked: boolean;
	onChange: (val: boolean) => void;
}) {
	return (
		<label
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				padding: "14px 0",
				borderBottom: "1px solid var(--border-subtle)",
				cursor: "pointer",
			}}
		>
			<div>
				<div
					style={{
						fontSize: "0.9375rem",
						fontWeight: 500,
						letterSpacing: "-0.01em",
						color: "var(--text-primary)",
						marginBottom: 2,
					}}
				>
					{label}
				</div>
				<div
					style={{
						fontSize: "0.8125rem",
						color: "var(--text-tertiary)",
					}}
				>
					{description}
				</div>
			</div>
			<input
				type="checkbox"
				className="toggle"
				checked={checked}
				onChange={(e) => onChange(e.target.checked)}
			/>
		</label>
	);
}

function FieldRow({
	label,
	mono,
	placeholder,
	suffix,
	value,
	onChange,
}: {
	label: string;
	mono?: string;
	placeholder: string;
	suffix?: string;
	value: string;
	onChange: (val: string) => void;
}) {
	return (
		<div>
			<div
				style={{
					display: "flex",
					alignItems: "baseline",
					justifyContent: "space-between",
					marginBottom: 6,
				}}
			>
				<label
					style={{
						fontSize: "0.8125rem",
						color: "var(--text-tertiary)",
					}}
				>
					{label}
				</label>
				{mono && <span className="label-mono">{mono}</span>}
			</div>
			<div style={{ position: "relative" }}>
				<input
					className="input"
					placeholder={placeholder}
					value={value}
					onChange={(e) => onChange(e.target.value)}
				/>
				{suffix && (
					<span
						style={{
							position: "absolute",
							right: 14,
							top: "50%",
							transform: "translateY(-50%)",
							fontSize: "0.8125rem",
							color: "var(--text-ghost)",
							fontFamily: "var(--font-mono)",
						}}
					>
						{suffix}
					</span>
				)}
			</div>
		</div>
	);
}

export default function PolicyPage() {
	const { vault, refresh } = useVault();
	const [saving, setSaving] = useState(false);

	// Form state
	const [allowPay, setAllowPay] = useState(true);
	const [allowSwap, setAllowSwap] = useState(true);
	const [allowX402, setAllowX402] = useState(false);
	const [maxPerTx, setMaxPerTx] = useState("");
	const [dailyLimit, setDailyLimit] = useState("");
	const [maxSlippage, setMaxSlippage] = useState("");
	const [allowedMints, setAllowedMints] = useState("");
	const [allowedDestinations, setAllowedDestinations] = useState("");

	// Populate from vault policy
	useEffect(() => {
		if (vault?.policy) {
			const p = vault.policy;
			setAllowPay(p.allowPay ?? true);
			setAllowSwap(p.allowSwap ?? true);
			setAllowX402(p.allowX402 ?? false);
			setMaxPerTx(p.maxPerTxUsdc != null ? String(p.maxPerTxUsdc) : "");
			setDailyLimit(p.dailyLimitUsdc != null ? String(p.dailyLimitUsdc) : "");
			setMaxSlippage(p.maxSlippageBps != null ? String(p.maxSlippageBps) : "");
			setAllowedMints(Array.isArray(p.allowedMints) ? p.allowedMints.join("\n") : "");
			setAllowedDestinations(Array.isArray(p.allowedDestinations) ? p.allowedDestinations.join("\n") : "");
		}
	}, [vault?.policy]);

	const handleSave = async () => {
		if (!vault?.id) {
			toast.error("No vault found");
			return;
		}
		setSaving(true);
		try {
			const mintsArr = allowedMints.split("\n").map((s) => s.trim()).filter(Boolean);
			const destsArr = allowedDestinations.split("\n").map((s) => s.trim()).filter(Boolean);

			await api.updatePolicy(vault.id, {
				allowPay,
				allowSwap,
				allowX402,
				maxPerTxUsdc: maxPerTx ? Number(maxPerTx) : undefined,
				dailyLimitUsdc: dailyLimit ? Number(dailyLimit) : undefined,
				maxSlippageBps: maxSlippage ? Number(maxSlippage) : undefined,
				allowedMints: mintsArr.length > 0 ? mintsArr : undefined,
				allowedDestinations: destsArr.length > 0 ? destsArr : undefined,
			});
			toast.success("Policy saved");
			await refresh();
		} catch (err: any) {
			toast.error(err.message || "Failed to save policy");
		} finally {
			setSaving(false);
		}
	};

	const handleReset = () => {
		if (vault?.policy) {
			const p = vault.policy;
			setAllowPay(p.allowPay ?? true);
			setAllowSwap(p.allowSwap ?? true);
			setAllowX402(p.allowX402 ?? false);
			setMaxPerTx(p.maxPerTxUsdc != null ? String(p.maxPerTxUsdc) : "");
			setDailyLimit(p.dailyLimitUsdc != null ? String(p.dailyLimitUsdc) : "");
			setMaxSlippage(p.maxSlippageBps != null ? String(p.maxSlippageBps) : "");
			setAllowedMints(Array.isArray(p.allowedMints) ? p.allowedMints.join("\n") : "");
			setAllowedDestinations(Array.isArray(p.allowedDestinations) ? p.allowedDestinations.join("\n") : "");
		}
		toast("Reset to saved values");
	};

	const handlePauseToggle = async () => {
		if (!vault?.id) return;
		try {
			await api.updatePolicy(vault.id, { paused: !vault.paused });
			toast.success(vault.paused ? "Vault unpaused" : "Vault paused");
			await refresh();
		} catch (err: any) {
			toast.error(err.message || "Failed to toggle pause");
		}
	};

	return (
		<div style={{ minHeight: "100vh", background: "var(--bg-deep)" }}>
			<Nav />
			<main style={{ maxWidth: 1120, margin: "0 auto", padding: "32px 24px" }}>
				{/* Header */}
				<div className="animate-in" style={{ marginBottom: 32 }}>
					<h2 className="text-heading" style={{ marginBottom: 4 }}>
						Vault Policy
					</h2>
					<span className="label-mono">
						Onchain + offchain enforcement rules
					</span>
				</div>

				{!vault ? (
					<div className="card" style={{ padding: "48px 24px", textAlign: "center" }}>
						<p style={{ color: "var(--text-ghost)", fontSize: "0.875rem" }}>
							Connect wallet and create a vault first.
						</p>
					</div>
				) : (
					<>
						<div
							style={{
								display: "grid",
								gridTemplateColumns: "1fr 1fr",
								gap: 16,
								alignItems: "start",
							}}
						>
							{/* Left column */}
							<div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
								{/* Allowed actions */}
								<div className="card animate-in animate-delay-1" style={{ padding: "8px 24px" }}>
									<div className="label-mono" style={{ padding: "14px 0", borderBottom: "1px solid var(--border-subtle)" }}>
										Allowed Actions
									</div>
									<ToggleRow
										label="Direct Pay"
										description="Transfer tokens to approved destinations"
										checked={allowPay}
										onChange={setAllowPay}
									/>
									<ToggleRow
										label="Swap"
										description="Execute token swaps via approved DEX"
										checked={allowSwap}
										onChange={setAllowSwap}
									/>
									<ToggleRow
										label="x402 Exact"
										description="Pay 402-gated endpoints"
										checked={allowX402}
										onChange={setAllowX402}
									/>
								</div>

								{/* Emergency */}
								<div className="card animate-in animate-delay-3" style={{ padding: 24 }}>
									<div className="label-mono" style={{ marginBottom: 16 }}>
										Emergency Controls
									</div>
									<div
										style={{
											display: "flex",
											alignItems: "center",
											justifyContent: "space-between",
										}}
									>
										<div>
											<div style={{ fontSize: "0.9375rem", fontWeight: 500, color: "var(--text-primary)" }}>
												{vault.paused ? "Unpause Vault" : "Pause Vault"}
											</div>
											<div style={{ fontSize: "0.8125rem", color: "var(--text-tertiary)" }}>
												{vault.paused
													? "Resume all agent actions"
													: "Immediately block all agent actions"}
											</div>
										</div>
										<button
											className={vault.paused ? "btn btn-primary btn-sm" : "btn btn-danger btn-sm"}
											onClick={handlePauseToggle}
										>
											{vault.paused ? "Unpause" : "Pause"}
										</button>
									</div>
								</div>
							</div>

							{/* Right column */}
							<div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
								{/* Limits */}
								<div className="card animate-in animate-delay-2" style={{ padding: 24 }}>
									<div className="label-mono" style={{ marginBottom: 20 }}>
										Spending Limits
									</div>
									<div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
										<FieldRow
											label="Max Per Transaction"
											mono="Atomic Units"
											placeholder="1000000"
											suffix="USDC"
											value={maxPerTx}
											onChange={setMaxPerTx}
										/>
										<FieldRow
											label="Daily Limit"
											mono="Atomic Units"
											placeholder="10000000"
											suffix="USDC"
											value={dailyLimit}
											onChange={setDailyLimit}
										/>
										<FieldRow
											label="Max Slippage"
											placeholder="100"
											suffix="BPS"
											value={maxSlippage}
											onChange={setMaxSlippage}
										/>
									</div>
								</div>

								{/* Allowlists */}
								<div className="card animate-in animate-delay-4" style={{ padding: 24 }}>
									<div className="label-mono" style={{ marginBottom: 20 }}>
										Allowlists
									</div>
									<div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
										<div>
											<label
												style={{
													display: "block",
													fontSize: "0.8125rem",
													color: "var(--text-tertiary)",
													marginBottom: 6,
												}}
											>
												Allowed Mints (one per line, max 8)
											</label>
											<textarea
												className="input"
												rows={3}
												placeholder="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
												style={{ resize: "vertical", fontFamily: "var(--font-mono)", fontSize: "0.8125rem" }}
												value={allowedMints}
												onChange={(e) => setAllowedMints(e.target.value)}
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
												Allowed Destinations (one per line, max 8)
											</label>
											<textarea
												className="input"
												rows={3}
												placeholder="Destination wallet addresses..."
												style={{ resize: "vertical", fontFamily: "var(--font-mono)", fontSize: "0.8125rem" }}
												value={allowedDestinations}
												onChange={(e) => setAllowedDestinations(e.target.value)}
											/>
										</div>
									</div>
								</div>
							</div>
						</div>

						{/* Save bar */}
						<div
							className="animate-in animate-delay-5"
							style={{
								marginTop: 24,
								display: "flex",
								justifyContent: "flex-end",
								gap: 8,
							}}
						>
							<button className="btn btn-ghost" onClick={handleReset}>
								Reset
							</button>
							<button
								className="btn btn-primary"
								onClick={handleSave}
								disabled={saving}
							>
								{saving ? "Saving..." : "Save Policy"}
							</button>
						</div>
					</>
				)}
			</main>
		</div>
	);
}
