import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { Providers } from "@/providers/providers";

export const metadata: Metadata = {
	title: "LobsterPay — Permissioned Payments for AI Agents",
	description: "Give agents limits, not seed phrases. Program-controlled vaults on Solana.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
			<body className="min-h-screen">
				<Providers>{children}</Providers>
			</body>
		</html>
	);
}
