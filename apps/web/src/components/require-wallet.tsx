"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { EmptyState } from "./empty-state";

export function RequireWallet({ children }: { children: React.ReactNode }) {
	const { connected } = useWallet();

	if (!connected) {
		return (
			<div className="require-wallet-wrap">
				<EmptyState
					icon="🔗"
					title="Connect your wallet"
					description="Connect a Solana wallet to access your LobsterPay vault and manage agent permissions."
					action="connect"
				/>
			</div>
		);
	}

	return <>{children}</>;
}
