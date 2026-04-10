"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";

export interface VaultState {
  vault: any | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  createVault: () => Promise<void>;
}

export function useVault(): VaultState {
  const { publicKey, connected } = useWallet();
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

  const createVault = useCallback(async () => {
    if (!publicKey) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.createVault(publicKey.toString());
      setVault(result.vault);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [publicKey]);

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
