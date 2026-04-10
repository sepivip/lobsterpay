/**
 * Manual Anchor instruction builders for the LobsterPay program.
 *
 * Uses raw @solana/web3.js TransactionInstruction construction with
 * discriminators and borsh-style serialization — no @coral-xyz/anchor dependency.
 */

import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

// ---------------------------------------------------------------------------
// Program ID
// ---------------------------------------------------------------------------

export const LOBSTERPAY_PROGRAM_ID = new PublicKey(
  "5mrHEGGwCUkjUgnEUvJz52sf7sxCQG9yfYiP8Qyjec4o",
);

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
 * Derives the Associated Token Account for a vault + mint.
 */
export function getVaultTokenAccount(
  vault: PublicKey,
  mint: PublicKey,
  tokenProgramId: PublicKey,
): PublicKey {
  return getAssociatedTokenAddressSync(mint, vault, true, tokenProgramId);
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
 * Accounts: authority (signer), vault, policy (writable), mint,
 *           vault_token_account (writable), destination_token_account (writable),
 *           token_program
 */
export function buildExecutePayExactIx(args: {
  authority: PublicKey;
  vault: PublicKey;
  policy: PublicKey;
  mint: PublicKey;
  vaultTokenAccount: PublicKey;
  destinationTokenAccount: PublicKey;
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
      { pubkey: args.authority, isSigner: true, isWritable: false },
      { pubkey: args.vault, isSigner: false, isWritable: false },
      { pubkey: args.policy, isSigner: false, isWritable: true },
      { pubkey: args.mint, isSigner: false, isWritable: false },
      { pubkey: args.vaultTokenAccount, isSigner: false, isWritable: true },
      { pubkey: args.destinationTokenAccount, isSigner: false, isWritable: true },
      { pubkey: args.tokenProgramId, isSigner: false, isWritable: false },
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
 */
export async function buildTransaction(
  instructions: TransactionInstruction[],
  feePayer: PublicKey,
  connection: Connection,
): Promise<Transaction> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

  const tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = feePayer;

  for (const ix of instructions) {
    tx.add(ix);
  }

  return tx;
}
