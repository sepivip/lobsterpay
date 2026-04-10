import type { ActionType } from "./constants.js";

// Status enums
export type VaultStatus = "active" | "paused";
export type ApiKeyStatus = "active" | "revoked" | "expired";
export type TxStatus =
  | "created"
  | "simulated"
  | "sent"
  | "confirmed"
  | "finalized"
  | "failed";
export type RequestDecision = "approved" | "rejected";
export type ActivityType =
  | "payment"
  | "swap"
  | "x402"
  | "withdrawal"
  | "policy_update"
  | "key_created"
  | "key_revoked"
  | "pause_toggled";

// Core domain interfaces

export interface VaultInfo {
  id: string;
  ownerWallet: string;
  cluster: string;
  programId: string;
  vaultPda: string;
  policyPda: string;
  status: VaultStatus;
  createdAt: string;
}

export interface PolicyInfo {
  paused: boolean;
  allowedActions: number;
  maxPerTxAmountAtomic: string;
  dailyLimitAmountAtomic: string;
  maxSlippageBps: number;
  allowedMints: string[];
  allowedDestinations: string[];
  allowedExternalPrograms: string[];
}

export interface ApiKeyInfo {
  id: string;
  vaultId: string;
  label: string;
  prefix: string;
  status: ApiKeyStatus;
  expiresAt: string | null;
  allowedActionsOverride: number | null;
  perTxOverride: string | null;
  dailyLimitOverride: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface ApiKeyCreateResult {
  id: string;
  rawKey: string;
  prefix: string;
  label: string;
}

export interface RequestInfo {
  id: string;
  vaultId: string;
  apiKeyId: string;
  actionType: ActionType;
  idempotencyKey: string;
  decision: RequestDecision;
  rejectionReason: string | null;
  txSignature: string | null;
  txStatus: TxStatus | null;
  amountAtomic: string | null;
  mint: string | null;
  createdAt: string;
}

export interface ActivityInfo {
  id: string;
  vaultId: string;
  type: ActivityType;
  txSignature: string | null;
  referenceRequestId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface AgentVaultView {
  vaultPda: string;
  balances: Record<string, string>;
  permissions: {
    allowedActions: number;
    maxPerTxAmountAtomic: string;
    dailyLimitAmountAtomic: string;
    dailySpentAmountAtomic: string;
    maxSlippageBps: number;
  };
}

export interface SwapQuote {
  fromMint: string;
  toMint: string;
  amountIn: string;
  expectedOut: string;
  minOut: string;
  priceImpactPct: number;
  maxSlippageBps: number;
  expiresAt: string;
  routeSummary: string;
}

// Request payloads

export interface PayRequest {
  mint: string;
  amountAtomic: string;
  destinationOwner?: string;
  destinationTokenAccount?: string;
  memo?: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export interface SwapRequest {
  fromMint: string;
  toMint: string;
  amountAtomic: string;
  maxSlippageBps: number;
  idempotencyKey: string;
}

export interface X402Request {
  paymentRequirements: unknown;
  originalRequestUrl: string;
  idempotencyKey: string;
}

// Response

export interface ActionResult {
  requestId: string;
  txSignature: string | null;
  status: TxStatus;
  error: string | null;
}
