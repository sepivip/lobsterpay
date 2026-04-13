"use client";

import toast from "react-hot-toast";

const CLUSTER = process.env.NEXT_PUBLIC_SOLANA_CLUSTER || "devnet";

interface CopyableAddressProps {
  label: string;
  address: string;
  showExplorer?: boolean;
}

export function CopyableAddress({ label, address, showExplorer = true }: CopyableAddressProps) {
  const handleCopy = () => {
    navigator.clipboard.writeText(address);
    toast.success("Copied to clipboard");
  };

  const explorerUrl = `https://explorer.solana.com/address/${address}?cluster=${CLUSTER}`;

  return (
    <div
      className="flex items-center justify-between gap-3"
      style={{ padding: "12px 0", borderBottom: "1px solid var(--border-subtle)" }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="label-mono" style={{ marginBottom: 4 }}>{label}</div>
        <div
          className="text-sm text-secondary"
          style={{ fontFamily: "var(--font-mono)", wordBreak: "break-all", lineHeight: 1.5 }}
        >
          {address}
        </div>
      </div>
      <div className="flex gap-2" style={{ flexShrink: 0 }}>
        {showExplorer && (
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost btn-sm"
            title="View on Solana Explorer"
          >
            Explorer
          </a>
        )}
        <button className="btn btn-ghost btn-sm" onClick={handleCopy} title="Copy address">
          Copy
        </button>
      </div>
    </div>
  );
}
