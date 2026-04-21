/**
 * Manual Anchor instruction builders for the LobsterPay program.
 *
 * Uses raw @solana/web3.js TransactionInstruction construction with
 * discriminators and borsh-style serialization — no @coral-xyz/anchor dependency.
 */

import {
  Connection,
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

// ---------------------------------------------------------------------------
// Program ID + Treasury
// ---------------------------------------------------------------------------

export const LOBSTERPAY_PROGRAM_ID = new PublicKey(
  "A184DBQaCM6qWETbEDJUtr25bSuuTH72sTTixsyoZbtS",
);

/**
 * LobsterPay treasury pubkey — hardcoded in the Anchor program.
 * The 1.5% service fee is sent to the ATA owned by this pubkey for the
 * payment mint.
 */
export const TREASURY_PUBKEY = new PublicKey(
  "DvcQMhZmhZZQ1CX6FhGkyAiPr3YtNbBuLDP3QpuBRTHp",
);

/**
 * Service fee in basis points (1.5%) — matches the on-chain constant.
 */
export const SERVICE_FEE_BPS = 150n;

/**
 * Minimum SOL balance (lamports) that the fee vault must hold before the
 * backend will submit a fee-payer-signed agent transaction.
 */
export const FEE_VAULT_MIN_BALANCE = 1_500_000n;

// ---------------------------------------------------------------------------
// PDA helpers
// ---------------------------------------------------------------------------

export function deriveVaultPda(
  owner: PublicKey,
  programId: PublicKey = LOBSTERPAY_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), owner.toBuffer()],
    programId,
  );
}

export function derivePolicyPda(
  vault: PublicKey,
  programId: PublicKey = LOBSTERPAY_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("policy"), vault.toBuffer()],
    programId,
  );
}

/**
 * Derives the FeeVault PDA for an owner.
 * Seeds: ["fee_vault", owner]
 */
export function deriveFeeVaultPda(
  owner: PublicKey,
  programId: PublicKey = LOBSTERPAY_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("fee_vault"), owner.toBuffer()],
    programId,
  );
}

/**
 * Derives the Associated Token Account for a vault + mint.
 */
export function getVaultTokenAccount(
  vault: PublicKey,
  mint: PublicKey,
  tokenProgramId: PublicKey,
): PublicKey {
  return getAssociatedTokenAddressSync(mint, vault, true, tokenProgramId);
}

/**
 * Returns the Associated Token Account owned by the LobsterPay treasury
 * for a given mint. This is where the 1.5% service fee lands.
 */
export function getTreasuryTokenAccount(
  mint: PublicKey,
  tokenProgramId: PublicKey = TOKEN_PROGRAM_ID,
): PublicKey {
  // Treasury is a regular wallet pubkey (not a PDA), but we pass
  // allowOwnerOffCurve=true for safety so this always succeeds regardless
  // of whether the pubkey is on-curve.
  return getAssociatedTokenAddressSync(mint, TREASURY_PUBKEY, true, tokenProgramId);
}

// ---------------------------------------------------------------------------
// Instruction discriminators (from the IDL)
// ---------------------------------------------------------------------------

const DISC_INITIALIZE_VAULT = Buffer.from([48, 191, 163, 44, 71, 129, 63, 164]);
const DISC_UPDATE_POLICY = Buffer.from([212, 245, 246, 7, 163, 151, 18, 57]);
const DISC_ENSURE_VAULT_TOKEN_ACCOUNT = Buffer.from([168, 77, 151, 115, 244, 83, 37, 49]);
const DISC_EXECUTE_PAY_EXACT = Buffer.from([199, 113, 233, 162, 70, 70, 83, 156]);
const DISC_EMERGENCY_PAUSE = Buffer.from([21, 143, 27, 142, 200, 181, 210, 255]);
const DISC_WITHDRAW_OWNER = Buffer.from([229, 130, 29, 107, 229, 152, 167, 190]);
const DISC_INITIALIZE_FEE_VAULT = Buffer.from([185, 140, 228, 234, 79, 203, 252, 50]);
const DISC_DEPOSIT_FEES = Buffer.from([13, 215, 175, 72, 53, 21, 89, 5]);
const DISC_WITHDRAW_FEES = Buffer.from([198, 212, 171, 109, 144, 215, 174, 89]);
const DISC_UPDATE_AUTHORIZED_AGENT = Buffer.from([99, 196, 103, 74, 106, 51, 2, 81]);

