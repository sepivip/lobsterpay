"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { LogoAscii } from "./logo-ascii";

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
				<Link href="/dashboard" className="nav-logo">
					<LogoAscii size="nav" />
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
