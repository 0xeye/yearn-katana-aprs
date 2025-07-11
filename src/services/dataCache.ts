import fs from 'node:fs/promises';
import path from 'node:path';
import _ from 'lodash';
import { isAddressEqual } from 'viem';
import { config } from '../config';
import type { YearnVault } from '../types';
import { YearnApiService } from './api/yearnApi';
import { MorphoAprCalculator } from './aprs/morphoAprCalculator';
import { SushiAprCalculator } from './aprs/sushiAprCalculator';
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
  private sushiCalculator: SushiAprCalculator;
  private morphoCalculator: MorphoAprCalculator;

  constructor() {
    this.cacheFilePath = path.join(process.cwd(), 'vault-apr-data.json');
    this.yearnApi = new YearnApiService();
    this.sushiCalculator = new SushiAprCalculator();
    this.morphoCalculator = new MorphoAprCalculator();
  }

  async generateVaultAPRData(): Promise<void> {
    try {
      // get all vaults
      const vaults: YearnVault[] = await this.yearnApi.getVaults(config.katanaChainId);

      // Get APR data from each calculator
      const [sushiAPRs, morphoAPRs] = await Promise.all([
        this.sushiCalculator.calculateVaultAPRs(vaults),
        this.morphoCalculator.calculateVaultAPRs(vaults),
      ]);

      // Aggregate results for each vault
      const aprDataCache: APRDataCache = _.chain(vaults)
        .map((vault) => {
          try {
            const allResults = _.chain([sushiAPRs[vault.address], morphoAPRs[vault.address]])
              .flattenDeep()
              .compact()
              .value();

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

    // Build new strategies array with appended data from results
    const strategiesWithRewards = (vault.strategies || []).map((strat) => {
      if (!strat.address || strat.status?.toLowerCase() !== 'active') {
        return { strategy: strat, debtRatio: 0, strategyRewardsAPR: 0 };
      }

      const result = results.find((r) =>
        isAddressEqual(r.strategyAddress as `0x${string}`, strat.address as `0x${string}`)
      );

      const strategyData = result?.breakdown
        ? {
            strategyRewardsAPR: result.breakdown.apr / 100,
            rewardToken: { ...result.breakdown.token, assumedFDV: FDV },
            underlyingContract: result.poolAddress,
            assumedFDV: FDV,
          }
        : {
            strategyRewardsAPR: 0,
            rewardToken: undefined,
            underlyingContract: undefined,
            assumedFDV: FDV,
          };

      return {
        strategy: {
          ...strat,
          ...strategyData,
        },
        debtRatio: strat.details?.debtRatio ?? 0,
        strategyRewardsAPR: strategyData.strategyRewardsAPR,
      };
    });

    // Calculate totals using reduce
    const { totalApr, totalDebtRatio: _totalDebtRatio } = strategiesWithRewards.reduce(
      (acc, { debtRatio, strategyRewardsAPR }) => ({
        totalApr: acc.totalApr + strategyRewardsAPR * (debtRatio / 10000),
        totalDebtRatio: acc.totalDebtRatio + debtRatio,
      }),
      { totalApr: 0, totalDebtRatio: 0 }
    );

    const apr = vault.apr
      ? {
          ...vault.apr,
          extra: {
            ...(vault.apr.extra || {}),
            katanaRewardsAPR: totalApr,
          },
        }
      : undefined;

    const newVault: YearnVault = {
      address: vault.address,
      symbol: vault.symbol,
      name: vault.name,
      chainId: vault.chainId,
      token: vault.token,
      tvl: vault.tvl,
      apr,
      strategies: strategiesWithRewards.map(({ strategy }) => strategy),
    };

    return newVault;
  }
}
