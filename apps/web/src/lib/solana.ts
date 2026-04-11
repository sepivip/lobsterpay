import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type Connection,
} from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey(
  "A184DBQaCM6qWETbEDJUtr25bSuuTH72sTTixsyoZbtS"
);

// ── PDA derivation ──────────────────────────────────────────────────────

export function deriveVaultPda(owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), owner.toBuffer()],
    PROGRAM_ID
  );
}

export function derivePolicyPda(vault: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("policy"), vault.toBuffer()],
    PROGRAM_ID
  );
}

export const FEE_VAULT_SEED = Buffer.from("fee_vault");

export function deriveFeeVaultPda(owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [FEE_VAULT_SEED, owner.toBuffer()],
    PROGRAM_ID
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────

/** Write a u64 (bigint-safe) as 8-byte little-endian buffer */
function u64LE(value: number | bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(value));
  return buf;
}

/** Write a u16 as 2-byte little-endian buffer */
function u16LE(value: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(value);
  return buf;
}

// ── initialize_vault ────────────────────────────────────────────────────

export interface InitializeVaultParams {
  allowedActions: number;
  maxPerTxAmountAtomic: number | bigint;
  dailyLimitAmountAtomic: number | bigint;
  maxSlippageBps: number;
}

export async function buildInitializeVaultTx(
  owner: PublicKey,
  connection: Connection,
  params: InitializeVaultParams
): Promise<{
  transaction: Transaction;
  vaultPda: PublicKey;
  policyPda: PublicKey;
}> {
  const [vaultPda] = deriveVaultPda(owner);
  const [policyPda] = derivePolicyPda(vaultPda);

  // Discriminator: sha256("global:initialize_vault")[0..8]
  const discriminator = Buffer.from([48, 191, 163, 44, 71, 129, 63, 164]);

  // Args: allowed_actions(u64) + max_per_tx_amount_atomic(u64) + daily_limit_amount_atomic(u64) + max_slippage_bps(u16)
  const args = Buffer.concat([
    u64LE(params.allowedActions),
    u64LE(params.maxPerTxAmountAtomic),
    u64LE(params.dailyLimitAmountAtomic),
    u16LE(params.maxSlippageBps),
  ]);

  const data = Buffer.concat([discriminator, args]);

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: policyPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();

  const tx = new Transaction({
    blockhash,
    lastValidBlockHeight,
    feePayer: owner,
  });
  tx.add(ix);

  return { transaction: tx, vaultPda, policyPda };
}

// ── update_policy ───────────────────────────────────────────────────────

export interface UpdatePolicyParams {
  paused?: boolean;
  allowedActions?: number;
  maxPerTxAmountAtomic?: bigint;
  dailyLimitAmountAtomic?: bigint;
  maxSlippageBps?: number;
  allowedMints?: PublicKey[];
  allowedDestinations?: PublicKey[];
  allowedExternalPrograms?: string[];
}

/**
 * Encode a Borsh Option<T>:
 *   None  = 0x00
 *   Some  = 0x01 + encoded_value
 */
function optionU64(value: number | bigint | undefined): Buffer {
  if (value === undefined) return Buffer.from([0]);
  return Buffer.concat([Buffer.from([1]), u64LE(value)]);
}

function optionU16(value: number | undefined): Buffer {
  if (value === undefined) return Buffer.from([0]);
  return Buffer.concat([Buffer.from([1]), u16LE(value)]);
}

function optionBool(value: boolean | undefined): Buffer {
  if (value === undefined) return Buffer.from([0]);
  return Buffer.concat([Buffer.from([1]), Buffer.from([value ? 1 : 0])]);
}

/**
 * Encode Option<Vec<Pubkey>>:
 *   None = 0x00
 *   Some = 0x01 + 4-byte LE count + 32*N bytes
 */
function optionPubkeyVec(keys: PublicKey[] | undefined): Buffer {
  if (keys === undefined) return Buffer.from([0]);
  const countBuf = Buffer.alloc(4);
  countBuf.writeUInt32LE(keys.length);
  const keysBuf = Buffer.concat(keys.map((k) => k.toBuffer()));
  return Buffer.concat([Buffer.from([1]), countBuf, keysBuf]);
}

export async function buildUpdatePolicyTx(
  owner: PublicKey,
  vaultPda: PublicKey,
  policyPda: PublicKey,
  connection: Connection,
  params: UpdatePolicyParams
): Promise<{ transaction: Transaction }> {
  // Discriminator: sha256("global:update_policy")[0..8]
  const discriminator = Buffer.from([212, 245, 246, 7, 163, 151, 18, 57]);

  const args = Buffer.concat([
    optionBool(params.paused),
    optionU64(params.allowedActions),
    optionU64(params.maxPerTxAmountAtomic),
    optionU64(params.dailyLimitAmountAtomic),
    optionU16(params.maxSlippageBps),
    optionPubkeyVec(params.allowedMints),
    optionPubkeyVec(params.allowedDestinations),
    optionPubkeyVec(
      params.allowedExternalPrograms?.map((p) => new PublicKey(p))
    ),
  ]);

  const data = Buffer.concat([discriminator, args]);

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: false },
      { pubkey: vaultPda, isSigner: false, isWritable: false },
      { pubkey: policyPda, isSigner: false, isWritable: true },
    ],
    data,
  });

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();

  const tx = new Transaction({
    blockhash,
    lastValidBlockHeight,
    feePayer: owner,
  });
  tx.add(ix);

  return { transaction: tx };
}

