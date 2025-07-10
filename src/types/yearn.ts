export interface YearnStrategyDetails {
  totalDebt: string;
  totalGain: string;
  totalLoss: string;
  lastReport: number;
  performanceFee?: number;
  debtRatio?: number;
}

export interface YearnStrategy {
  address: string;
  name: string;
  status?: string;
  netAPR?: number;
  details?: YearnStrategyDetails;
}

export interface YearnVaultAPY {
  type: string;
  net_apy: number;
  staking_rewards_apr: number;
}

export interface YearnVaultTVL {
  totalAssets: string;
  tvl: number;
  price: number;
}

export interface YearnVaultToken {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  description?: string;
}

export interface YearnVault {
  address: string;
  symbol: string;
  name: string;
  chainId: number;
  strategies: YearnStrategy[];
  apy?: YearnVaultAPY;
  tvl?: YearnVaultTVL;
  token?: YearnVaultToken;
}
