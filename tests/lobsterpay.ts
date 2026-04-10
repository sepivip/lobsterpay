import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Lobsterpay } from "../target/types/lobsterpay";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { assert } from "chai";

describe("lobsterpay", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Lobsterpay as Program<Lobsterpay>;
  const owner = provider.wallet;

  let vaultPda: PublicKey;
  let vaultBump: number;
  let policyPda: PublicKey;
  let policyBump: number;

  // Token test fixtures
  let mint: PublicKey;
  let vaultTokenAccount: PublicKey;
  let destinationTokenAccount: PublicKey;
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

      // Verify vault account
      const vault = await program.account.vault.fetch(vaultPda);
      assert.ok(vault.owner.equals(owner.publicKey));
      assert.ok(vault.policy.equals(policyPda));
      assert.equal(vault.bump, vaultBump);
      assert.equal(vault.version, 1);

      // Verify policy account
      const policy = await program.account.policy.fetch(policyPda);
      assert.ok(policy.vault.equals(vaultPda));
      assert.ok(policy.owner.equals(owner.publicKey));
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
        // Expected: account already initialized
        assert.ok(err);
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
      // Unchanged fields
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
      // Add destination owner to allowlist
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
      // Airdrop SOL to non-owner for signing
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
        // has_one constraint should fail
        assert.ok(err.toString().includes("ConstraintHasOne") || err.toString().includes("2001") || err.toString().includes("A has one constraint"));
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
        assert.ok(err.toString().includes("MintAllowlistFull") || err.toString().includes("6115"));
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
      // Create a mint
      mint = await createMint(
        provider.connection,
        (owner as any).payer,
        owner.publicKey,
        null,
        6 // USDC-like decimals
      );

      // Derive the ATA for the vault
      const { PublicKey: PK } = await import("@solana/web3.js");
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

      // Verify ATA exists
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

      // Clear mint allowlist to allow all mints
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

    it("executes a payment within limits", async () => {
      const requestHash = Buffer.alloc(32);
      requestHash.write("test-payment-001");

      await program.methods
        .executePayExact({
          amount: new anchor.BN(500_000), // 0.5 USDC
          requestHash: Array.from(requestHash) as any,
        })
        .accounts({
          authority: owner.publicKey,
          vault: vaultPda,
          policy: policyPda,
          mint: mint,
          vaultTokenAccount: vaultTokenAccount,
          destinationTokenAccount: destinationTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      // Verify destination received funds
      const destInfo = await getAccount(provider.connection, destinationTokenAccount);
      assert.equal(Number(destInfo.amount), 500_000);

      // Verify daily spend tracked
      const policy = await program.account.policy.fetch(policyPda);
      assert.ok(policy.dailySpentAmountAtomic.eq(new anchor.BN(500_000)));
    });

    it("fails when paused", async () => {
      // Pause
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
            mint: mint,
            vaultTokenAccount: vaultTokenAccount,
            destinationTokenAccount: destinationTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        assert.fail("should have failed");
      } catch (err: any) {
        assert.ok(err.toString().includes("VaultPaused") || err.toString().includes("6101"));
      }

      // Unpause for subsequent tests
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
            amount: new anchor.BN(5_000_000), // 5 USDC > 2 USDC limit
            requestHash: Array.from(requestHash) as any,
          })
          .accounts({
            authority: owner.publicKey,
            vault: vaultPda,
            policy: policyPda,
            mint: mint,
            vaultTokenAccount: vaultTokenAccount,
            destinationTokenAccount: destinationTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        assert.fail("should have failed");
      } catch (err: any) {
        assert.ok(err.toString().includes("AmountExceedsPerTxLimit") || err.toString().includes("6106"));
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
            mint: mint,
            vaultTokenAccount: vaultTokenAccount,
            destinationTokenAccount: unauthorizedTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        assert.fail("should have failed");
      } catch (err: any) {
        assert.ok(err.toString().includes("DestinationNotAllowed") || err.toString().includes("6104"));
      }
    });

    it("fails when mint not in allowlist", async () => {
      // Set specific mint allowlist that doesn't include our test mint
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
            mint: mint,
            vaultTokenAccount: vaultTokenAccount,
            destinationTokenAccount: destinationTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        assert.fail("should have failed");
      } catch (err: any) {
        assert.ok(err.toString().includes("MintNotAllowed") || err.toString().includes("6103"));
      }

      // Reset mint allowlist to allow all
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
      // Disable pay action
      await program.methods
        .updatePolicy({
          paused: null,
          allowedActions: new anchor.BN(ACTION_SWAP_EXACT_IN), // only swap
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
            mint: mint,
            vaultTokenAccount: vaultTokenAccount,
            destinationTokenAccount: destinationTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        assert.fail("should have failed");
      } catch (err: any) {
        assert.ok(err.toString().includes("ActionNotAllowed") || err.toString().includes("6102"));
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
          amount: new anchor.BN(1_000_000), // 1 USDC
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
        // Non-owner can't derive the correct vault PDA
        const [fakeVault] = PublicKey.findProgramAddressSync(
          [Buffer.from("vault"), nonOwner.publicKey.toBuffer()],
          program.programId
        );

        await program.methods
          .withdrawOwner({
            amount: new anchor.BN(100_000),
          })
          .accounts({
            owner: nonOwner.publicKey,
            vault: vaultPda, // real vault owned by different person
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
        assert.ok(err.toString().includes("ConstraintHasOne") || err.toString().includes("2001") || err.toString().includes("A has one constraint") || err.toString().includes("seeds"));
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
        assert.ok(err.toString().includes("UnsupportedFeature") || err.toString().includes("6114"));
      }
    });
  });
});
