import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import localFont from "next/font/local";
import { Providers } from "@/providers/providers";
import "./globals.css";

// TASA Orbiter (variable font, served by Google Fonts). Self-hosted so it
// travels with the bundle and respects Next's font optimization. The same
// .woff2 file covers all weights since it's a variable font — Google's
// CSS just duplicates the @font-face for each weight.
// GeistMono stays for display, buttons, the ASCII logo, and any UI that
// leans on fixed-width character rhythm.
const tasaOrbiter = localFont({
	src: [
		{
			path: "../../public/fonts/tasa-orbiter/tasa-orbiter-latin.woff2",
			weight: "300 700",
			style: "normal",
		},
	],
	variable: "--font-tasa-orbiter",
	display: "swap",
	fallback: ["system-ui", "-apple-system", "sans-serif"],
});

export const metadata: Metadata = {
	title: "LobsterPay — Permissioned Payments for AI Agents",
	description: "Give agents limits, not seed phrases. Program-controlled vaults on Solana.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" className={`${tasaOrbiter.variable} ${GeistMono.variable}`}>
			<body className="min-h-screen">
				<Providers>{children}</Providers>
			</body>
		</html>
	);
}
