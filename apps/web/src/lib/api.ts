import bs58 from "bs58";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

// Signed-headers cache TTL. The backend allows up to 10 minutes; we cache
// for 9 to leave a safety margin for network latency / clock skew.
const OWNER_AUTH_TTL_MS = 9 * 60 * 1000;

type SignMessageFn = (message: Uint8Array) => Promise<Uint8Array>;

let _walletAddress: string | null = null;
let _signMessage: SignMessageFn | null = null;
let _cachedAuth: {
	walletAddress: string;
	signature: string;
	timestamp: string;
	expiresAt: number;
} | null = null;

// Coalesce concurrent owner-auth requests into a single Phantom popup.
let _inflightSign: Promise<{ signature: string; timestamp: string }> | null = null;

/** Set the connected wallet's address and signMessage function. */
export function setWallet(address: string | null, signMessage: SignMessageFn | null) {
	const changed = _walletAddress !== address;
	_walletAddress = address;
	_signMessage = signMessage;
	if (changed) {
		_cachedAuth = null;
	}
}

/** Backwards-compat shim — providers.tsx calls this with just the address. */
export function setWalletAddress(address: string | null) {
	setWallet(address, _signMessage);
}

async function signOwnerAuth(): Promise<{ signature: string; timestamp: string }> {
	if (!_walletAddress) throw new Error("Wallet not connected");
	if (!_signMessage) {
		throw new Error("Connected wallet does not expose signMessage");
	}

	const timestamp = Date.now().toString();
	const message = `LobsterPay-auth:${_walletAddress}:${timestamp}`;
	const messageBytes = new TextEncoder().encode(message);
	const signatureBytes = await _signMessage(messageBytes);
	const signature = bs58.encode(signatureBytes);
	return { signature, timestamp };
}

async function getOwnerAuthHeaders(): Promise<Record<string, string>> {
	if (!_walletAddress) throw new Error("Wallet not connected");

	const cached = _cachedAuth;
	if (cached && cached.walletAddress === _walletAddress && Date.now() < cached.expiresAt) {
		return {
			"X-Wallet-Address": cached.walletAddress,
			"X-Wallet-Signature": cached.signature,
			"X-Wallet-Timestamp": cached.timestamp,
		};
	}

	if (!_inflightSign) {
		_inflightSign = signOwnerAuth().finally(() => {
			_inflightSign = null;
		});
	}
	const { signature, timestamp } = await _inflightSign;

	_cachedAuth = {
		walletAddress: _walletAddress,
		signature,
		timestamp,
		expiresAt: Date.now() + OWNER_AUTH_TTL_MS,
	};

	return {
		"X-Wallet-Address": _walletAddress,
		"X-Wallet-Signature": signature,
		"X-Wallet-Timestamp": timestamp,
	};
}

interface FetchOptions extends RequestInit {
	ownerAuth?: boolean;
}

async function apiFetch<T>(path: string, options?: FetchOptions): Promise<T> {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		...(options?.headers as Record<string, string>),
	};

	if (options?.ownerAuth) {
		Object.assign(headers, await getOwnerAuthHeaders());
	} else if (_walletAddress) {
		// Public/read-only endpoints still get the wallet address as a hint
		// for any non-sensitive personalization. The backend MUST NOT use
		// this for authorization; it does not on any current route.
		headers["X-Wallet-Address"] = _walletAddress;
	}

	const res = await fetch(`${API_URL}${path}`, {
		...options,
		headers,
	});
	if (!res.ok) {
		// If owner-auth failed (e.g. cached signature went stale across a
		// laptop sleep), drop the cache so the next call re-prompts.
		if (res.status === 401 && options?.ownerAuth) {
			_cachedAuth = null;
		}
		const error = await res.json().catch(() => ({ message: res.statusText }));
		throw new Error(error.message || error.code || res.statusText);
	}
	return res.json();
}

export const api = {
	// Service config (public)
	getRelayer: () =>
		apiFetch<{ configured: boolean; pubkey: string | null; note?: string }>("/v1/config/relayer"),

	// Vault (public create / lookup)
	createVault: (walletAddress: string) =>
		apiFetch<any>("/v1/vaults", {
			method: "POST",
			body: JSON.stringify({ walletAddress }),
		}),

	getVaultByOwner: (walletAddress: string) =>
		apiFetch<any>(`/v1/vaults/by-owner/${walletAddress}`).catch(() => null),

	// Owner-authenticated read
	getVault: (vaultId: string) => apiFetch<any>(`/v1/vaults/${vaultId}`, { ownerAuth: true }),

	// Policy (owner write)
	updatePolicy: (vaultId: string, data: any) =>
		apiFetch<any>(`/v1/vaults/${vaultId}/policy`, {
			method: "PATCH",
			body: JSON.stringify(data),
			ownerAuth: true,
		}),

	// API Keys (owner)
	listApiKeys: (vaultId: string) =>
		apiFetch<{ items: any[] }>(`/v1/vaults/${vaultId}/api-keys`, {
			ownerAuth: true,
		}),

	createApiKey: (vaultId: string, data: { label: string; expiresAt?: string }) =>
		apiFetch<any>(`/v1/vaults/${vaultId}/api-keys`, {
			method: "POST",
			body: JSON.stringify(data),
			ownerAuth: true,
		}),

	revokeApiKey: (vaultId: string, keyId: string) =>
		apiFetch<any>(`/v1/vaults/${vaultId}/api-keys/${keyId}/revoke`, {
			method: "POST",
			ownerAuth: true,
		}),

	// Fee vault (owner)
	getFeeVault: (vaultId: string) =>
		apiFetch<any>(`/v1/vaults/${vaultId}/fee-vault`, { ownerAuth: true }).catch(() => null),

	depositFees: (vaultId: string, amount: string) =>
		apiFetch<any>(`/v1/vaults/${vaultId}/fee-vault/deposit`, {
			method: "POST",
			body: JSON.stringify({ amount }),
			ownerAuth: true,
		}),

	// Activity (owner)
	listActivity: (vaultId: string, cursor?: string) =>
		apiFetch<{ items: any[]; nextCursor: string | null }>(
			`/v1/vaults/${vaultId}/activity${cursor ? `?cursor=${cursor}` : ""}`,
			{ ownerAuth: true },
		),
};
