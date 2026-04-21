"use client";

import { Nav } from "@/components/nav";
import { RequireWallet } from "@/components/require-wallet";
import { EmptyState } from "@/components/empty-state";
import { useState, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useVault } from "@/hooks/useVault";
import { api } from "@/lib/api";
import {
	buildUpdatePolicyTx,
	buildUpdateAuthorizedAgentTx,
	buildEmergencyPauseTx,
	deriveVaultPda,
	derivePolicyPda,
	readPolicyOnChain,
} from "@/lib/solana";
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
		<label className="card-row cursor-pointer">
			<div>
				<div className="text-md text-primary" style={{ fontWeight: 500, letterSpacing: "-0.01em", marginBottom: 2 }}>
					{label}
				</div>
				<div className="text-sm text-tertiary">{description}</div>
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
			<div className="flex items-baseline justify-between mb-2" style={{ marginBottom: 6 }}>
				<label className="form-label" style={{ marginBottom: 0 }}>{label}</label>
				{mono && <span className="label-mono">{mono}</span>}
			</div>
			<div style={{ position: "relative" }}>
				<input
					className="input"
					placeholder={placeholder}
					value={value}
					onChange={(e) => onChange(e.target.value)}
				/>
				{suffix && <span className="input-suffix">{suffix}</span>}
			</div>
		</div>
	);
}

