import type { SwapAdapter, SwapQuote } from "./index.js";

const JUPITER_API = "https://quote-api.jup.ag/v6";
const JUPITER_PROGRAM_ID = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";

export function createJupiterAdapter(): SwapAdapter {
  return {
    name: "jupiter",
    programId: JUPITER_PROGRAM_ID,

    async getQuote(params) {
      const url = new URL(`${JUPITER_API}/quote`);
      url.searchParams.set("inputMint", params.fromMint);
      url.searchParams.set("outputMint", params.toMint);
      url.searchParams.set("amount", params.amountIn);
      url.searchParams.set("slippageBps", String(params.maxSlippageBps));

      const res = await fetch(url.toString());
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Jupiter quote failed: ${err}`);
      }

      const data = await res.json();

      return {
        fromMint: params.fromMint,
        toMint: params.toMint,
        amountIn: params.amountIn,
        expectedOut: data.outAmount,
        minOut: data.otherAmountThreshold,
        priceImpactPct: parseFloat(data.priceImpactPct || "0"),
        maxSlippageBps: params.maxSlippageBps,
        expiresAt: new Date(Date.now() + 30_000).toISOString(), // 30s validity
        routeSummary: (data.routePlan || [])
          .map((r: any) => r.swapInfo?.label || "unknown")
          .join(" → "),
        rawQuote: data,
      };
    },

    async buildSwapTransaction(quote, userPublicKey) {
      const res = await fetch(`${JUPITER_API}/swap`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteResponse: quote.rawQuote,
          userPublicKey,
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: "auto",
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Jupiter swap build failed: ${err}`);
      }

      const data = await res.json();

      return {
        serializedTransaction: data.swapTransaction,
        accounts: [], // Jupiter handles accounts internally
      };
    },

    validateQuote(quote) {
      if (!quote.rawQuote) return false;
      if (BigInt(quote.expectedOut) <= 0n) return false;
      if (new Date(quote.expiresAt) < new Date()) return false;
      return true;
    },
  };
}
