import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Lobsterpay } from "../target/types/lobsterpay";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { assert } from "chai";

// Must match constants.rs LOBSTERPAY_TREASURY
const TREASURY_PUBKEY = new PublicKey("DvcQMhZmhZZQ1CX6FhGkyAiPr3YtNbBuLDP3QpuBRTHp");
const SERVICE_FEE_BPS = 150n;
const BPS_DENOMINATOR = 10_000n;

function calcFee(gross: bigint): { fee: bigint; net: bigint } {
  const fee = (gross * SERVICE_FEE_BPS) / BPS_DENOMINATOR;
  return { fee, net: gross - fee };
}

describe("lobsterpay", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Lobsterpay as Program<Lobsterpay>;
  const owner = provider.wallet;

  let vaultPda: PublicKey;
  let vaultBump: number;
  let policyPda: PublicKey;
  let policyBump: number;
  let feeVaultPda: PublicKey;

  // Token fixtures
  let mint: PublicKey;
  let vaultTokenAccount: PublicKey;
  let destinationTokenAccount: PublicKey;
  let treasuryTokenAccount: PublicKey;
  const destinationOwner = Keypair.generate();

  const ACTION_SWAP_EXACT_IN = 1;
  const ACTION_PAY_EXACT = 2;
  const ACTION_X402_EXACT = 4;
  const ACTION_ALL = 7;

  before(async () => {
    // Derive PDAs
    [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), owner.publicKey.toBuffer()],
      program.programId
    );
    [policyPda, policyBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("policy"), vaultPda.toBuffer()],
      program.programId
    );
    [feeVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("fee_vault"), owner.publicKey.toBuffer()],
      program.programId
    );

    // Fund the treasury account on localnet so it can own a token account
    // (otherwise getOrCreateAssociatedTokenAccount for a non-existent owner fails)
    const airdropSig = await provider.connection.requestAirdrop(
      TREASURY_PUBKEY,
      LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig);
  });

  describe("initialize_vault", () => {
    it("creates vault and policy accounts", async () => {
      const tx = await program.methods
        .initializeVault({
          allowedActions: new anchor.BN(ACTION_ALL),
          maxPerTxAmountAtomic: new anchor.BN(1_000_000),
          dailyLimitAmountAtomic: new anchor.BN(10_000_000),
          maxSlippageBps: 100,
        })
        .accounts({
          owner: owner.publicKey,
          vault: vaultPda,
          policy: policyPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("initialize_vault tx:", tx);

      const vault = await program.account.vault.fetch(vaultPda);
      assert.ok(vault.owner.equals(owner.publicKey));
      assert.ok(vault.policy.equals(policyPda));
      assert.equal(vault.bump, vaultBump);
      assert.equal(vault.version, 1);

      const policy = await program.account.policy.fetch(policyPda);
      assert.ok(policy.vault.equals(vaultPda));
      assert.ok(policy.owner.equals(owner.publicKey));
      // Default authorized_agent should be owner
      assert.ok(policy.authorizedAgent.equals(owner.publicKey));
      assert.equal(policy.paused, false);
      assert.ok(policy.allowedActions.eq(new anchor.BN(ACTION_ALL)));
      assert.ok(policy.maxPerTxAmountAtomic.eq(new anchor.BN(1_000_000)));
      assert.ok(policy.dailyLimitAmountAtomic.eq(new anchor.BN(10_000_000)));
      assert.equal(policy.maxSlippageBps, 100);
      assert.equal(policy.allowedMintCount, 0);
      assert.equal(policy.allowedDestinationCount, 0);
      assert.equal(policy.allowedExternalProgramCount, 0);
    });

    it("fails when initializing vault twice", async () => {
      try {
        await program.methods
          .initializeVault({
            allowedActions: new anchor.BN(ACTION_ALL),
            maxPerTxAmountAtomic: new anchor.BN(1_000_000),
            dailyLimitAmountAtomic: new anchor.BN(10_000_000),
            maxSlippageBps: 100,
          })
          .accounts({
            owner: owner.publicKey,
            vault: vaultPda,
            policy: policyPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        assert.fail("should have failed");
      } catch (err) {
        assert.ok(err);
      }
    });
  });

  describe("initialize_fee_vault + deposit/withdraw", () => {
    it("initializes the fee vault PDA", async () => {
      await program.methods
        .initializeFeeVault()
        .accounts({
          owner: owner.publicKey,
          vault: vaultPda,
          feeVault: feeVaultPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const feeVault = await program.account.feeVault.fetch(feeVaultPda);
      assert.ok(feeVault.owner.equals(owner.publicKey));
      assert.ok(feeVault.vault.equals(vaultPda));
    });

    it("deposits SOL into the fee vault", async () => {
      const depositAmount = new anchor.BN(10_000_000); // 0.01 SOL

      const balanceBefore = await provider.connection.getBalance(feeVaultPda);

      await program.methods
        .depositFees({ amount: depositAmount })
        .accounts({
          owner: owner.publicKey,
          feeVault: feeVaultPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const balanceAfter = await provider.connection.getBalance(feeVaultPda);
      assert.equal(balanceAfter - balanceBefore, depositAmount.toNumber());
    });

    it("withdraws SOL from the fee vault", async () => {
      const withdrawAmount = new anchor.BN(1_000_000); // 0.001 SOL

      const vaultBefore = await provider.connection.getBalance(feeVaultPda);

      await program.methods
        .withdrawFees({ amount: withdrawAmount })
        .accounts({
          owner: owner.publicKey,
          feeVault: feeVaultPda,
        })
        .rpc();

      const vaultAfter = await provider.connection.getBalance(feeVaultPda);
      assert.equal(vaultBefore - vaultAfter, withdrawAmount.toNumber());
    });

    it("rejects withdraw that would break rent exemption", async () => {
      // Try to withdraw everything
      const allLamports = await provider.connection.getBalance(feeVaultPda);
      try {
        await program.methods
          .withdrawFees({ amount: new anchor.BN(allLamports) })
          .accounts({
            owner: owner.publicKey,
            feeVault: feeVaultPda,
          })
          .rpc();
        assert.fail("should have failed");
      } catch (err: any) {
        assert.ok(
          err.toString().includes("InsufficientFeeBalance") ||
          err.toString().includes("6120")
        );
      }
    });
  });

  describe("update_policy", () => {
    it("updates policy limits", async () => {
      await program.methods
        .updatePolicy({
          paused: null,
          allowedActions: null,
          maxPerTxAmountAtomic: new anchor.BN(2_000_000),
          dailyLimitAmountAtomic: new anchor.BN(20_000_000),
          maxSlippageBps: 200,
          allowedMints: null,
          allowedDestinations: null,
          allowedExternalPrograms: null,
        })
        .accounts({
          owner: owner.publicKey,
          vault: vaultPda,
          policy: policyPda,
        })
        .rpc();

      const policy = await program.account.policy.fetch(policyPda);
      assert.ok(policy.maxPerTxAmountAtomic.eq(new anchor.BN(2_000_000)));
      assert.ok(policy.dailyLimitAmountAtomic.eq(new anchor.BN(20_000_000)));
      assert.equal(policy.maxSlippageBps, 200);
      assert.ok(policy.allowedActions.eq(new anchor.BN(ACTION_ALL)));
      assert.equal(policy.paused, false);
    });

    it("updates allowed mints list", async () => {
      const fakeMint1 = Keypair.generate().publicKey;
      const fakeMint2 = Keypair.generate().publicKey;

      await program.methods
        .updatePolicy({
          paused: null,
          allowedActions: null,
          maxPerTxAmountAtomic: null,
          dailyLimitAmountAtomic: null,
          maxSlippageBps: null,
          allowedMints: [fakeMint1, fakeMint2],
          allowedDestinations: null,
          allowedExternalPrograms: null,
        })
        .accounts({
          owner: owner.publicKey,
          vault: vaultPda,
          policy: policyPda,
        })
        .rpc();

      const policy = await program.account.policy.fetch(policyPda);
      assert.equal(policy.allowedMintCount, 2);
      assert.ok(policy.allowedMints[0].equals(fakeMint1));
      assert.ok(policy.allowedMints[1].equals(fakeMint2));
    });

    it("updates allowed destinations list", async () => {
      await program.methods
        .updatePolicy({
          paused: null,
          allowedActions: null,
          maxPerTxAmountAtomic: null,
          dailyLimitAmountAtomic: null,
          maxSlippageBps: null,
          allowedMints: null,
          allowedDestinations: [destinationOwner.publicKey],
          allowedExternalPrograms: null,
        })
        .accounts({
          owner: owner.publicKey,
          vault: vaultPda,
          policy: policyPda,
        })
        .rpc();

      const policy = await program.account.policy.fetch(policyPda);
      assert.equal(policy.allowedDestinationCount, 1);
      assert.ok(policy.allowedDestinations[0].equals(destinationOwner.publicKey));
    });

    it("fails when non-owner tries to update", async () => {
      const nonOwner = Keypair.generate();
      const airdropSig = await provider.connection.requestAirdrop(
        nonOwner.publicKey,
        1_000_000_000
      );
      await provider.connection.confirmTransaction(airdropSig);

      try {
        await program.methods
          .updatePolicy({
            paused: true,
            allowedActions: null,
            maxPerTxAmountAtomic: null,
            dailyLimitAmountAtomic: null,
            maxSlippageBps: null,
            allowedMints: null,
            allowedDestinations: null,
            allowedExternalPrograms: null,
          })
          .accounts({
            owner: nonOwner.publicKey,
            vault: vaultPda,
            policy: policyPda,
          })
          .signers([nonOwner])
          .rpc();
        assert.fail("should have failed");
      } catch (err: any) {
        assert.ok(
          err.toString().includes("ConstraintHasOne") ||
          err.toString().includes("2001") ||
          err.toString().includes("A has one constraint")
        );
      }
    });

    it("rejects too many mints", async () => {
      const tooManyMints = Array.from({ length: 9 }, () => Keypair.generate().publicKey);

      try {
        await program.methods
          .updatePolicy({
            paused: null,
            allowedActions: null,
            maxPerTxAmountAtomic: null,
            dailyLimitAmountAtomic: null,
            maxSlippageBps: null,
            allowedMints: tooManyMints,
            allowedDestinations: null,
            allowedExternalPrograms: null,
          })
          .accounts({
            owner: owner.publicKey,
            vault: vaultPda,
            policy: policyPda,
          })
          .rpc();
        assert.fail("should have failed");
      } catch (err: any) {
        assert.ok(
          err.toString().includes("MintAllowlistFull") ||
          err.toString().includes("6115")
        );
      }
    });
  });

  describe("emergency_pause", () => {
    it("pauses the vault", async () => {
      await program.methods
        .emergencyPause()
        .accounts({
          owner: owner.publicKey,
          vault: vaultPda,
          policy: policyPda,
        })
        .rpc();

      const policy = await program.account.policy.fetch(policyPda);
      assert.equal(policy.paused, true);
    });

    it("unpause via update_policy", async () => {
      await program.methods
        .updatePolicy({
          paused: false,
          allowedActions: null,
          maxPerTxAmountAtomic: null,
          dailyLimitAmountAtomic: null,
          maxSlippageBps: null,
          allowedMints: null,
          allowedDestinations: null,
          allowedExternalPrograms: null,
        })
        .accounts({
          owner: owner.publicKey,
          vault: vaultPda,
          policy: policyPda,
        })
        .rpc();

      const policy = await program.account.policy.fetch(policyPda);
      assert.equal(policy.paused, false);
    });
  });

  describe("ensure_vault_token_account", () => {
    it("creates a token account for the vault", async () => {
      mint = await createMint(
        provider.connection,
        (owner as any).payer,
        owner.publicKey,
        null,
        6
      );

      const [ata] = PublicKey.findProgramAddressSync(
        [
          vaultPda.toBuffer(),
          TOKEN_PROGRAM_ID.toBuffer(),
          mint.toBuffer(),
        ],
        new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
      );
      vaultTokenAccount = ata;

      await program.methods
        .ensureVaultTokenAccount()
        .accounts({
          payer: owner.publicKey,
          vault: vaultPda,
          mint: mint,
          vaultTokenAccount: vaultTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const ataInfo = await getAccount(provider.connection, vaultTokenAccount);
      assert.ok(ataInfo.mint.equals(mint));
      assert.ok(ataInfo.owner.equals(vaultPda));
    });
  });

  describe("execute_pay_exact", () => {
    before(async () => {
      // Fund vault with tokens
      await mintTo(
        provider.connection,
        (owner as any).payer,
        mint,
        vaultTokenAccount,
        owner.publicKey,
        10_000_000 // 10 USDC
      );

      // Create destination token account
      destinationTokenAccount = await createAccount(
        provider.connection,
        (owner as any).payer,
        mint,
        destinationOwner.publicKey
      );

      // Create treasury ATA for this mint - treasury is a keypair owner
      treasuryTokenAccount = await createAccount(
        provider.connection,
        (owner as any).payer,
        mint,
        TREASURY_PUBKEY
      );

      // Clear mint allowlist, set destination allowlist
      await program.methods
        .updatePolicy({
          paused: null,
          allowedActions: null,
          maxPerTxAmountAtomic: null,
          dailyLimitAmountAtomic: null,
          maxSlippageBps: null,
          allowedMints: [],
          allowedDestinations: [destinationOwner.publicKey],
          allowedExternalPrograms: null,
        })
        .accounts({
          owner: owner.publicKey,
          vault: vaultPda,
          policy: policyPda,
        })
        .rpc();
    });

    it("executes a payment with 1.5% service fee", async () => {
      const requestHash = Buffer.alloc(32);
      requestHash.write("test-payment-001");

      const gross = 500_000n; // 0.5 USDC
      const { fee, net } = calcFee(gross);

      const treasuryBefore = (await getAccount(provider.connection, treasuryTokenAccount)).amount;

      await program.methods
        .executePayExact({
          amount: new anchor.BN(gross.toString()),
          requestHash: Array.from(requestHash) as any,
        })
        .accounts({
          authority: owner.publicKey,
          vault: vaultPda,
          policy: policyPda,
          feeVault: feeVaultPda,
          mint: mint,
          vaultTokenAccount: vaultTokenAccount,
          destinationTokenAccount: destinationTokenAccount,
          treasuryTokenAccount: treasuryTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      // Verify destination received NET amount (not gross)
      const destInfo = await getAccount(provider.connection, destinationTokenAccount);
      assert.equal(destInfo.amount.toString(), net.toString(), "destination got net");

      // Verify treasury received the fee
      const treasuryAfter = (await getAccount(provider.connection, treasuryTokenAccount)).amount;
      assert.equal((treasuryAfter - treasuryBefore).toString(), fee.toString(), "treasury got fee");

      // Daily spend tracks GROSS
      const policy = await program.account.policy.fetch(policyPda);
      assert.ok(policy.dailySpentAmountAtomic.eq(new anchor.BN(gross.toString())));
    });

    it("fails when paused", async () => {
      await program.methods
        .emergencyPause()
        .accounts({
          owner: owner.publicKey,
          vault: vaultPda,
          policy: policyPda,
        })
        .rpc();

      const requestHash = Buffer.alloc(32);
      requestHash.write("test-blocked-pause");

      try {
        await program.methods
          .executePayExact({
            amount: new anchor.BN(100_000),
            requestHash: Array.from(requestHash) as any,
          })
          .accounts({
            authority: owner.publicKey,
            vault: vaultPda,
            policy: policyPda,
            feeVault: feeVaultPda,
            mint: mint,
            vaultTokenAccount: vaultTokenAccount,
            destinationTokenAccount: destinationTokenAccount,
            treasuryTokenAccount: treasuryTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        assert.fail("should have failed");
      } catch (err: any) {
        assert.ok(
          err.toString().includes("VaultPaused") ||
          err.toString().includes("6101")
        );
      }

      // Unpause
      await program.methods
        .updatePolicy({
          paused: false,
          allowedActions: null,
          maxPerTxAmountAtomic: null,
          dailyLimitAmountAtomic: null,
          maxSlippageBps: null,
          allowedMints: null,
          allowedDestinations: null,
          allowedExternalPrograms: null,
        })
        .accounts({
          owner: owner.publicKey,
          vault: vaultPda,
          policy: policyPda,
        })
        .rpc();
    });

    it("fails when amount exceeds per-tx limit", async () => {
      const requestHash = Buffer.alloc(32);
      requestHash.write("test-blocked-pertx");

      try {
        await program.methods
          .executePayExact({
            amount: new anchor.BN(5_000_000), // > 2 USDC limit
            requestHash: Array.from(requestHash) as any,
          })
          .accounts({
            authority: owner.publicKey,
            vault: vaultPda,
            policy: policyPda,
            feeVault: feeVaultPda,
            mint: mint,
            vaultTokenAccount: vaultTokenAccount,
            destinationTokenAccount: destinationTokenAccount,
            treasuryTokenAccount: treasuryTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        assert.fail("should have failed");
      } catch (err: any) {
        assert.ok(
          err.toString().includes("AmountExceedsPerTxLimit") ||
          err.toString().includes("6106")
        );
      }
    });

    it("fails when destination not in allowlist", async () => {
      const unauthorizedDest = Keypair.generate();
      const unauthorizedTokenAccount = await createAccount(
        provider.connection,
        (owner as any).payer,
        mint,
        unauthorizedDest.publicKey
      );

      const requestHash = Buffer.alloc(32);
      requestHash.write("test-blocked-dest");

      try {
        await program.methods
          .executePayExact({
            amount: new anchor.BN(100_000),
            requestHash: Array.from(requestHash) as any,
          })
          .accounts({
            authority: owner.publicKey,
            vault: vaultPda,
            policy: policyPda,
            feeVault: feeVaultPda,
            mint: mint,
            vaultTokenAccount: vaultTokenAccount,
            destinationTokenAccount: unauthorizedTokenAccount,
            treasuryTokenAccount: treasuryTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        assert.fail("should have failed");
      } catch (err: any) {
        assert.ok(
          err.toString().includes("DestinationNotAllowed") ||
          err.toString().includes("6104")
        );
      }
    });

    it("fails when mint not in allowlist", async () => {
      const fakeMint = Keypair.generate().publicKey;
      await program.methods
        .updatePolicy({
          paused: null,
          allowedActions: null,
          maxPerTxAmountAtomic: null,
          dailyLimitAmountAtomic: null,
          maxSlippageBps: null,
          allowedMints: [fakeMint],
          allowedDestinations: null,
          allowedExternalPrograms: null,
        })
        .accounts({
          owner: owner.publicKey,
          vault: vaultPda,
          policy: policyPda,
        })
        .rpc();

      const requestHash = Buffer.alloc(32);
      requestHash.write("test-blocked-mint");

      try {
        await program.methods
          .executePayExact({
            amount: new anchor.BN(100_000),
            requestHash: Array.from(requestHash) as any,
          })
          .accounts({
            authority: owner.publicKey,
            vault: vaultPda,
            policy: policyPda,
            feeVault: feeVaultPda,
            mint: mint,
            vaultTokenAccount: vaultTokenAccount,
            destinationTokenAccount: destinationTokenAccount,
            treasuryTokenAccount: treasuryTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        assert.fail("should have failed");
      } catch (err: any) {
        assert.ok(
          err.toString().includes("MintNotAllowed") ||
          err.toString().includes("6103")
        );
      }

      // Reset mint allowlist
      await program.methods
        .updatePolicy({
          paused: null,
          allowedActions: null,
          maxPerTxAmountAtomic: null,
          dailyLimitAmountAtomic: null,
          maxSlippageBps: null,
          allowedMints: [],
          allowedDestinations: null,
          allowedExternalPrograms: null,
        })
        .accounts({
          owner: owner.publicKey,
          vault: vaultPda,
          policy: policyPda,
        })
        .rpc();
    });

    it("fails when action not allowed", async () => {
      await program.methods
        .updatePolicy({
          paused: null,
          allowedActions: new anchor.BN(ACTION_SWAP_EXACT_IN),
          maxPerTxAmountAtomic: null,
          dailyLimitAmountAtomic: null,
          maxSlippageBps: null,
          allowedMints: null,
          allowedDestinations: null,
          allowedExternalPrograms: null,
        })
        .accounts({
          owner: owner.publicKey,
          vault: vaultPda,
          policy: policyPda,
        })
        .rpc();

      const requestHash = Buffer.alloc(32);
      requestHash.write("test-blocked-action");

      try {
        await program.methods
          .executePayExact({
            amount: new anchor.BN(100_000),
            requestHash: Array.from(requestHash) as any,
          })
          .accounts({
            authority: owner.publicKey,
            vault: vaultPda,
            policy: policyPda,
            feeVault: feeVaultPda,
            mint: mint,
            vaultTokenAccount: vaultTokenAccount,
            destinationTokenAccount: destinationTokenAccount,
            treasuryTokenAccount: treasuryTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        assert.fail("should have failed");
      } catch (err: any) {
        assert.ok(
          err.toString().includes("ActionNotAllowed") ||
          err.toString().includes("6102")
        );
      }

      // Re-enable all actions
      await program.methods
        .updatePolicy({
          paused: null,
          allowedActions: new anchor.BN(ACTION_ALL),
          maxPerTxAmountAtomic: null,
          dailyLimitAmountAtomic: null,
          maxSlippageBps: null,
          allowedMints: null,
          allowedDestinations: null,
          allowedExternalPrograms: null,
        })
        .accounts({
          owner: owner.publicKey,
          vault: vaultPda,
          policy: policyPda,
        })
        .rpc();
    });

    it("unauthorized signer rejected even though they're a valid signer", async () => {
      const stranger = Keypair.generate();
      const airdropSig = await provider.connection.requestAirdrop(
        stranger.publicKey,
        LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(airdropSig);

      const requestHash = Buffer.alloc(32);
      requestHash.write("test-stranger");

      try {
        await program.methods
          .executePayExact({
            amount: new anchor.BN(100_000),
            requestHash: Array.from(requestHash) as any,
          })
          .accounts({
            authority: stranger.publicKey,
            vault: vaultPda,
            policy: policyPda,
            feeVault: feeVaultPda,
            mint: mint,
            vaultTokenAccount: vaultTokenAccount,
            destinationTokenAccount: destinationTokenAccount,
            treasuryTokenAccount: treasuryTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([stranger])
          .rpc();
        assert.fail("should have failed");
      } catch (err: any) {
        assert.ok(
          err.toString().includes("Unauthorized") ||
          err.toString().includes("6100")
        );
      }
    });
  });

  describe("update_authorized_agent", () => {
    it("owner sets an authorized agent and that agent can execute payments", async () => {
      const agent = Keypair.generate();
      const airdropSig = await provider.connection.requestAirdrop(
        agent.publicKey,
        LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(airdropSig);

      // Owner delegates to agent
      await program.methods
        .updateAuthorizedAgent({ newAgent: agent.publicKey })
        .accounts({
          owner: owner.publicKey,
          vault: vaultPda,
          policy: policyPda,
        })
        .rpc();

      const policy = await program.account.policy.fetch(policyPda);
      assert.ok(policy.authorizedAgent.equals(agent.publicKey));

      // Agent now executes a payment
      const requestHash = Buffer.alloc(32);
      requestHash.write("test-agent-pay");

      const gross = 200_000n;
      const { fee, net } = calcFee(gross);

      const destBefore = (await getAccount(provider.connection, destinationTokenAccount)).amount;
      const treasuryBefore = (await getAccount(provider.connection, treasuryTokenAccount)).amount;

      await program.methods
        .executePayExact({
          amount: new anchor.BN(gross.toString()),
          requestHash: Array.from(requestHash) as any,
        })
        .accounts({
          authority: agent.publicKey,
          vault: vaultPda,
          policy: policyPda,
          feeVault: feeVaultPda,
          mint: mint,
          vaultTokenAccount: vaultTokenAccount,
          destinationTokenAccount: destinationTokenAccount,
          treasuryTokenAccount: treasuryTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([agent])
        .rpc();

      const destAfter = (await getAccount(provider.connection, destinationTokenAccount)).amount;
      const treasuryAfter = (await getAccount(provider.connection, treasuryTokenAccount)).amount;

      assert.equal((destAfter - destBefore).toString(), net.toString());
      assert.equal((treasuryAfter - treasuryBefore).toString(), fee.toString());

      // Restore authorized_agent to owner
      await program.methods
        .updateAuthorizedAgent({ newAgent: owner.publicKey })
        .accounts({
          owner: owner.publicKey,
          vault: vaultPda,
          policy: policyPda,
        })
        .rpc();
    });
  });

  describe("withdraw_owner", () => {
    it("allows owner to withdraw tokens", async () => {
      const ownerTokenAccount = await createAccount(
        provider.connection,
        (owner as any).payer,
        mint,
        owner.publicKey
      );

      await program.methods
        .withdrawOwner({
          amount: new anchor.BN(1_000_000),
        })
        .accounts({
          owner: owner.publicKey,
          vault: vaultPda,
          policy: policyPda,
          mint: mint,
          vaultTokenAccount: vaultTokenAccount,
          destinationTokenAccount: ownerTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      const ownerInfo = await getAccount(provider.connection, ownerTokenAccount);
      assert.equal(Number(ownerInfo.amount), 1_000_000);
    });

    it("fails when non-owner tries to withdraw", async () => {
      const nonOwner = Keypair.generate();
      const airdropSig = await provider.connection.requestAirdrop(
        nonOwner.publicKey,
        1_000_000_000
      );
      await provider.connection.confirmTransaction(airdropSig);

      const nonOwnerToken = await createAccount(
        provider.connection,
        (owner as any).payer,
        mint,
        nonOwner.publicKey
      );

      try {
        await program.methods
          .withdrawOwner({
            amount: new anchor.BN(100_000),
          })
          .accounts({
            owner: nonOwner.publicKey,
            vault: vaultPda,
            policy: policyPda,
            mint: mint,
            vaultTokenAccount: vaultTokenAccount,
            destinationTokenAccount: nonOwnerToken,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([nonOwner])
          .rpc();
        assert.fail("should have failed");
      } catch (err: any) {
        assert.ok(
          err.toString().includes("ConstraintHasOne") ||
          err.toString().includes("2001") ||
          err.toString().includes("A has one constraint") ||
          err.toString().includes("seeds")
        );
      }
    });
  });

  describe("execute_swap_exact_in", () => {
    it("returns unsupported feature (Phase 3 stub)", async () => {
      const requestHash = Buffer.alloc(32);
      requestHash.write("test-swap-stub");

      try {
        await program.methods
          .executeSwapExactIn({
            amountIn: new anchor.BN(100_000),
            minAmountOut: new anchor.BN(90_000),
            slippageBps: 100,
            requestHash: Array.from(requestHash) as any,
          })
          .accounts({
            authority: owner.publicKey,
            vault: vaultPda,
            policy: policyPda,
          })
          .rpc();
        assert.fail("should have failed");
      } catch (err: any) {
        assert.ok(
          err.toString().includes("UnsupportedFeature") ||
          err.toString().includes("6114")
        );
      }
    });
  });
});
