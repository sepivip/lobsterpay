"use client";

import { useEffect, useRef, useState } from "react";

const SCRIPT = [
	{ type: "prompt", text: "$ " },
	{
		type: "cmd",
		text:
			"curl -H \"Authorization: Bearer lp_live_xxx\" \\\n  https://api.lobsterpay.xyz/v1/agent/vault",
	},
	{
		type: "resp",
		text: `{
  "vaultPda": "f4L2xBzW…LZqw",
  "balances": [
    { "mint": "EPjFWdd…Dt1v", "symbol": "USDC", "uiAmount": 50.00 }
  ],
  "permissions": {
    "allowedActions": 7,
    "maxPerTxAmountAtomic": "1000000",
    "dailyLimitAmountAtomic": "10000000",
    "dailySpentAmountAtomic": "0",
    "maxSlippageBps": 100
  }
}`,
	},
	{ type: "prompt", text: "\n$ " },
	{
		type: "cmd",
		text:
			"curl -X POST -H \"Authorization: Bearer lp_live_xxx\" \\\n  -H \"Content-Type: application/json\" \\\n  -d '{\"mint\":\"EPjFWdd…\",\"amountAtomic\":\"100000\",\"destinationOwner\":\"ByPC…Nkxa\"}' \\\n  https://api.lobsterpay.xyz/v1/agent/actions/pay",
	},
	{
		type: "resp",
		text: `{
  "requestId": "23068e91-…",
  "txSignature": "5DqF3aK2…",
  "status": "confirmed",
  "grossAmount": "100000",
  "netAmount": "98500",
  "serviceFee": "1500"
}`,
	},
];

export function TerminalDemo() {
	const [rendered, setRendered] = useState<string[]>([""]);
	const scriptIdx = useRef(0);
	const charIdx = useRef(0);
	const scrollRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		let cancelled = false;

		const tick = () => {
			if (cancelled) return;
			if (scriptIdx.current >= SCRIPT.length) {
				setTimeout(() => {
					if (cancelled) return;
					scriptIdx.current = 0;
					charIdx.current = 0;
					setRendered([""]);
					tick();
				}, 4000);
				return;
			}

			const entry = SCRIPT[scriptIdx.current];
			charIdx.current += 1;

			setRendered((prev) => {
				const copy = [...prev];
				const lastIdx = copy.length - 1;
				if (copy.length - 1 < scriptIdx.current) {
					copy.push(entry.text.slice(0, charIdx.current));
				} else {
					copy[lastIdx] = entry.text.slice(0, charIdx.current);
				}
				return copy;
			});

			if (charIdx.current >= entry.text.length) {
				scriptIdx.current += 1;
				charIdx.current = 0;
				const delay = entry.type === "resp" ? 600 : entry.type === "prompt" ? 100 : 200;
				setTimeout(tick, delay);
			} else {
				const perChar = entry.type === "resp" ? 4 : 18;
				setTimeout(tick, perChar);
			}
		};

		tick();
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
	}, [rendered]);

	return (
		<div className="terminal-demo">
			<div className="terminal-chrome">
				<span className="terminal-dot terminal-dot-red" />
				<span className="terminal-dot terminal-dot-yellow" />
				<span className="terminal-dot terminal-dot-green" />
				<span className="terminal-title">agent@devnet — lobsterpay</span>
			</div>
			<div ref={scrollRef} className="terminal-body">
				{rendered.map((text, i) => {
					const entry = SCRIPT[i];
					const cls =
						entry?.type === "resp"
							? "terminal-resp"
							: entry?.type === "prompt"
								? "terminal-prompt"
								: "terminal-cmd";
					return (
						<span key={i} className={cls}>
							{text}
							{i === rendered.length - 1 && <span className="terminal-caret" />}
						</span>
					);
				})}
			</div>
		</div>
	);
}
