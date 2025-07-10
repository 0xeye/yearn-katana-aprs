export interface TokenBreakdown {
  apr: number;
  token: {
    address: string;
    symbol: string;
    decimals: number;
  };
  weight: number;
}

export interface RewardCalculatorResult {
  poolAddress: string;
  tokenBreakdowns: Array<{
    poolAddress: string;
    breakdown: TokenBreakdown;
  }>;
}

export interface APRCalculator {
  calculateVaultAPRs(vaults: any[]): Promise<Record<string, RewardCalculatorResult[]>>;
}
