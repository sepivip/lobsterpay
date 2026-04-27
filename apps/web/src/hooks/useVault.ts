"use client";

import { PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { buildInitializeVaultTx, deriveFeeVaultPda } from "@/lib/solana";

/** Threshold below which the fee vault is considered "low" (0.01 SOL). */
export const FEE_BALANCE_LOW_THRESHOLD_LAMPORTS = 10_000_000n;

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

export interface TokenBalance {
  mint: string;
  amount: string;
  uiAmount: number;
  decimals: number;
}

export interface VaultState {
  vault: any | null;
  loading: boolean;
  error: string | null;
  feeBalance: bigint | null;
  feeBalanceLow: boolean;
  feeVaultInitialized: boolean;
  tokenBalances: TokenBalance[];
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
  const [tokenBalances, setTokenBalances] = useState<TokenBalance[]>([]);

  const refreshTokenBalances = useCallback(async (vaultPda: string) => {
    try {
      const vaultPubkey = new PublicKey(vaultPda);
      const resp = await connection.getParsedTokenAccountsByOwner(vaultPubkey, {
        programId: TOKEN_PROGRAM_ID,
      });
      const balances = resp.value.map((ta) => {
        const info = ta.account.data.parsed.info;
        return {
          mint: info.mint as string,
          amount: info.tokenAmount.amount as string,
          uiAmount: info.tokenAmount.uiAmount as number,
          decimals: info.tokenAmount.decimals as number,
        };
      });
      setTokenBalances(balances);
    } catch {
      setTokenBalances([]);
    }
  }, [connection]);

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
      const vaultPda = result?.vault_pda || result?.vaultPda;
      // Fetch on-chain balances in parallel
      await Promise.all([
        refreshFeeBalance(),
        vaultPda ? refreshTokenBalances(vaultPda) : Promise.resolve(),
      ]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [publicKey, refreshFeeBalance, refreshTokenBalances]);

  const createVault = useCallback(async (): Promise<string> => {
    if (!publicKey) throw new Error("Wallet not connected");
    if (!sendTransaction) throw new Error("Wallet does not support signing");

    setLoading(true);
    setError(null);
    try {
      // 1. Create vault record in backend DB (returns PDAs)
      const result = await api.createVault(publicKey.toString());
      setVault(result.vault);

      // 2. Fetch the service relayer pubkey so the vault is born with
      // authorized_agent pre-configured. Agent payments work
      // immediately without a separate update_authorized_agent step.
      // If the service isn't configured, falls back to owner-only
      // (manual step later via the Policy page).
      let authorizedAgent: PublicKey | undefined;
      try {
        const relayer = await api.getRelayer();
        if (relayer.configured && relayer.pubkey) {
          authorizedAgent = new PublicKey(relayer.pubkey);
        }
      } catch {
        // non-fatal - vault still works, just without agent delegation
      }

      // 3. Build the onchain initialize_vault transaction
      const { transaction } = await buildInitializeVaultTx(
        publicKey,
        connection,
        {
          // Default policy: allow pay + swap (bits 0 and 1)
          allowedActions: 0b011,
          maxPerTxAmountAtomic: 1_000_000, // 1 USDC (6 decimals)
          dailyLimitAmountAtomic: 10_000_000, // 10 USDC
          maxSlippageBps: 100, // 1%
          authorizedAgent,
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
      setTokenBalances([]);
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
    tokenBalances,
    refresh,
    refreshFeeBalance,
    createVault,
  };
}
