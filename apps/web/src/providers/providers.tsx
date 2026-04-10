"use client";

import { useMemo, useEffect } from "react";
import { ConnectionProvider, WalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import { Toaster } from "react-hot-toast";
import { setWalletAddress } from "@/lib/api";
import "@solana/wallet-adapter-react-ui/styles.css";

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";

/** Syncs the connected wallet address to the API client for X-Wallet-Address header */
function WalletSync({ children }: { children: React.ReactNode }) {
	const { publicKey } = useWallet();
	useEffect(() => {
		setWalletAddress(publicKey?.toString() ?? null);
	}, [publicKey]);
	return <>{children}</>;
}

export function Providers({ children }: { children: React.ReactNode }) {
	const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);

	return (
		<ConnectionProvider endpoint={RPC_URL}>
			<WalletProvider wallets={wallets} autoConnect>
				<WalletModalProvider>
					<WalletSync>{children}</WalletSync>
					<Toaster
						position="bottom-right"
						toastOptions={{
							style: {
								background: "var(--bg-card)",
								color: "var(--text-primary)",
								border: "1px solid var(--border-default)",
								borderRadius: "var(--radius-md)",
								fontFamily: "var(--font-sans)",
								fontSize: "0.875rem",
								letterSpacing: "var(--tracking-normal)",
							},
						}}
					/>
				</WalletModalProvider>
			</WalletProvider>
		</ConnectionProvider>
	);
}
