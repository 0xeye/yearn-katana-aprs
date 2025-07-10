import fs from 'fs/promises';
import _ from 'lodash';
import path from 'path';
import { config } from '../config';
import type { YearnVault } from '../types';
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
            const allResults = [...(sushiAPRs[vault.address] || []), ...(morphoAPRs[vault.address] || [])];

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

  private aggregateVaultResults(vault: YearnVault, results: RewardCalculatorResult[]): VaultAPRData {
    const uniquePoolAddresses = _.uniq(results.map((r) => r.poolAddress));

    const tokenBreakdowns = _.chain(results)
      .flatMap(({ tokenBreakdowns }) => tokenBreakdowns.map(({ breakdown }) => breakdown))
      .groupBy((breakdown) => breakdown.token.address.toLowerCase())
      .mapValues((group) =>
        group.reduce((acc, breakdown) => ({
          ...breakdown,
          apr: acc.apr + breakdown.apr,
          weight: acc.weight + breakdown.weight,
        }))
      )
      .values()
      .value();

    const totalWeight = _.sumBy(tokenBreakdowns, 'weight');
    const normalizedBreakdowns =
      totalWeight > 0 ? tokenBreakdowns.map((tb) => ({ ...tb, weight: tb.weight / totalWeight })) : tokenBreakdowns;

    const totalAPR = _.sumBy(normalizedBreakdowns, 'apr');

    return {
      name: vault.name,
      apr: totalAPR,
      pools: uniquePoolAddresses.length > 0 ? uniquePoolAddresses : undefined,
      breakdown: normalizedBreakdowns,
    };
  }
}
