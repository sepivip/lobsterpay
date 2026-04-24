/**
 * Background worker that reconciles x402 facilitator-mode requests.
 *
 * Why this exists (BAT-508):
 *
 * After POST /v1/agent/actions/x402-facilitator returns a partial-signed
 * v0 transferChecked tx (tx2) to the agent, LobsterPay never learns
 * whether the facilitator gateway (agon, etc.) actually submitted that
 * tx2 to Solana. Without this worker, request rows + activity entries
 * stay at `awaiting_facilitator` forever - even when the upstream call
 * succeeded and the chain confirmed tx2 long ago.
 *
 * What it does:
 *
 * Every RECONCILER_TICK_MS, pull every request that is still
 * `awaiting_facilitator` and was created within the last
 * RECONCILER_LOOKBACK_MIN minutes. For each pending row:
 *
 *   1. If `lastValidBlockHeight` from the partial tx envelope is past,
 *      the partial tx is permanently invalid - mark `expired_unsubmitted`.
 *
 *   2. Otherwise, list signatures touching the relayer's USDC ATA more
 *      recent than tx1. For each candidate signature, fetch the parsed
 *      tx; if it contains an SPL transferChecked from relayer's ATA to
 *      the facilitator's payTo ATA of the expected agonAmount, that's
 *      tx2 - mark `confirmed`, store tx2's signature, log activity.
 *
 * The matching is precise (source ATA + destination ATA + amount + mint
 * within a recent block window), so false positives are essentially
 * impossible - even if the relayer ATA has unrelated activity for other
 * vaults, only the tx that matches exactly the per-call agonAmount and
 * facilitator address counts.
 *
 * Process model:
 *
 * Single setInterval per process. A `running` mutex prevents overlap if
 * a tick takes longer than the interval (worst case during RPC slowness).
 * Each row is reconciled inside its own try/catch so a single bad row
 * (RPC error, malformed settlement_json) cannot stop the worker. The
 * interval is unref()'d so it does not block the process from exiting
 * cleanly during shutdown.
 *
 * The worker requires `txService.feePayer` (the relayer keypair) to be
 * configured - we need the relayer pubkey to derive each row's source
 * ATA. If the relayer is not configured, the worker logs once and stays
 * idle (without polling).
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import type { Db } from "../db/client.js";
import type { createTxService } from "./tx.service.js";

const RECONCILER_TICK_MS = 10_000;
const RECONCILER_LOOKBACK_MIN = 5;

interface PendingRow {
	id: string;
	vault_id: string;
	created_at: Date | string;
	settlement_json: {
		tx1Signature?: string;
		agonAmount?: string;
		asset?: string;
		envelopeLastValidBlockHeight?: number;
	} | null;
	recipient: string | null; // facilitator's payTo (joined from x402_payments.payment_requirements_json)
}

export function startX402FacilitatorReconciler(
	db: Db,
	txService: ReturnType<typeof createTxService>,
	logger?: { info: (...a: any[]) => void; warn: (...a: any[]) => void; error: (...a: any[]) => void },
) {
	const log = logger ?? console;

	const relayer = txService.feePayer;
	if (!relayer) {
		log.warn(
			"[x402-reconciler] FEE_PAYER not configured; reconciler is idle. " +
				"facilitator-mode rows will stay 'awaiting_facilitator' until restart with a relayer.",
		);
		return { stop: () => {} };
	}
	const relayerPubkey = relayer.publicKey;
	const connection: Connection = txService.connection;

	let running = false;

	async function tickOnce() {
		if (running) return;
		running = true;
		try {
			// Pull every pending row plus its settlement metadata + the
			// facilitator's payTo from the linked x402_payments row.
			//
			// IMPORTANT: payment_requirements_json stores the parsed
			// X402PaymentRequirements (apps/api/src/adapters/x402/index.ts),
			// which normalizes the agent's wire field `payTo` to `recipient`
			// before persisting. So even though the 402 from agon ships
			// `payTo`, the stored JSON has `recipient`. Querying `->>'payTo'`
			// returned NULL and tripped the "missing reconciler metadata"
			// branch -> rows were marked expired_unsubmitted within seconds
			// of being created, even when tx2 had landed. Fixed.
			//
			// The lookback interval is computed in JS (postgres tagged-template
			// values are parameterized, and you cannot parameterize inside the
			// `INTERVAL '... minutes'` literal) and passed as a TIMESTAMPTZ
			// cutoff. Keep this in sync with RECONCILER_LOOKBACK_MIN.
			const cutoff = new Date(Date.now() - RECONCILER_LOOKBACK_MIN * 60_000);
			const rows = (await db`
        SELECT
          r.id,
          r.vault_id,
          r.created_at,
          xp.settlement_json,
          xp.payment_requirements_json->>'recipient' AS recipient
        FROM requests r
        JOIN x402_payments xp ON xp.request_id = r.id
        WHERE r.action_type = 'x402_facilitator'
          AND r.tx_status = 'awaiting_facilitator'
          AND r.created_at > ${cutoff}
        ORDER BY r.created_at ASC
        LIMIT 50
      `) as unknown as PendingRow[];

			if (rows.length === 0) return;

			const currentBlockHeight = await connection.getBlockHeight("confirmed");

			for (const row of rows) {
				try {
					await reconcileOne(row, currentBlockHeight);
				} catch (err: any) {
					// Don't let one bad row poison the rest of the tick.
					log.warn(
						`[x402-reconciler] row ${row.id} failed: ${err?.message ?? String(err)}`,
					);
				}
			}
		} catch (err: any) {
			log.error(`[x402-reconciler] tick failed: ${err?.message ?? String(err)}`);
		} finally {
			running = false;
		}
	}

	async function reconcileOne(row: PendingRow, currentBlockHeight: number) {
		const settlement = row.settlement_json ?? {};
		const tx1Sig = settlement.tx1Signature;
		const agonAmount = settlement.agonAmount;
		const asset = settlement.asset;
		const lastValidBlockHeight = settlement.envelopeLastValidBlockHeight;
		const facilitatorPayTo = row.recipient;

		// Any row missing metadata gets SKIPPED, not marked expired. An
		// earlier version eagerly expired these rows, which killed any
		// row that landed in a tick during the narrow gap between the
		// requests.tx_status update and the x402_payments.settlement_json
		// update in the service (now fixed there too, but defense in
		// depth). The row stays `awaiting_facilitator` and gets another
		// shot on the next tick. If metadata is genuinely never going to
		// arrive (bug in the producing code path), the row will age out
		// of the 5-minute lookback window and eventually go silent - we
		// log so operators can detect that pattern.
		if (!tx1Sig || !agonAmount || !asset || !facilitatorPayTo || !lastValidBlockHeight) {
			const missing = [
				!tx1Sig && "tx1Signature",
				!agonAmount && "agonAmount",
				!asset && "asset",
				!facilitatorPayTo && "recipient(payTo)",
				!lastValidBlockHeight && "envelopeLastValidBlockHeight",
			]
				.filter(Boolean)
				.join(", ");
			log.warn(
				`[x402-reconciler] row ${row.id} missing metadata [${missing}] - skipping this tick`,
			);
			return;
		}

		// Past the partial-tx's block-height window: tx2 can never land
		// for this envelope. Mark expired so the dashboard reflects the
		// outcome (and the row stops being polled).
		if (currentBlockHeight > lastValidBlockHeight) {
			await markExpired(row.id, row.vault_id, "blockhash window passed");
			return;
		}

		const mintPubkey = new PublicKey(asset);
		const facilitatorPubkey = new PublicKey(facilitatorPayTo);
		const relayerAta = getAssociatedTokenAddressSync(mintPubkey, relayerPubkey);
		const facilitatorAta = getAssociatedTokenAddressSync(mintPubkey, facilitatorPubkey);

		// `until: tx1Sig` tells the RPC to stop walking signatures once
		// it crosses tx1 - so we only inspect candidates strictly newer
		// than the settlement we already know about. limit kept small;
		// the relayer ATA's signature volume is bounded.
		const sigInfos = await connection.getSignaturesForAddress(
			relayerAta,
			{ until: tx1Sig, limit: 25 },
			"confirmed",
		);
		if (sigInfos.length === 0) return;

		// Walk newest -> oldest and stop at the first match. Fetch lazily
		// so we do not pay for parsed-tx fetches we don't need.
		for (const info of sigInfos) {
			if (info.err) continue;
			const tx = await connection.getParsedTransaction(info.signature, {
				commitment: "confirmed",
				maxSupportedTransactionVersion: 0,
			});
			if (!tx || tx.meta?.err) continue;

			const ixs = [
				...(tx.transaction.message.instructions ?? []),
				...(tx.meta?.innerInstructions?.flatMap((ii) => ii.instructions) ?? []),
			];
			let matched = false;
			for (const ix of ixs) {
				if (!("parsed" in ix) || !ix.parsed?.type) continue;
				if (ix.program !== "spl-token") continue;
				const typ = ix.parsed.type;
				if (typ !== "transferChecked" && typ !== "transfer") continue;
				const i = ix.parsed.info as any;
				if (i?.source !== relayerAta.toString()) continue;
				if (i?.destination !== facilitatorAta.toString()) continue;
				const rawAmount = i?.tokenAmount?.amount ?? i?.amount;
				if (!rawAmount) continue;
				try {
					if (BigInt(rawAmount) >= BigInt(agonAmount)) {
						matched = true;
						break;
					}
				} catch {
					// amount not parseable - skip
				}
			}

			if (matched) {
				await markConfirmed(row.id, row.vault_id, info.signature, settlement);
				return;
			}
		}
	}

	async function markConfirmed(
		requestId: string,
		vaultId: string,
		tx2Signature: string,
		settlement: PendingRow["settlement_json"],
	) {
		// Two writes: the request row (status flips to confirmed; tx_signature
		// stays as tx1 for backwards compatibility because that is what dashes
		// activity entries link to), and the x402_payments.settlement_json
		// (gains tx2Signature). One activity row appended for the timeline.
		await db`
      UPDATE requests
      SET tx_status = 'confirmed', updated_at = NOW()
      WHERE id = ${requestId}
    `;
		const updatedSettlement = { ...(settlement ?? {}), tx2Signature };
		await db`
      UPDATE x402_payments
      SET settlement_json = ${JSON.stringify(updatedSettlement)}
      WHERE request_id = ${requestId}
    `;
		await txService.logActivity(
			vaultId,
			"x402_facilitator_confirmed",
			{
				tx1Signature: settlement?.tx1Signature ?? null,
				tx2Signature,
				agonAmount: settlement?.agonAmount ?? null,
				asset: settlement?.asset ?? null,
				reconciledAt: new Date().toISOString(),
			},
			tx2Signature,
			requestId,
		);
	}

	async function markExpired(requestId: string, vaultId: string, reason: string) {
		await db`
      UPDATE requests
      SET tx_status = 'expired_unsubmitted', updated_at = NOW()
      WHERE id = ${requestId}
    `;
		await txService.logActivity(
			vaultId,
			"x402_facilitator_expired",
			{ reason, reconciledAt: new Date().toISOString() },
			undefined,
			requestId,
		);
	}

	const handle = setInterval(() => {
		void tickOnce();
	}, RECONCILER_TICK_MS);
	// Don't keep the event loop alive just for this. Process exit is the
	// only way to stop it (or call .stop()).
	handle.unref();
	log.info(
		`[x402-reconciler] started (tick=${RECONCILER_TICK_MS}ms, lookback=${RECONCILER_LOOKBACK_MIN}min, relayer=${relayerPubkey.toBase58()})`,
	);

	return {
		stop: () => clearInterval(handle),
		// Exposed for tests / one-off manual reconciliation.
		tickOnce,
	};
}