// ---------------------------------------------------------------------------
// Param types
// ---------------------------------------------------------------------------

export interface InitializeVaultParams {
  allowedActions: bigint;
  maxPerTxAmountAtomic: bigint;
  dailyLimitAmountAtomic: bigint;
  maxSlippageBps: number;
}

export interface UpdatePolicyParams {
  paused?: boolean;
  allowedActions?: bigint;
  maxPerTxAmountAtomic?: bigint;
  dailyLimitAmountAtomic?: bigint;
  maxSlippageBps?: number;
  allowedMints?: PublicKey[];
  allowedDestinations?: PublicKey[];
  allowedExternalPrograms?: PublicKey[];
}

export interface ExecutePayExactParams {
  amount: bigint;
  requestHash: Uint8Array; // 32 bytes
}

export interface WithdrawOwnerParams {
  amount: bigint;
}

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

function writeU64(buf: Buffer, value: bigint, offset: number): number {
  buf.writeBigUInt64LE(value, offset);
  return offset + 8;
}

function writeU16(buf: Buffer, value: number, offset: number): number {
  buf.writeUInt16LE(value, offset);
  return offset + 2;
}

function writeOptionBool(buf: Buffer, value: boolean | undefined, offset: number): number {
  if (value === undefined) {
    buf.writeUInt8(0, offset);
    return offset + 1;
  }
  buf.writeUInt8(1, offset);
  buf.writeUInt8(value ? 1 : 0, offset + 1);
  return offset + 2;
}

function writeOptionU64(buf: Buffer, value: bigint | undefined, offset: number): number {
  if (value === undefined) {
    buf.writeUInt8(0, offset);
    return offset + 1;
  }
  buf.writeUInt8(1, offset);
  return writeU64(buf, value, offset + 1);
}

function writeOptionU16(buf: Buffer, value: number | undefined, offset: number): number {
  if (value === undefined) {
    buf.writeUInt8(0, offset);
    return offset + 1;
  }
  buf.writeUInt8(1, offset);
  return writeU16(buf, value, offset + 1);
}

function writeOptionPubkeyVec(
  buf: Buffer,
  value: PublicKey[] | undefined,
  offset: number,
): number {
  if (value === undefined) {
    buf.writeUInt8(0, offset);
    return offset + 1;
  }
  buf.writeUInt8(1, offset);
  offset += 1;
  buf.writeUInt32LE(value.length, offset);
  offset += 4;
  for (const pk of value) {
    pk.toBuffer().copy(buf, offset);
    offset += 32;
  }
  return offset;
}

// ---------------------------------------------------------------------------
// Instruction builders
// ---------------------------------------------------------------------------

/**
 * Build the `initialize_vault` instruction.
 *
 * Accounts: owner (signer, writable), vault (writable), policy (writable), system_program
 */
