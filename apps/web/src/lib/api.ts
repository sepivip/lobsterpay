const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

let _walletAddress: string | null = null;

/** Set the wallet address to include in API requests for owner-route auth */
export function setWalletAddress(address: string | null) {
  _walletAddress = address;
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string>),
  };
  if (_walletAddress) {
    headers["X-Wallet-Address"] = _walletAddress;
  }
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(error.message || error.code || res.statusText);
  }
  return res.json();
}

export const api = {
  // Vault
  createVault: (walletAddress: string) =>
    apiFetch<any>("/v1/vaults", {
      method: "POST",
      body: JSON.stringify({ walletAddress }),
    }),

  getVaultByOwner: (walletAddress: string) =>
    apiFetch<any>(`/v1/vaults/by-owner/${walletAddress}`).catch(() => null),

  // Policy
  updatePolicy: (vaultId: string, data: any) =>
    apiFetch<any>(`/v1/vaults/${vaultId}/policy`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  // API Keys
  listApiKeys: (vaultId: string) =>
    apiFetch<{ items: any[] }>(`/v1/vaults/${vaultId}/api-keys`),

  createApiKey: (vaultId: string, data: { label: string; expiresAt?: string }) =>
    apiFetch<any>(`/v1/vaults/${vaultId}/api-keys`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  revokeApiKey: (vaultId: string, keyId: string) =>
    apiFetch<any>(`/v1/vaults/${vaultId}/api-keys/${keyId}/revoke`, {
      method: "POST",
    }),

  // Fee vault
  getFeeVault: (vaultId: string) =>
    apiFetch<any>(`/v1/vaults/${vaultId}/fee-vault`).catch(() => null),

  depositFees: (vaultId: string, amount: string) =>
    apiFetch<any>(`/v1/vaults/${vaultId}/fee-vault/deposit`, {
      method: "POST",
      body: JSON.stringify({ amount }),
    }),

  // Activity
  listActivity: (vaultId: string, cursor?: string) =>
    apiFetch<{ items: any[]; nextCursor: string | null }>(
      `/v1/vaults/${vaultId}/activity${cursor ? `?cursor=${cursor}` : ""}`
    ),
};
