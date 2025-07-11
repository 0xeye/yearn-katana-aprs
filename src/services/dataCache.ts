import fs from 'fs/promises';
import _ from 'lodash';
import path from 'path';
import { config } from '../config';
import type { YearnRewardToken, YearnVault } from '../types';
import { YearnApiService } from './api/yearnApi';
import { MorphoAprCalculator } from './aprs/morphoAprCalculator';
import { SteerAprCalculator } from './aprs/steerAprCalculator';
import { type RewardCalculatorResult, TokenBreakdown } from './aprs/types';

export interface VaultAPRData {
  name: string;
  apr: number;
  pools?: string[];
  breakdown: TokenBreakdown[];
}

export interface APRDataCache {
  [vaultAddress: string]: VaultAPRData;
}

export { TokenBreakdown };

export class DataCacheService {
  private cacheFilePath: string;
  private yearnApi: YearnApiService;
  private steerCalculator: SteerAprCalculator;
  private morphoCalculator: MorphoAprCalculator;

  constructor() {
    this.cacheFilePath = path.join(process.cwd(), 'vault-apr-data.json');
    this.yearnApi = new YearnApiService();
    this.steerCalculator = new SteerAprCalculator();
    this.morphoCalculator = new MorphoAprCalculator();
  }

  async generateVaultAPRData(): Promise<void> {
    try {
      // get all vaults
      const vaults: YearnVault[] = await this.yearnApi.getVaults(config.katanaChainId);

      // Get APR data from each calculator
      const [sushiAPRs, morphoAPRs] = await Promise.all([
        this.steerCalculator.calculateVaultAPRs(vaults),
        this.morphoCalculator.calculateVaultAPRs(vaults),
      ]);

      // Aggregate results for each vault
      const aprDataCache: APRDataCache = _.chain(vaults)
        .map((vault) => {
          try {
            // Flatten in case any results are arrays (should be flat arrays of objects)
            const allResults = [
              ...(Array.isArray(sushiAPRs[vault.address]) ? sushiAPRs[vault.address] : []),
              ...(Array.isArray(morphoAPRs[vault.address]) ? morphoAPRs[vault.address] : []),
            ].flat();

            if (allResults.length === 0) {
              return [
                vault.address,
                {
                  name: vault.name,
                  apr: 0,
                  pools: undefined,
                  breakdown: [],
                },
              ];
            }

            return [vault.address, this.aggregateVaultResults(vault, allResults)];
          } catch (error) {
            console.error(`Error processing vault ${vault.address}:`, error);
            return [
              vault.address,
              {
                name: vault.name,
                apr: 0,
                pools: undefined,
                breakdown: [],
              },
            ];
          }
        })
        .fromPairs()
        .value();

      await this.saveToFile(aprDataCache);
    } catch (error) {
      console.error('Error generating vault APR data:', error);
    }
  }

  async loadFromFile(): Promise<APRDataCache> {
    try {
      const data = await fs.readFile(this.cacheFilePath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Error loading APR data from file:', error);
      return {};
    }
  }

  private async saveToFile(data: APRDataCache): Promise<void> {
    try {
      await fs.writeFile(this.cacheFilePath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Error saving APR data to file:', error);
    }
  }

  async getVaultAPRData(vaultAddress: string): Promise<VaultAPRData | null> {
    const cache = await this.loadFromFile();
    return cache[vaultAddress] || null;
  }

  async getAllVaultAPRData(): Promise<APRDataCache> {
    return await this.loadFromFile();
  }

  private aggregateVaultResults(vault: YearnVault, results: RewardCalculatorResult[]): any {
    // Default FDV value
    const FDV = 1_000_000_000;

    // Calculate blended APR for the vault (katanaRewardsAPR)
    let totalApr = 0;
    let totalDebtRatio = 0;

    // Build new strategies array with appended data from results
    const newStrategies = (vault.strategies || []).map((strat) => {
      if (!strat.address || (strat.status && String(strat.status).toLowerCase() !== 'active')) {
        return strat;
      }
      const result = results.find(
        (r) => r.strategyAddress && r.strategyAddress.toLowerCase() === strat.address.toLowerCase()
      );

      let strategyRewardsAPR = 0;
      let rewardToken: YearnRewardToken | undefined = undefined;
      let underlyingContract = undefined;
      let assumedFDV = FDV;
      if (result && result.breakdown) {
        strategyRewardsAPR = result.breakdown.apr / 100;
        rewardToken = result.breakdown.token;
        underlyingContract = result.poolAddress;
        rewardToken.assumedFDV = FDV;
      }
      // Use debtRatio from strat.details if available
      const debtRatio = strat.details && typeof strat.details.debtRatio === 'number' ? strat.details.debtRatio : 0;
      totalApr += strategyRewardsAPR * (debtRatio / 10000);
      totalDebtRatio += debtRatio;
      return {
        ...strat,
        strategyRewardsAPR,
        rewardToken,
        underlyingContract,
        assumedFDV,
      };
    });

    // Compose the new vault object, only including fields from YearnVault type
    let newApr = vault.apr ? { ...vault.apr } : undefined;
    if (newApr) {
      if (!newApr.extra) newApr.extra = {};
      newApr.extra.katanaRewardsAPR = totalApr;
    }

    const newVault: YearnVault = {
      address: vault.address,
      symbol: vault.symbol,
      name: vault.name,
      chainId: vault.chainId,
      token: vault.token,
      tvl: vault.tvl,
      apr: newApr,
      strategies: newStrategies,
    };

    return newVault;
  }
}
