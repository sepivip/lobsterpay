import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/providers/providers";

export const metadata: Metadata = {
	title: "LobsterPay — Permissioned Payments for AI Agents",
	description: "Give agents limits, not seed phrases. Program-controlled vaults on Solana.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<body className="min-h-screen grain">
				<Providers>{children}</Providers>
			</body>
		</html>
	);
}
