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
  strategyAddress: string;
  poolAddress: string;
  poolType: string; // e.g., 'morpho', 'steer'
  breakdown: TokenBreakdown;
}

export interface APRCalculator {
  calculateVaultAPRs(vaults: any[]): Promise<Record<string, RewardCalculatorResult[]>>;
}
