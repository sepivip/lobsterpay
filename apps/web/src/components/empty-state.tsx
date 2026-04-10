"use client";

import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useRouter } from "next/navigation";

export function EmptyState({
	icon,
	title,
	description,
	action,
}: {
	icon: string;
	title: string;
	description: string;
	action?: "connect" | "create-vault" | { label: string; onClick: () => void };
}) {
	const router = useRouter();

	return (
		<div
			className="card"
			style={{
				padding: "64px 32px",
				textAlign: "center",
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				gap: 16,
			}}
		>
			<div
				style={{
					fontSize: "2rem",
					lineHeight: 1,
					opacity: 0.5,
					marginBottom: 4,
				}}
			>
				{icon}
			</div>
			<div
				style={{
					fontSize: "1rem",
					fontWeight: 500,
					letterSpacing: "-0.01em",
					color: "var(--text-primary)",
				}}
			>
				{title}
			</div>
			<div
				style={{
					fontSize: "0.875rem",
					color: "var(--text-tertiary)",
					maxWidth: 360,
					lineHeight: 1.5,
				}}
			>
				{description}
			</div>
			{action === "connect" && (
				<div style={{ marginTop: 8 }}>
					<WalletMultiButton />
				</div>
			)}
			{action === "create-vault" && (
				<button
					className="btn btn-primary"
					style={{ marginTop: 8 }}
					onClick={() => router.push("/dashboard")}
				>
					Create Vault
				</button>
			)}
			{action && typeof action === "object" && (
				<button
					className="btn btn-primary"
					style={{ marginTop: 8 }}
					onClick={action.onClick}
				>
					{action.label}
				</button>
			)}
		</div>
	);
}
