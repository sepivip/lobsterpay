import { Providers } from "@/providers/providers";
import { GeistMono } from "geist/font/mono";
import type { Metadata } from "next";
import localFont from "next/font/local";
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

// Public canonical URL of the deployed site. Used as the `metadataBase`
// so relative image URLs in the openGraph / twitter blocks resolve to
// absolute https://lobsterpay.xyz/... URLs in the generated <meta> tags,
// which is what social scrapers (X, Discord, Slack, iMessage, LinkedIn)
// require - they will not follow relative paths.
const siteUrl = "https://lobsterpay.xyz";
const siteTitle = "LobsterPay - Permissioned Payments for AI Agents";
const siteDescription =
	"Give agents limits, not seed phrases. Program-controlled vaults on Solana.";

export const metadata: Metadata = {
	metadataBase: new URL(siteUrl),
	title: siteTitle,
	description: siteDescription,
	openGraph: {
		type: "website",
		url: siteUrl,
		siteName: "LobsterPay",
		title: siteTitle,
		description: siteDescription,
		images: [
			{
				url: "/og.png",
				width: 1200,
				height: 630,
				alt: "LobsterPay - Give agents limits, not seed phrases.",
			},
		],
	},
	twitter: {
		card: "summary_large_image",
		site: "@LobsterPayXYZ",
		creator: "@LobsterPayXYZ",
		title: siteTitle,
		description: siteDescription,
		images: ["/og.png"],
	},
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
