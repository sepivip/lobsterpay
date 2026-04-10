export class LobsterPayError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "LobsterPayError";
  }
}

export function unauthorized(): LobsterPayError {
  return new LobsterPayError("Unauthorized", "UNAUTHORIZED", 401);
}

export function vaultPaused(): LobsterPayError {
  return new LobsterPayError("Vault is paused", "VAULT_PAUSED", 403);
}

export function actionNotAllowed(): LobsterPayError {
  return new LobsterPayError(
    "Action not allowed by policy",
    "ACTION_NOT_ALLOWED",
    403,
  );
}

export function mintNotAllowed(): LobsterPayError {
  return new LobsterPayError(
    "Mint not in allowed list",
    "MINT_NOT_ALLOWED",
    403,
  );
}

export function destinationNotAllowed(): LobsterPayError {
  return new LobsterPayError(
    "Destination not in allowed list",
    "DESTINATION_NOT_ALLOWED",
    403,
  );
}

export function amountExceedsLimit(type: "per_tx" | "daily"): LobsterPayError {
  const message =
    type === "per_tx"
      ? "Amount exceeds per-transaction limit"
      : "Amount exceeds daily limit";
  const code =
    type === "per_tx" ? "EXCEEDS_PER_TX_LIMIT" : "EXCEEDS_DAILY_LIMIT";
  return new LobsterPayError(message, code, 403);
}

export function idempotencyConflict(): LobsterPayError {
  return new LobsterPayError(
    "Idempotency key already used with different parameters",
    "IDEMPOTENCY_CONFLICT",
    409,
  );
}

export function invalidRequest(message: string): LobsterPayError {
  return new LobsterPayError(message, "INVALID_REQUEST", 400);
}

export function notFound(resource: string): LobsterPayError {
  return new LobsterPayError(
    `${resource} not found`,
    "NOT_FOUND",
    404,
  );
}

export function internalError(message: string): LobsterPayError {
  return new LobsterPayError(message, "INTERNAL_ERROR", 500);
}
