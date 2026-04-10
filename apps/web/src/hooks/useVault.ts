"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { buildInitializeVaultTx } from "@/lib/solana";

export interface VaultState {
  vault: any | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  createVault: () => Promise<string>;
}

export function useVault(): VaultState {
  const { publicKey, connected, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [vault, setVault] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!publicKey) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.getVaultByOwner(publicKey.toString());
      setVault(result);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [publicKey]);

  const createVault = useCallback(async (): Promise<string> => {
    if (!publicKey) throw new Error("Wallet not connected");
    if (!sendTransaction) throw new Error("Wallet does not support signing");

    setLoading(true);
    setError(null);
    try {
      // 1. Create vault record in backend DB (returns PDAs)
      const result = await api.createVault(publicKey.toString());
      setVault(result.vault);

      // 2. Build the onchain initialize_vault transaction
      const { transaction } = await buildInitializeVaultTx(
        publicKey,
        connection,
        {
          // Default policy: allow pay + swap (bits 0 and 1)
          allowedActions: 0b011,
          maxPerTxAmountAtomic: 1_000_000, // 1 USDC (6 decimals)
          dailyLimitAmountAtomic: 10_000_000, // 10 USDC
          maxSlippageBps: 100, // 1%
        }
      );

      // 3. Sign and submit via the wallet adapter
      const signature = await sendTransaction(transaction, connection);

      // 4. Confirm the transaction
      await connection.confirmTransaction(signature, "confirmed");

      // 5. Refresh vault state from backend
      await refresh();

      return signature;
    } catch (err: any) {
      // Distinguish user rejection from other errors
      const msg =
        err?.message?.includes("User rejected") ||
        err?.message?.includes("rejected the request")
          ? "Transaction rejected by user"
          : err?.message || "Failed to create vault";
      setError(msg);
      throw new Error(msg);
    } finally {
      setLoading(false);
    }
  }, [publicKey, sendTransaction, connection, refresh]);

  useEffect(() => {
    if (connected && publicKey) {
      refresh();
    } else {
      setVault(null);
      setLoading(false);
    }
  }, [connected, publicKey, refresh]);

  return { vault, loading, error, refresh, createVault };
}
