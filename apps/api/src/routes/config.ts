import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import type { createTxService } from "../services/tx.service.js";

type TxService = ReturnType<typeof createTxService>;

/**
 * Public service-config endpoints.
 *
 * The only field exposed today is the LobsterPay relayer pubkey - the
 * service-wide hot wallet that signs and submits agent transactions.
 * Frontend reads this to pre-configure new vaults with
 * `authorized_agent = relayer_pubkey`, so users never see or manage a
 * separate fee-payer keypair. The vault's on-chain fee_vault PDA
 * reimburses the relayer's lamports after each agent action.
 */
export function configRoutes(app: FastifyInstance, txService: TxService, _config: Config) {
	app.get("/v1/config/relayer", async () => {
		if (!txService.feePayer) {
			return {
				configured: false,
				pubkey: null,
				note: "Service relayer is not configured on this deployment. Agent actions will fail until FEE_PAYER_SECRET_KEY is set.",
			};
		}
		return {
			configured: true,
			pubkey: txService.feePayer.publicKey.toBase58(),
		};
	});
}
