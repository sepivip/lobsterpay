import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { Db } from "../db/client.js";
import type { Config } from "../config.js";
import { createVaultService } from "../services/vault.service.js";
import { createApiKeyService } from "../services/apiKey.service.js";
import { createApiKeySchema, updatePolicySchema } from "@lobsterpay/shared";

// TODO: Replace with proper wallet signature verification (e.g. verify ed25519 signed message)
function ownerAuth(db: Db) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const walletAddress = request.headers['x-wallet-address'] as string;
    if (!walletAddress) {
      return reply.status(401).send({ code: 'unauthorized', message: 'X-Wallet-Address header required' });
    }
    (request as any).ownerWallet = walletAddress;
  };
}

async function verifyVaultOwnership(db: Db, vaultId: string, walletAddress: string): Promise<boolean> {
  const rows = await db`SELECT owner_wallet FROM vaults WHERE id = ${vaultId}`;
  if (rows.length === 0) return false;
  return rows[0].owner_wallet === walletAddress;
}

export function vaultRoutes(app: FastifyInstance, db: Db, config: Config) {
  const vaultService = createVaultService(db, config);
  const apiKeyService = createApiKeyService(db);
  const ownerMiddleware = ownerAuth(db);

  // POST /v1/vaults
  app.post("/v1/vaults", async (request, reply) => {
    const { walletAddress } = request.body as { walletAddress: string };
    if (!walletAddress) {
      return reply.status(400).send({ code: "invalid_request", message: "walletAddress required" });
    }

    const result = await vaultService.createVault(walletAddress);
    return reply.status(result.isNew ? 201 : 200).send(result);
  });

  // GET /v1/vaults/:vaultId
  app.get("/v1/vaults/:vaultId", { preHandler: ownerMiddleware }, async (request, reply) => {
    const { vaultId } = request.params as { vaultId: string };
    const ownerWallet = (request as any).ownerWallet;

    const vault = await vaultService.getVault(vaultId);
    if (!vault) {
      return reply.status(404).send({ code: "not_found", message: "Vault not found" });
    }

    if (!(await verifyVaultOwnership(db, vaultId, ownerWallet))) {
      return reply.status(403).send({ code: "forbidden", message: "Wallet does not own this vault" });
    }

    return vault;
  });

  // GET /v1/vaults/by-owner/:walletAddress
  app.get("/v1/vaults/by-owner/:walletAddress", async (request, reply) => {
    const { walletAddress } = request.params as { walletAddress: string };
    const vault = await vaultService.getVaultByOwner(walletAddress);
    if (!vault) {
      return reply.status(404).send({ code: "not_found", message: "No vault for this owner" });
    }
    return vault;
  });

  // PATCH /v1/vaults/:vaultId/policy
  app.patch("/v1/vaults/:vaultId/policy", { preHandler: ownerMiddleware }, async (request, reply) => {
    const { vaultId } = request.params as { vaultId: string };
    const ownerWallet = (request as any).ownerWallet;

    if (!(await verifyVaultOwnership(db, vaultId, ownerWallet))) {
      return reply.status(403).send({ code: "forbidden", message: "Wallet does not own this vault" });
    }

    const parsed = updatePolicySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: "invalid_request", message: parsed.error.message });
    }
    await vaultService.updatePolicy(vaultId, parsed.data);
    return { success: true };
  });

  // POST /v1/vaults/:vaultId/api-keys
  app.post("/v1/vaults/:vaultId/api-keys", { preHandler: ownerMiddleware }, async (request, reply) => {
    const { vaultId } = request.params as { vaultId: string };
    const ownerWallet = (request as any).ownerWallet;

    if (!(await verifyVaultOwnership(db, vaultId, ownerWallet))) {
      return reply.status(403).send({ code: "forbidden", message: "Wallet does not own this vault" });
    }

    const parsed = createApiKeySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: "invalid_request", message: parsed.error.message });
    }
    const result = await apiKeyService.create(vaultId, parsed.data);
    return reply.status(201).send(result);
  });

  // POST /v1/vaults/:vaultId/api-keys/:keyId/revoke
  app.post("/v1/vaults/:vaultId/api-keys/:keyId/revoke", { preHandler: ownerMiddleware }, async (request, reply) => {
    const { vaultId, keyId } = request.params as { vaultId: string; keyId: string };
    const ownerWallet = (request as any).ownerWallet;

    if (!(await verifyVaultOwnership(db, vaultId, ownerWallet))) {
      return reply.status(403).send({ code: "forbidden", message: "Wallet does not own this vault" });
    }

    const result = await apiKeyService.revoke(vaultId, keyId);
    if (!result) {
      return reply.status(404).send({ code: "not_found", message: "Key not found or already revoked" });
    }
    return { success: true, revoked: result };
  });

  // GET /v1/vaults/:vaultId/api-keys
  app.get("/v1/vaults/:vaultId/api-keys", { preHandler: ownerMiddleware }, async (request, reply) => {
    const { vaultId } = request.params as { vaultId: string };
    const ownerWallet = (request as any).ownerWallet;

    if (!(await verifyVaultOwnership(db, vaultId, ownerWallet))) {
      return reply.status(403).send({ code: "forbidden", message: "Wallet does not own this vault" });
    }

    const keys = await apiKeyService.list(vaultId);
    return { items: keys };
  });

  // GET /v1/vaults/:vaultId/activity
  app.get("/v1/vaults/:vaultId/activity", { preHandler: ownerMiddleware }, async (request, reply) => {
    const { vaultId } = request.params as { vaultId: string };
    const ownerWallet = (request as any).ownerWallet;

    if (!(await verifyVaultOwnership(db, vaultId, ownerWallet))) {
      return reply.status(403).send({ code: "forbidden", message: "Wallet does not own this vault" });
    }

    const { cursor, limit } = (request.query as any) || {};
    const pageLimit = Math.min(Number(limit) || 50, 100);

    const rows = cursor
      ? await db`SELECT * FROM activities WHERE vault_id = ${vaultId} AND created_at < ${cursor} ORDER BY created_at DESC LIMIT ${pageLimit}`
      : await db`SELECT * FROM activities WHERE vault_id = ${vaultId} ORDER BY created_at DESC LIMIT ${pageLimit}`;

    return {
      items: rows,
      nextCursor: rows.length === pageLimit ? rows[rows.length - 1].created_at : null,
    };
  });
}
