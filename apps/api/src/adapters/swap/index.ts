export interface SwapQuote {
  fromMint: string;
  toMint: string;
  amountIn: string;
  expectedOut: string;
  minOut: string;
  priceImpactPct: number;
  maxSlippageBps: number;
  expiresAt: string;
  routeSummary: string;
  rawQuote: any; // Provider-specific data needed to build the tx
}

export interface SwapAdapter {
  name: string;
  programId: string;
  getQuote(params: {
    fromMint: string;
    toMint: string;
    amountIn: string;
    maxSlippageBps: number;
  }): Promise<SwapQuote>;
  buildSwapTransaction(
    quote: SwapQuote,
    userPublicKey: string,
  ): Promise<{
    serializedTransaction: string;
    accounts: string[];
  }>;
  validateQuote(quote: SwapQuote): boolean;
}
