import type {
  ActionResult,
  AgentVaultView,
  SwapQuote,
  PayRequest,
  SwapRequest,
  X402Request,
  ActivityInfo,
} from "@lobsterpay/shared";

export interface LobsterPayClientOptions {
  apiKey: string;
  baseUrl: string;
}

export class LobsterPayClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(options: LobsterPayClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(`LobsterPay API error ${res.status}: ${error.message || error.code || res.statusText}`);
    }
    return res.json() as Promise<T>;
  }

  async getVault(): Promise<AgentVaultView> {
    return this.request("GET", "/v1/agent/vault");
  }

  async createSwapQuote(params: { fromMint: string; toMint: string; amountAtomic: string }): Promise<SwapQuote> {
    return this.request("POST", "/v1/agent/quotes/swap", params);
  }

  async executePay(params: PayRequest): Promise<ActionResult> {
    return this.request("POST", "/v1/agent/actions/pay", params);
  }

  async executeSwap(params: SwapRequest): Promise<ActionResult> {
    return this.request("POST", "/v1/agent/actions/swap", params);
  }

  async executeX402(params: X402Request): Promise<ActionResult> {
    return this.request("POST", "/v1/agent/actions/x402", params);
  }

  async listActivity(params?: { cursor?: string; limit?: number }): Promise<{ items: ActivityInfo[]; nextCursor?: string }> {
    const query = new URLSearchParams();
    if (params?.cursor) query.set("cursor", params.cursor);
    if (params?.limit) query.set("limit", String(params.limit));
    const qs = query.toString();
    return this.request("GET", `/v1/agent/vault/activity${qs ? `?${qs}` : ""}`);
  }
}
