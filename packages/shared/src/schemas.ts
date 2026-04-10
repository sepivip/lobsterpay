import { z } from "zod";
import {
  MAX_ALLOWED_MINTS,
  MAX_ALLOWED_DESTINATIONS,
  MAX_ALLOWED_EXTERNAL_PROGRAMS,
  SOLANA_CLUSTERS,
} from "./constants.js";

// --- Validation helpers ---

const solanaPublicKeySchema = z.string().min(32).max(44).regex(/^[1-9A-HJ-NP-Za-km-z]+$/, "Invalid base58 public key");
const positiveAmountSchema = z.string().regex(/^\d+$/, "Must be a numeric string").refine((v) => v !== "0" && v !== "", { message: "Amount must be greater than zero" });

// --- Request schemas ---

export const payRequestSchema = z.object({
  mint: solanaPublicKeySchema,
  amountAtomic: positiveAmountSchema,
  destinationOwner: solanaPublicKeySchema.optional(),
  destinationTokenAccount: solanaPublicKeySchema.optional(),
  memo: z.string().max(256).optional(),
  idempotencyKey: z.string().min(1).max(128),
  metadata: z.record(z.unknown()).optional(),
});

export const swapRequestSchema = z.object({
  fromMint: solanaPublicKeySchema,
  toMint: solanaPublicKeySchema,
  amountAtomic: positiveAmountSchema,
  maxSlippageBps: z.number().min(0).max(10000),
  idempotencyKey: z.string().min(1).max(128),
});

export const x402RequestSchema = z.object({
  paymentRequirements: z.unknown(),
  originalRequestUrl: z.string().url(),
  idempotencyKey: z.string().min(1).max(128),
});

// --- API key schemas ---

export const createApiKeySchema = z.object({
  label: z.string().min(1).max(64),
  allowedActionsOverride: z.number().optional(),
  perTxOverride: z.string().optional(),
  dailyLimitOverride: z.string().optional(),
  expiresAt: z.string().datetime().optional(),
});

// --- Policy schemas ---

export const updatePolicySchema = z.object({
  paused: z.boolean().optional(),
  allowedActions: z.number().optional(),
  maxPerTxAmountAtomic: z.string().optional(),
  dailyLimitAmountAtomic: z.string().optional(),
  maxSlippageBps: z.number().min(0).max(10000).optional(),
  allowedMints: z.array(z.string()).max(MAX_ALLOWED_MINTS).optional(),
  allowedDestinations: z
    .array(z.string())
    .max(MAX_ALLOWED_DESTINATIONS)
    .optional(),
  allowedExternalPrograms: z
    .array(z.string())
    .max(MAX_ALLOWED_EXTERNAL_PROGRAMS)
    .optional(),
});

// --- Pagination ---

export const paginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().default(20).pipe(z.number().max(100)),
});

// --- Environment ---

export const envSchema = z.object({
  DATABASE_URL: z.string(),
  REDIS_URL: z.string().optional(),
  SOLANA_RPC_URL: z.string(),
  SOLANA_CLUSTER: z.enum(SOLANA_CLUSTERS),
  LOBSTERPAY_PROGRAM_ID: z.string(),
  API_PORT: z.coerce.number().default(3001),
  API_HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.string().default("info"),
  FEE_PAYER_SECRET_KEY: z.string(),
});

// Inferred types
export type PayRequestInput = z.infer<typeof payRequestSchema>;
export type SwapRequestInput = z.infer<typeof swapRequestSchema>;
export type X402RequestInput = z.infer<typeof x402RequestSchema>;
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
export type UpdatePolicyInput = z.infer<typeof updatePolicySchema>;
export type PaginationInput = z.infer<typeof paginationSchema>;
export type EnvConfig = z.infer<typeof envSchema>;