export default function PolicyPage() {
	const { vault, refresh } = useVault();
	const { publicKey, sendTransaction } = useWallet();
	const { connection } = useConnection();
	const [saving, setSaving] = useState(false);
	const [pausing, setPausing] = useState(false);

	// Form state
	const [allowPay, setAllowPay] = useState(true);
	const [allowSwap, setAllowSwap] = useState(true);
	const [allowX402, setAllowX402] = useState(false);
	const [maxPerTx, setMaxPerTx] = useState("");
	const [dailyLimit, setDailyLimit] = useState("");
	const [maxSlippage, setMaxSlippage] = useState("");
	const [allowedMints, setAllowedMints] = useState("");
	const [allowedDestinations, setAllowedDestinations] = useState("");
	const [authorizedAgent, setAuthorizedAgent] = useState("");
	const [showAdvanced, setShowAdvanced] = useState(false);
	// True once we've successfully read the Policy account on-chain. Lets the
	// save handler distinguish "user cleared the textarea intentionally" (send
	// empty array = revoke all) from "we don't know what's on-chain" (send
	// undefined = don't change).
	const [onChainLoaded, setOnChainLoaded] = useState(false);

	// Populate from vault policy (scalar fields come from DB cache)
	useEffect(() => {
		if (vault?.policy) {
			const p = vault.policy;
			setAllowPay(p.allowPay ?? true);
			setAllowSwap(p.allowSwap ?? true);
			setAllowX402(p.allowX402 ?? false);
			setMaxPerTx(p.maxPerTxUsdc != null ? String(p.maxPerTxUsdc) : "");
			setDailyLimit(p.dailyLimitUsdc != null ? String(p.dailyLimitUsdc) : "");
			setMaxSlippage(p.maxSlippageBps != null ? String(p.maxSlippageBps) : "");
			setAuthorizedAgent(p.authorizedAgent ?? "");
		}
	}, [vault?.policy]);

	// Allowlists live ONLY on-chain (not cached in DB). Fetch them directly
	// from the Policy account so users can see and revoke current entries.
	// Also refreshes current paused state + authorized_agent from chain so the
	// page reflects reality even if the DB cache is stale.
	useEffect(() => {
		if (!publicKey || !vault?.vault_pda) return;
		let cancelled = false;
		(async () => {
			try {
				const [, ] = deriveVaultPda(publicKey); // ensure deps tracked
				const [policyPda] = derivePolicyPda(new PublicKey(vault.vault_pda));
				const onChain = await readPolicyOnChain(connection, policyPda);
				if (!onChain || cancelled) return;
				setAllowedMints(onChain.allowedMints.map((k) => k.toBase58()).join("\n"));
				setAllowedDestinations(onChain.allowedDestinations.map((k) => k.toBase58()).join("\n"));
				// Also override authorized_agent from chain (source of truth)
				setAuthorizedAgent(onChain.authorizedAgent.toBase58());
				setOnChainLoaded(true);
			} catch (err) {
				console.warn("Failed to read on-chain policy:", err);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [publicKey, vault?.vault_pda, connection]);

	const handleSave = async () => {
		if (!vault?.id || !publicKey || !sendTransaction) {
			toast.error("No vault found or wallet not connected");
			return;
		}
		setSaving(true);
		const toastId = toast.loading("Saving policy — please approve the transaction...");
		try {
			const mintsArr = allowedMints.split("\n").map((s) => s.trim()).filter(Boolean);
			const destsArr = allowedDestinations.split("\n").map((s) => s.trim()).filter(Boolean);

			// Compute allowed_actions bitmask: bit 0 = pay, bit 1 = swap, bit 2 = x402
			const allowedActions =
				(allowPay ? 1 : 0) | (allowSwap ? 2 : 0) | (allowX402 ? 4 : 0);

			const [vaultPda] = deriveVaultPda(publicKey);
			const [policyPda] = derivePolicyPda(vaultPda);

			// Allowlist sends: if we've loaded on-chain state, always send the
			// textarea's current contents (Some([...]), even when empty — so users
			// can revoke). If we never loaded, fall back to the old "undefined = no
			// change" semantics so we don't accidentally nuke an allowlist we
			// never read.
			const mintsParam = onChainLoaded
				? mintsArr.map((m) => new PublicKey(m))
				: mintsArr.length > 0
					? mintsArr.map((m) => new PublicKey(m))
					: undefined;
			const destsParam = onChainLoaded
				? destsArr.map((d) => new PublicKey(d))
				: destsArr.length > 0
					? destsArr.map((d) => new PublicKey(d))
					: undefined;

			// Build and sign onchain transaction
			const { transaction } = await buildUpdatePolicyTx(
				publicKey,
				vaultPda,
				policyPda,
				connection,
				{
					allowedActions,
					maxPerTxAmountAtomic: maxPerTx ? BigInt(maxPerTx) : undefined,
					dailyLimitAmountAtomic: dailyLimit ? BigInt(dailyLimit) : undefined,
					maxSlippageBps: maxSlippage ? Number(maxSlippage) : undefined,
					allowedMints: mintsParam,
					allowedDestinations: destsParam,
				}
			);

			const signature = await sendTransaction(transaction, connection);
			await connection.confirmTransaction(signature, "confirmed");

			// If authorized_agent changed, submit a separate update_authorized_agent tx.
			const currentAgent = vault.policy?.authorizedAgent ?? "";
			const trimmedAgent = authorizedAgent.trim();
			let agentUpdated = false;
			if (trimmedAgent && trimmedAgent !== currentAgent) {
				toast.loading("Updating authorized agent — please approve...", {
					id: toastId,
				});
				let agentPubkey: PublicKey;
				try {
					agentPubkey = new PublicKey(trimmedAgent);
				} catch {
					throw new Error("Invalid authorized agent pubkey");
				}
				const { transaction: agentTx } = await buildUpdateAuthorizedAgentTx(
					publicKey,
					agentPubkey,
					connection
				);
				const agentSig = await sendTransaction(agentTx, connection);
				await connection.confirmTransaction(agentSig, "confirmed");
				agentUpdated = true;
			}

			// Sync to backend DB
			await api.updatePolicy(vault.id, {
				allowPay,
				allowSwap,
				allowX402,
				maxPerTxUsdc: maxPerTx ? Number(maxPerTx) : undefined,
				dailyLimitUsdc: dailyLimit ? Number(dailyLimit) : undefined,
				maxSlippageBps: maxSlippage ? Number(maxSlippage) : undefined,
				allowedMints: mintsArr.length > 0 ? mintsArr : undefined,
				allowedDestinations: destsArr.length > 0 ? destsArr : undefined,
				authorizedAgent: agentUpdated ? trimmedAgent : undefined,
			});

			toast.success(
				`Policy saved! Tx: ${signature.slice(0, 8)}...`,
				{ id: toastId, duration: 5000 }
			);
			await refresh();
		} catch (err: any) {
			const msg =
				err?.message?.includes("User rejected") ||
				err?.message?.includes("rejected the request")
					? "Transaction rejected by user"
					: err?.message || "Failed to save policy";
			toast.error(msg, { id: toastId });
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
			setAuthorizedAgent(p.authorizedAgent ?? "");
		}
		toast("Reset to saved values");
	};

	const handlePauseToggle = async () => {
		if (!vault?.id || !publicKey || !sendTransaction) return;
		setPausing(true);
		const action = vault.paused ? "Unpausing" : "Pausing";
		const toastId = toast.loading(`${action} vault — please approve the transaction...`);
		try {
			const [vaultPda] = deriveVaultPda(publicKey);
			const [policyPda] = derivePolicyPda(vaultPda);

			let transaction;
			if (!vault.paused) {
				// Pause: use emergency_pause instruction
				({ transaction } = await buildEmergencyPauseTx(
					publicKey,
					vaultPda,
					policyPda,
					connection
				));
			} else {
				// Unpause: use update_policy with paused=false
				({ transaction } = await buildUpdatePolicyTx(
					publicKey,
					vaultPda,
					policyPda,
					connection,
					{ paused: false }
				));
			}

			const signature = await sendTransaction(transaction, connection);
			await connection.confirmTransaction(signature, "confirmed");

			// Sync to backend DB
			await api.updatePolicy(vault.id, { paused: !vault.paused });

			toast.success(vault.paused ? "Vault unpaused" : "Vault paused", {
				id: toastId,
			});
			await refresh();
		} catch (err: any) {
			const msg =
				err?.message?.includes("User rejected") ||
				err?.message?.includes("rejected the request")
					? "Transaction rejected by user"
					: err?.message || "Failed to toggle pause";
			toast.error(msg, { id: toastId });
		} finally {
			setPausing(false);
		}
	};

	return (
		<div className="page">
			<Nav />
			<RequireWallet>
			<main className="page-content">
				{/* Header */}
				<div className="animate-in mb-6">
					<h2 className="page-title">Vault Policy</h2>
					<span className="label-mono">
						Onchain + offchain enforcement rules
					</span>
				</div>

				{!vault ? (
					<EmptyState
						icon="⚙️"
						title="No vault yet"
						description="Create a vault to configure spending policies, limits, and allowlists for your agents."
						action="create-vault"
					/>
				) : (
					<>
						<div className="grid-2col">
							{/* Left column */}
							<div className="flex flex-col gap-4">
								{/* Allowed actions */}
								<div className="card animate-in animate-delay-1" style={{ padding: "8px 24px" }}>
									<div className="label-mono card-section-header">
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
								<div className="card p-5 animate-in animate-delay-3">
									<div className="label-mono mb-4">Emergency Controls</div>
									<div className="flex items-center justify-between">
										<div>
											<div className="text-md text-primary" style={{ fontWeight: 500 }}>
												{vault.paused ? "Unpause Vault" : "Pause Vault"}
											</div>
											<div className="text-sm text-tertiary">
												{vault.paused
													? "Resume all agent actions"
													: "Immediately block all agent actions"}
											</div>
										</div>
										<button
											className={vault.paused ? "btn btn-primary btn-sm" : "btn btn-danger btn-sm"}
											onClick={handlePauseToggle}
											disabled={pausing}
										>
											{pausing
												? "Signing..."
												: vault.paused
													? "Unpause"
													: "Pause"}
										</button>
									</div>
								</div>
							</div>

							{/* Right column */}
							<div className="flex flex-col gap-4">
								{/* Limits */}
								<div className="card p-5 animate-in animate-delay-2">
									<div className="label-mono mb-5" style={{ marginBottom: 20 }}>
										Spending Limits
									</div>
									<div className="flex flex-col gap-4">
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
								<div className="card p-5 animate-in animate-delay-4">
									<div className="flex items-baseline justify-between mb-5" style={{ marginBottom: 20 }}>
										<div className="label-mono">Allowlists</div>
										<span className="text-sm text-tertiary">
											{onChainLoaded ? "live from on-chain" : "loading on-chain…"}
										</span>
									</div>
									<div className="flex flex-col gap-4">
										<div>
											<label className="form-label">
												Allowed Mints (one per line, max 8 — empty = allow all)
											</label>
											<textarea
												className="input"
												rows={3}
												placeholder="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
												style={{ resize: "vertical", fontFamily: "var(--font-mono)", fontSize: "0.8125rem" }}
												value={allowedMints}
												onChange={(e) => setAllowedMints(e.target.value)}
											/>
											<div className="text-sm text-tertiary" style={{ marginTop: 6 }}>
												Delete a line and save to revoke that mint. Clear the whole field to allow all mints again.
											</div>
										</div>
										<div>
											<label className="form-label">
												Allowed Destinations (one per line, max 8 — empty = allow all)
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

								{/* Advanced */}
								<div className="card p-5 animate-in animate-delay-5">
									<button
										type="button"
										className="flex items-center justify-between w-full"
										onClick={() => setShowAdvanced((v) => !v)}
										style={{
											background: "transparent",
											border: "none",
											padding: 0,
											cursor: "pointer",
											color: "inherit",
										}}
									>
										<span className="label-mono">Advanced</span>
										<span className="text-tertiary text-sm">
											{showAdvanced ? "Hide" : "Show"}
										</span>
									</button>
									{showAdvanced && (
										<div className="flex flex-col gap-4" style={{ marginTop: 20 }}>
											<div>
												<label className="form-label">
													Authorized Agent Pubkey
												</label>
												<input
													className="input"
													style={{
														fontFamily: "var(--font-mono)",
														fontSize: "0.8125rem",
													}}
													placeholder={publicKey?.toString() ?? "Owner pubkey (disables delegation)"}
													value={authorizedAgent}
													onChange={(e) => setAuthorizedAgent(e.target.value)}
												/>
												<div
													className="text-sm text-tertiary"
													style={{ marginTop: 6 }}
												>
													Delegated signer allowed to submit payments and swaps
													on behalf of the owner. Defaults to the owner&rsquo;s
													own pubkey, which disables delegation. Updating this
													requires a separate transaction.
												</div>
											</div>
										</div>
									)}
								</div>
							</div>
						</div>

						{/* Save bar */}
						<div className="animate-in animate-delay-5 flex justify-end gap-2 mt-5">
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
			</RequireWallet>
		</div>
	);
}
