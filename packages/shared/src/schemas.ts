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

// idempotencyKey is OPTIONAL — agents don't have to generate / track one.
// When omitted, the backend generates a fresh UUID per request. Provide
// one explicitly only if you need client-side retry safety (same key +
// same body = same outcome, never double-spent).
const optionalIdempotencyKey = z.string().min(1).max(128).optional();

export const payRequestSchema = z.object({
  mint: solanaPublicKeySchema,
  amountAtomic: positiveAmountSchema,
  destinationOwner: solanaPublicKeySchema.optional(),
  destinationTokenAccount: solanaPublicKeySchema.optional(),
  memo: z.string().max(256).optional(),
  idempotencyKey: optionalIdempotencyKey,
  metadata: z.record(z.unknown()).optional(),
});

export const swapRequestSchema = z.object({
  fromMint: solanaPublicKeySchema,
  toMint: solanaPublicKeySchema,
  amountAtomic: positiveAmountSchema,
  maxSlippageBps: z.number().min(0).max(10000),
  idempotencyKey: optionalIdempotencyKey,
});

export const x402RequestSchema = z.object({
  paymentRequirements: z.unknown(),
  originalRequestUrl: z.string().url(),
  idempotencyKey: optionalIdempotencyKey,
});

// Facilitator-mode x402 (agonx402, Coinbase reference facilitator, etc.).
// The facilitator's fee-payer pubkey is advertised in
// `paymentRequirements.extra.feePayer` and extracted server-side — no
// client-side field required. LobsterPay does two txs per call:
//   1. execute_pay_exact(vault → relayer's USDC ATA, gross) — LobsterPay
//      submits. 1.5% of gross lands in the treasury, the rest in the
//      relayer's ATA.
//   2. v0 transferChecked(relayer → facilitator's payTo) with feePayer
//      set to the facilitator's pubkey. Returned partial-signed to the
//      agent for the x402 retry.
export const x402FacilitatorRequestSchema = z.object({
  paymentRequirements: z.unknown(),
  originalRequestUrl: z.string().url(),
  idempotencyKey: optionalIdempotencyKey,
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
  authorizedAgent: z.string().optional(),
});

// --- Fee vault schemas ---

export const depositFeesSchema = z.object({
  amount: z
    .string()
    .regex(/^\d+$/, "Must be numeric")
    .refine((v) => v !== "0", { message: "Must be > 0" }),
});

export const withdrawFeesSchema = depositFeesSchema;

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
  FEE_PAYER_SECRET_KEY: z.string().optional(),
  ALLOWED_ORIGIN: z.string().optional(),
  // Public URL the API is reachable at from the internet — used to
  // substitute {LOBSTERPAY_API_URL} placeholders in downloaded skill
  // files (skill.json, agent-prompt.md, mcp-config.json, openapi.json).
  PUBLIC_API_URL: z.string().default("http://localhost:3001"),
});

// Inferred types
export type PayRequestInput = z.infer<typeof payRequestSchema>;
export type SwapRequestInput = z.infer<typeof swapRequestSchema>;
export type X402RequestInput = z.infer<typeof x402RequestSchema>;
export type X402FacilitatorRequestInput = z.infer<typeof x402FacilitatorRequestSchema>;
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
export type UpdatePolicyInput = z.infer<typeof updatePolicySchema>;
export type DepositFeesInput = z.infer<typeof depositFeesSchema>;
export type WithdrawFeesInput = z.infer<typeof withdrawFeesSchema>;
export type PaginationInput = z.infer<typeof paginationSchema>;
export type EnvConfig = z.infer<typeof envSchema>;
