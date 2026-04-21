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
  /**
   * Pubkey authorized to sign agent actions on behalf of the owner.
   * Typically the LobsterPay service relayer (fetch from /v1/config/relayer).
   * If undefined, the on-chain program defaults to the owner (disables
   * agent delegation).
   */
  authorizedAgent?: PublicKey;
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

  // Args: allowed_actions(u64) + max_per_tx_amount_atomic(u64) + daily_limit_amount_atomic(u64) + max_slippage_bps(u16) + authorized_agent(Option<Pubkey>)
  const authorizedAgentBytes = params.authorizedAgent
    ? Buffer.concat([Buffer.from([1]), params.authorizedAgent.toBuffer()])
    : Buffer.from([0]);

  const args = Buffer.concat([
    u64LE(params.allowedActions),
    u64LE(params.maxPerTxAmountAtomic),
    u64LE(params.dailyLimitAmountAtomic),
    u16LE(params.maxSlippageBps),
    authorizedAgentBytes,
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

// ── read on-chain Policy account ────────────────────────────────────────

/**
 * Current on-chain state of a Policy account. Source of truth for allowlists
 * since those arrays are NOT stored in the backend DB. Offsets match the
 * Rust Policy struct layout (post-discriminator, so +8 for account prefix).
 */
export interface OnChainPolicy {
  vault: PublicKey;
  owner: PublicKey;
  authorizedAgent: PublicKey;
  paused: boolean;
  allowedActions: number;
  maxPerTxAmountAtomic: bigint;
  dailyLimitAmountAtomic: bigint;
  dailySpentAmountAtomic: bigint;
  maxSlippageBps: number;
  allowedMints: PublicKey[];
  allowedDestinations: PublicKey[];
  allowedExternalPrograms: PublicKey[];
}

/**
 * Fetch + parse the Policy PDA account. Returns null if it doesn't exist.
 * Use this whenever the UI needs to display the *actual* on-chain state
 * (especially allowlists, which the DB doesn't cache).
 */
export async function readPolicyOnChain(
  connection: Connection,
  policyPda: PublicKey
): Promise<OnChainPolicy | null> {
  const info = await connection.getAccountInfo(policyPda);
  if (!info) return null;
  const d = info.data;

  // Offsets (all after the 8-byte Anchor discriminator):
  //   vault                32   @   8
  //   owner                32   @  40
  //   authorized_agent     32   @  72
  //   paused               1    @ 104
  //   allowed_actions      8    @ 105
  //   max_per_tx           8    @ 113
  //   daily_limit          8    @ 121
  //   daily_spent          8    @ 129
  //   daily_window_start   8    @ 137
  //   max_slippage_bps     2    @ 145
  //   allowed_mints        256  @ 147  ([Pubkey; 8])
  //   allowed_mint_count   1    @ 403
  //   allowed_destinations 256  @ 404  ([Pubkey; 8])
  //   allowed_dest_count   1    @ 660
  //   allowed_ext_programs 128  @ 661  ([Pubkey; 4])
  //   allowed_ext_count    1    @ 789

  const mintCount = d[403];
  const destCount = d[660];
  const extCount = d[789];

  const readPubkeyArray = (baseOffset: number, count: number): PublicKey[] => {
    const out: PublicKey[] = [];
    for (let i = 0; i < count; i++) {
      out.push(new PublicKey(d.subarray(baseOffset + i * 32, baseOffset + (i + 1) * 32)));
    }
    return out;
  };

  return {
    vault: new PublicKey(d.subarray(8, 40)),
    owner: new PublicKey(d.subarray(40, 72)),
    authorizedAgent: new PublicKey(d.subarray(72, 104)),
    paused: d[104] === 1,
    allowedActions: Number(d.readBigUInt64LE(105)),
    maxPerTxAmountAtomic: d.readBigUInt64LE(113),
    dailyLimitAmountAtomic: d.readBigUInt64LE(121),
    dailySpentAmountAtomic: d.readBigUInt64LE(129),
    maxSlippageBps: d.readUInt16LE(145),
    allowedMints: readPubkeyArray(147, mintCount),
    allowedDestinations: readPubkeyArray(404, destCount),
    allowedExternalPrograms: readPubkeyArray(661, extCount),
  };
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
