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
		<div className="card empty-state">
			<div className="empty-state-icon">{icon}</div>
			<div className="empty-state-title">{title}</div>
			<div className="empty-state-desc">{description}</div>
			{action === "connect" && (
				<div className="mt-4">
					<WalletMultiButton />
				</div>
			)}
			{action === "create-vault" && (
				<button
					className="btn btn-primary mt-4"
					onClick={() => router.push("/dashboard")}
				>
					Create Vault
				</button>
			)}
			{action && typeof action === "object" && (
				<button
					className="btn btn-primary mt-4"
					onClick={action.onClick}
				>
					{action.label}
				</button>
			)}
		</div>
	);
}
