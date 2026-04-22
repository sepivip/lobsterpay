"use client";

import { useState } from "react";

export function CodeBlock({ code, label }: { code: string; label?: string }) {
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(code);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			/* noop */
		}
	};

	return (
		<div className="code-block">
			{label && <span className="label-mono code-block-label">{label}</span>}
			<pre className="code-block-body">
				<code>{code}</code>
			</pre>
			<button
				type="button"
				onClick={handleCopy}
				className="code-block-copy btn btn-ghost btn-sm"
				aria-label="Copy code"
			>
				{copied ? "Copied" : "Copy"}
			</button>
		</div>
	);
}