// ── initialize_fee_vault ────────────────────────────────────────────────

export async function buildInitializeFeeVaultTx(
  owner: PublicKey,
  connection: Connection
): Promise<{
  transaction: Transaction;
  vaultPda: PublicKey;
  feeVaultPda: PublicKey;
}> {
  const [vaultPda] = deriveVaultPda(owner);
  const [feeVaultPda] = deriveFeeVaultPda(owner);

  // Discriminator: sha256("global:initialize_fee_vault")[0..8]
  const discriminator = Buffer.from([185, 140, 228, 234, 79, 203, 252, 50]);

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: false },
      { pubkey: feeVaultPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: discriminator,
  });

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();

  const tx = new Transaction({
    blockhash,
    lastValidBlockHeight,
    feePayer: owner,
  });
  tx.add(ix);

  return { transaction: tx, vaultPda, feeVaultPda };
}

// ── deposit_fees ────────────────────────────────────────────────────────

export async function buildDepositFeesTx(
  owner: PublicKey,
  amountLamports: bigint,
  connection: Connection
): Promise<{
  transaction: Transaction;
  feeVaultPda: PublicKey;
}> {
  const [feeVaultPda] = deriveFeeVaultPda(owner);

  // Discriminator: sha256("global:deposit_fees")[0..8]
  const discriminator = Buffer.from([13, 215, 175, 72, 53, 21, 89, 5]);

  const args = u64LE(amountLamports);
  const data = Buffer.concat([discriminator, args]);

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: feeVaultPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();

  const tx = new Transaction({
    blockhash,
    lastValidBlockHeight,
    feePayer: owner,
  });
  tx.add(ix);

  return { transaction: tx, feeVaultPda };
}

// ── withdraw_fees ───────────────────────────────────────────────────────

export async function buildWithdrawFeesTx(
  owner: PublicKey,
  amountLamports: bigint,
  connection: Connection
): Promise<{
  transaction: Transaction;
  feeVaultPda: PublicKey;
}> {
  const [feeVaultPda] = deriveFeeVaultPda(owner);

  // Discriminator: sha256("global:withdraw_fees")[0..8]
  const discriminator = Buffer.from([198, 212, 171, 109, 144, 215, 174, 89]);

  const args = u64LE(amountLamports);
  const data = Buffer.concat([discriminator, args]);

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: feeVaultPda, isSigner: false, isWritable: true },
    ],
    data,
  });

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();

  const tx = new Transaction({
    blockhash,
    lastValidBlockHeight,
    feePayer: owner,
  });
  tx.add(ix);

  return { transaction: tx, feeVaultPda };
}

// ── update_authorized_agent ─────────────────────────────────────────────

export async function buildUpdateAuthorizedAgentTx(
  owner: PublicKey,
  newAgent: PublicKey,
  connection: Connection
): Promise<{
  transaction: Transaction;
  vaultPda: PublicKey;
  policyPda: PublicKey;
}> {
  const [vaultPda] = deriveVaultPda(owner);
  const [policyPda] = derivePolicyPda(vaultPda);

  // Discriminator: sha256("global:update_authorized_agent")[0..8]
  const discriminator = Buffer.from([99, 196, 103, 74, 106, 51, 2, 81]);

  // Args: new_agent (pubkey = 32 bytes)
  const data = Buffer.concat([discriminator, newAgent.toBuffer()]);

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: false },
      { pubkey: vaultPda, isSigner: false, isWritable: false },
      { pubkey: policyPda, isSigner: false, isWritable: true },
    ],
    data,
  });

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();

  const tx = new Transaction({
    blockhash,
    lastValidBlockHeight,
    feePayer: owner,
  });
  tx.add(ix);

  return { transaction: tx, vaultPda, policyPda };
}

// ── emergency_pause ─────────────────────────────────────────────────────

export async function buildEmergencyPauseTx(
  owner: PublicKey,
  vaultPda: PublicKey,
  policyPda: PublicKey,
  connection: Connection
): Promise<{ transaction: Transaction }> {
  // Discriminator: sha256("global:emergency_pause")[0..8]
  const discriminator = Buffer.from([21, 143, 27, 142, 200, 181, 210, 255]);

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: false },
      { pubkey: vaultPda, isSigner: false, isWritable: false },
      { pubkey: policyPda, isSigner: false, isWritable: true },
    ],
    data: discriminator,
  });

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();

  const tx = new Transaction({
    blockhash,
    lastValidBlockHeight,
    feePayer: owner,
  });
  tx.add(ix);

  return { transaction: tx };
}
