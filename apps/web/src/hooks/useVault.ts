"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { buildInitializeVaultTx, deriveFeeVaultPda } from "@/lib/solana";

/** Threshold below which the fee vault is considered "low" (0.01 SOL). */
export const FEE_BALANCE_LOW_THRESHOLD_LAMPORTS = 10_000_000n;

export interface VaultState {
  vault: any | null;
  loading: boolean;
  error: string | null;
  feeBalance: bigint | null;
  feeBalanceLow: boolean;
  feeVaultInitialized: boolean;
  refresh: () => Promise<void>;
  refreshFeeBalance: () => Promise<void>;
  createVault: () => Promise<string>;
}

export function useVault(): VaultState {
  const { publicKey, connected, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [vault, setVault] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feeBalance, setFeeBalance] = useState<bigint | null>(null);
  const [feeVaultInitialized, setFeeVaultInitialized] = useState(false);

  const refreshFeeBalance = useCallback(async () => {
    if (!publicKey) {
      setFeeBalance(null);
      setFeeVaultInitialized(false);
      return;
    }
    try {
      const [feeVaultPda] = deriveFeeVaultPda(publicKey);
      const accountInfo = await connection.getAccountInfo(feeVaultPda);
      if (accountInfo) {
        setFeeBalance(BigInt(accountInfo.lamports));
        setFeeVaultInitialized(true);
      } else {
        setFeeBalance(null);
        setFeeVaultInitialized(false);
      }
    } catch {
      setFeeBalance(null);
      setFeeVaultInitialized(false);
    }
  }, [publicKey, connection]);

  const refresh = useCallback(async () => {
    if (!publicKey) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.getVaultByOwner(publicKey.toString());
      setVault(result);
      // Fetch fee balance in parallel with any subsequent work
      await refreshFeeBalance();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [publicKey, refreshFeeBalance]);

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
      setFeeBalance(null);
      setFeeVaultInitialized(false);
      setLoading(false);
    }
  }, [connected, publicKey, refresh]);

  const feeBalanceLow =
    feeBalance !== null && feeBalance < FEE_BALANCE_LOW_THRESHOLD_LAMPORTS;

  return {
    vault,
    loading,
    error,
    feeBalance,
    feeBalanceLow,
    feeVaultInitialized,
    refresh,
    refreshFeeBalance,
    createVault,
  };
}
