"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { buildDepositFeesTx } from "@/lib/solana";
import toast from "react-hot-toast";

interface DepositFeesModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void | Promise<void>;
}

const PRESETS = [0.05, 0.1, 0.5];

export function DepositFeesModal({
  open,
  onClose,
  onSuccess,
}: DepositFeesModalProps) {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [customAmount, setCustomAmount] = useState("");
  const [depositing, setDepositing] = useState(false);

  if (!open) return null;

  const solToLamports = (sol: number): bigint =>
    BigInt(Math.floor(sol * 1e9));

  const handleDeposit = async (sol: number) => {
    if (!publicKey || !sendTransaction) {
      toast.error("Wallet not connected");
      return;
    }
    if (!(sol > 0) || !Number.isFinite(sol)) {
      toast.error("Enter a valid amount");
      return;
    }

    setDepositing(true);
    const toastId = toast.loading(
      `Depositing ${sol} SOL - please approve the transaction...`
    );
    try {
      const lamports = solToLamports(sol);
      const { transaction } = await buildDepositFeesTx(
        publicKey,
        lamports,
        connection
      );

      const signature = await sendTransaction(transaction, connection);
      await connection.confirmTransaction(signature, "confirmed");

      toast.success(
        `Deposited ${sol} SOL! Tx: ${signature.slice(0, 8)}...`,
        { id: toastId, duration: 5000 }
      );

      setCustomAmount("");
      await onSuccess();
      onClose();
    } catch (err: any) {
      const rejected =
        err?.message?.includes("User rejected") ||
        err?.message?.includes("rejected the request");
      if (rejected) {
        toast.dismiss(toastId);
        toast("Transaction rejected");
      } else {
        toast.error(err?.message || "Failed to deposit fees", { id: toastId });
      }
    } finally {
      setDepositing(false);
    }
  };

  const handleCustomDeposit = () => {
    const parsed = Number(customAmount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast.error("Enter a valid amount in SOL");
      return;
    }
    void handleDeposit(parsed);
  };

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget && !depositing) onClose();
      }}
    >
      <div className="card modal-content">
        <div className="flex items-center justify-between mb-4">
          <h3
            className="text-primary"
            style={{
              fontSize: "1.25rem",
              fontWeight: 500,
              letterSpacing: "-0.02em",
              margin: 0,
            }}
          >
            Deposit Fees
          </h3>
          <button
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            disabled={depositing}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <p className="text-sm text-tertiary mb-5">
          Fund your fee vault with SOL so your backend agent can cover network
          fees for on-chain actions. You can withdraw unused SOL at any time.
        </p>

        <div className="label-mono mb-3">Quick Amounts</div>
        <div className="flex gap-2 mb-5 flex-wrap">
          {PRESETS.map((amount) => (
            <button
              key={amount}
              className="btn btn-secondary"
              onClick={() => handleDeposit(amount)}
              disabled={depositing}
            >
              {amount} SOL
            </button>
          ))}
        </div>

        <div className="label-mono mb-3">Custom Amount</div>
        <div className="flex gap-2 mb-5">
          <div style={{ position: "relative", flex: 1 }}>
            <input
              className="input"
              type="number"
              step="0.01"
              min="0"
              placeholder="0.25"
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
              disabled={depositing}
            />
            <span className="input-suffix">SOL</span>
          </div>
          <button
            className="btn btn-primary"
            onClick={handleCustomDeposit}
            disabled={depositing || !customAmount}
          >
            {depositing ? "Signing..." : "Deposit"}
          </button>
        </div>

        <div className="flex justify-end">
          <button
            className="btn btn-ghost"
            onClick={onClose}
            disabled={depositing}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
