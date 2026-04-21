"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

const navItems = [
	{ href: "/dashboard", label: "Dashboard" },
	{ href: "/keys", label: "Keys" },
	{ href: "/policy", label: "Policy" },
	{ href: "/activity", label: "Activity" },
	{ href: "/integrate", label: "Integrate" },
];

export function Nav() {
	const pathname = usePathname();

	return (
		<nav className="nav">
			<div className="nav-inner">
				{/* Logo always goes to the marketing home — industry standard. */}
				<Link href="/" className="nav-logo" aria-label="LobsterPay home">
					<Image
						src="/logo-wordmark.svg"
						alt="LobsterPay"
						width={1187}
						height={214}
						priority
						style={{ height: 22, width: "auto" }}
					/>
				</Link>

				<div className="nav-tabs">
					{navItems.map((item) => (
						<Link
							key={item.href}
							href={item.href}
							className={`nav-tab ${pathname === item.href ? "nav-tab-active" : ""}`}
						>
							{item.label}
						</Link>
					))}
				</div>

				<div className="nav-right">
					<div className="label-mono flex items-center gap-2">
						<span className="status-dot status-dot-active" />
						<span className="devnet-label">Devnet</span>
					</div>
					<WalletMultiButton />
				</div>
			</div>
		</nav>
	);
}