export function buildInitializeVaultIx(args: {
  owner: PublicKey;
  vault: PublicKey;
  policy: PublicKey;
  params: InitializeVaultParams;
  programId?: PublicKey;
}): TransactionInstruction {
  const programId = args.programId ?? LOBSTERPAY_PROGRAM_ID;

  // Serialize params: u64 + u64 + u64 + u16 = 26 bytes
  const data = Buffer.alloc(8 + 26);
  DISC_INITIALIZE_VAULT.copy(data, 0);
  let offset = 8;
  offset = writeU64(data, args.params.allowedActions, offset);
  offset = writeU64(data, args.params.maxPerTxAmountAtomic, offset);
  offset = writeU64(data, args.params.dailyLimitAmountAtomic, offset);
  writeU16(data, args.params.maxSlippageBps, offset);

  return new TransactionInstruction({
    keys: [
      { pubkey: args.owner, isSigner: true, isWritable: true },
      { pubkey: args.vault, isSigner: false, isWritable: true },
      { pubkey: args.policy, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId,
    data,
  });
}

/**
 * Build the `update_policy` instruction.
 *
 * Accounts: owner (signer), vault, policy (writable)
 */
export function buildUpdatePolicyIx(args: {
  owner: PublicKey;
  vault: PublicKey;
  policy: PublicKey;
  params: UpdatePolicyParams;
  programId?: PublicKey;
}): TransactionInstruction {
  const programId = args.programId ?? LOBSTERPAY_PROGRAM_ID;
  const p = args.params;

  // Calculate required buffer size for variable-length options
  let size = 8; // discriminator
  size += p.paused === undefined ? 1 : 2; // Option<bool>
  size += p.allowedActions === undefined ? 1 : 9; // Option<u64>
  size += p.maxPerTxAmountAtomic === undefined ? 1 : 9; // Option<u64>
  size += p.dailyLimitAmountAtomic === undefined ? 1 : 9; // Option<u64>
  size += p.maxSlippageBps === undefined ? 1 : 3; // Option<u16>
  size += p.allowedMints === undefined ? 1 : 1 + 4 + p.allowedMints.length * 32;
  size += p.allowedDestinations === undefined ? 1 : 1 + 4 + p.allowedDestinations.length * 32;
  size +=
    p.allowedExternalPrograms === undefined
      ? 1
      : 1 + 4 + p.allowedExternalPrograms.length * 32;

  const data = Buffer.alloc(size);
  DISC_UPDATE_POLICY.copy(data, 0);
  let offset = 8;
  offset = writeOptionBool(data, p.paused, offset);
  offset = writeOptionU64(data, p.allowedActions, offset);
  offset = writeOptionU64(data, p.maxPerTxAmountAtomic, offset);
  offset = writeOptionU64(data, p.dailyLimitAmountAtomic, offset);
  offset = writeOptionU16(data, p.maxSlippageBps, offset);
  offset = writeOptionPubkeyVec(data, p.allowedMints, offset);
  offset = writeOptionPubkeyVec(data, p.allowedDestinations, offset);
  offset = writeOptionPubkeyVec(data, p.allowedExternalPrograms, offset);

  return new TransactionInstruction({
    keys: [
      { pubkey: args.owner, isSigner: true, isWritable: false },
      { pubkey: args.vault, isSigner: false, isWritable: false },
      { pubkey: args.policy, isSigner: false, isWritable: true },
    ],
    programId,
    data,
  });
}

/**
 * Build the `ensure_vault_token_account` instruction.
 *
 * Accounts: payer (signer, writable), vault, mint, vault_token_account (writable),
 *           token_program, associated_token_program, system_program
 */
export function buildEnsureVaultTokenAccountIx(args: {
  payer: PublicKey;
  vault: PublicKey;
  mint: PublicKey;
  vaultTokenAccount: PublicKey;
  tokenProgramId: PublicKey;
  programId?: PublicKey;
}): TransactionInstruction {
  const programId = args.programId ?? LOBSTERPAY_PROGRAM_ID;

  // No args — discriminator only
  const data = Buffer.alloc(8);
  DISC_ENSURE_VAULT_TOKEN_ACCOUNT.copy(data, 0);

  return new TransactionInstruction({
    keys: [
      { pubkey: args.payer, isSigner: true, isWritable: true },
      { pubkey: args.vault, isSigner: false, isWritable: false },
      { pubkey: args.mint, isSigner: false, isWritable: false },
      { pubkey: args.vaultTokenAccount, isSigner: false, isWritable: true },
      { pubkey: args.tokenProgramId, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId,
    data,
  });
}

/**
 * Build the `execute_pay_exact` instruction.
 *
 * Accounts (per updated IDL):
 *   authority (signer), vault, policy (writable), fee_vault, mint,
 *   vault_token_account (writable), destination_token_account (writable),
 *   treasury_token_account (writable), token_program
 */
export function buildExecutePayExactIx(args: {
  authority: PublicKey;
  vault: PublicKey;
  policy: PublicKey;
  feeVault: PublicKey;
  mint: PublicKey;
  vaultTokenAccount: PublicKey;
  destinationTokenAccount: PublicKey;
  treasuryTokenAccount: PublicKey;
  tokenProgramId: PublicKey;
  params: ExecutePayExactParams;
  programId?: PublicKey;
}): TransactionInstruction {
  const programId = args.programId ?? LOBSTERPAY_PROGRAM_ID;

  // Serialize: u64 (8) + [u8; 32] (32) = 40 bytes
  const data = Buffer.alloc(8 + 40);
  DISC_EXECUTE_PAY_EXACT.copy(data, 0);
  let offset = 8;
  offset = writeU64(data, args.params.amount, offset);
  Buffer.from(args.params.requestHash).copy(data, offset);

  return new TransactionInstruction({
    keys: [
      // authority is marked #[account(mut)] in the program — it receives
      // reimbursement lamports from fee_vault, so must be writable.
      { pubkey: args.authority, isSigner: true, isWritable: true },
      { pubkey: args.vault, isSigner: false, isWritable: false },
      { pubkey: args.policy, isSigner: false, isWritable: true },
      // fee_vault is #[account(mut)] — lamports are debited to reimburse
      // the authority. Must be writable.
      { pubkey: args.feeVault, isSigner: false, isWritable: true },
      { pubkey: args.mint, isSigner: false, isWritable: false },
      { pubkey: args.vaultTokenAccount, isSigner: false, isWritable: true },
      { pubkey: args.destinationTokenAccount, isSigner: false, isWritable: true },
      { pubkey: args.treasuryTokenAccount, isSigner: false, isWritable: true },
      { pubkey: args.tokenProgramId, isSigner: false, isWritable: false },
    ],
    programId,
    data,
  });
}

/**
 * Build the `initialize_fee_vault` instruction.
 *
 * Accounts: owner (signer, writable), vault, fee_vault (writable, init),
 *           system_program
 */
export function buildInitializeFeeVaultIx(args: {
  owner: PublicKey;
  vault: PublicKey;
  feeVault: PublicKey;
  programId?: PublicKey;
}): TransactionInstruction {
  const programId = args.programId ?? LOBSTERPAY_PROGRAM_ID;

  // No args — discriminator only
  const data = Buffer.alloc(8);
  DISC_INITIALIZE_FEE_VAULT.copy(data, 0);

  return new TransactionInstruction({
    keys: [
      { pubkey: args.owner, isSigner: true, isWritable: true },
      { pubkey: args.vault, isSigner: false, isWritable: false },
      { pubkey: args.feeVault, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId,
    data,
  });
}

/**
 * Build the `deposit_fees` instruction.
 *
 * Accounts: owner (signer, writable), fee_vault (writable), system_program
 */
export function buildDepositFeesIx(args: {
  owner: PublicKey;
  feeVault: PublicKey;
  amount: bigint;
  programId?: PublicKey;
}): TransactionInstruction {
  const programId = args.programId ?? LOBSTERPAY_PROGRAM_ID;

  // Serialize params: u64 = 8 bytes
  const data = Buffer.alloc(8 + 8);
  DISC_DEPOSIT_FEES.copy(data, 0);
  writeU64(data, args.amount, 8);

  return new TransactionInstruction({
    keys: [
      { pubkey: args.owner, isSigner: true, isWritable: true },
      { pubkey: args.feeVault, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId,
    data,
  });
}

/**
 * Build the `withdraw_fees` instruction.
 *
 * Accounts: owner (signer, writable), fee_vault (writable)
 */
export function buildWithdrawFeesIx(args: {
  owner: PublicKey;
  feeVault: PublicKey;
  amount: bigint;
  programId?: PublicKey;
}): TransactionInstruction {
  const programId = args.programId ?? LOBSTERPAY_PROGRAM_ID;

  // Serialize params: u64 = 8 bytes
  const data = Buffer.alloc(8 + 8);
  DISC_WITHDRAW_FEES.copy(data, 0);
  writeU64(data, args.amount, 8);

  return new TransactionInstruction({
    keys: [
      { pubkey: args.owner, isSigner: true, isWritable: true },
      { pubkey: args.feeVault, isSigner: false, isWritable: true },
    ],
    programId,
    data,
  });
}

/**
 * Build the `update_authorized_agent` instruction.
 *
 * Accounts: owner (signer), vault, policy (writable)
 */
export function buildUpdateAuthorizedAgentIx(args: {
  owner: PublicKey;
  vault: PublicKey;
  policy: PublicKey;
  newAgent: PublicKey;
  programId?: PublicKey;
}): TransactionInstruction {
  const programId = args.programId ?? LOBSTERPAY_PROGRAM_ID;

  // Serialize params: Pubkey (32 bytes)
  const data = Buffer.alloc(8 + 32);
  DISC_UPDATE_AUTHORIZED_AGENT.copy(data, 0);
  args.newAgent.toBuffer().copy(data, 8);

  return new TransactionInstruction({
    keys: [
      { pubkey: args.owner, isSigner: true, isWritable: false },
      { pubkey: args.vault, isSigner: false, isWritable: false },
      { pubkey: args.policy, isSigner: false, isWritable: true },
    ],
    programId,
    data,
  });
}

/**
 * Build the `emergency_pause` instruction.
 *
 * Accounts: owner (signer), vault, policy (writable)
 */
export function buildEmergencyPauseIx(args: {
  owner: PublicKey;
  vault: PublicKey;
  policy: PublicKey;
  programId?: PublicKey;
}): TransactionInstruction {
  const programId = args.programId ?? LOBSTERPAY_PROGRAM_ID;

  // No args — discriminator only
  const data = Buffer.alloc(8);
  DISC_EMERGENCY_PAUSE.copy(data, 0);

  return new TransactionInstruction({
    keys: [
      { pubkey: args.owner, isSigner: true, isWritable: false },
      { pubkey: args.vault, isSigner: false, isWritable: false },
      { pubkey: args.policy, isSigner: false, isWritable: true },
    ],
    programId,
    data,
  });
}

/**
 * Build the `withdraw_owner` instruction.
 *
 * Accounts: owner (signer), vault, policy, mint, vault_token_account (writable),
 *           destination_token_account (writable), token_program
 */
export function buildWithdrawOwnerIx(args: {
  owner: PublicKey;
  vault: PublicKey;
  policy: PublicKey;
  mint: PublicKey;
  vaultTokenAccount: PublicKey;
  destinationTokenAccount: PublicKey;
  tokenProgramId: PublicKey;
  params: WithdrawOwnerParams;
  programId?: PublicKey;
}): TransactionInstruction {
  const programId = args.programId ?? LOBSTERPAY_PROGRAM_ID;

  // Serialize: u64 (8) = 8 bytes
  const data = Buffer.alloc(8 + 8);
  DISC_WITHDRAW_OWNER.copy(data, 0);
  writeU64(data, args.params.amount, 8);

  return new TransactionInstruction({
    keys: [
      { pubkey: args.owner, isSigner: true, isWritable: false },
      { pubkey: args.vault, isSigner: false, isWritable: false },
      { pubkey: args.policy, isSigner: false, isWritable: false },
      { pubkey: args.mint, isSigner: false, isWritable: false },
      { pubkey: args.vaultTokenAccount, isSigner: false, isWritable: true },
      { pubkey: args.destinationTokenAccount, isSigner: false, isWritable: true },
      { pubkey: args.tokenProgramId, isSigner: false, isWritable: false },
    ],
    programId,
    data,
  });
}

// ---------------------------------------------------------------------------
// Transaction builder helper
// ---------------------------------------------------------------------------

/**
 * Build a legacy Transaction from an array of instructions, fetching the
 * latest blockhash from the provided connection.
 *
 * Automatically prepends compute budget instructions:
 * - setComputeUnitLimit: conservative CU cap (default 300k)
 * - setComputeUnitPrice: priority fee for congestion (default 1000 micro-lamports)
 */
export async function buildTransaction(
  instructions: TransactionInstruction[],
  feePayer: PublicKey,
  connection: Connection,
  opts?: { computeUnits?: number; priorityFee?: number },
): Promise<Transaction> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

  const tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = feePayer;

  // Prepend compute budget instructions for reliability + priority
  tx.add(
    ComputeBudgetProgram.setComputeUnitLimit({
      units: opts?.computeUnits ?? 300_000,
    }),
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: opts?.priorityFee ?? 1_000,
    }),
  );

  for (const ix of instructions) {
    tx.add(ix);
  }

  return tx;
}
