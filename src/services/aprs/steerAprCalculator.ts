import _ from 'lodash';
import { isAddressEqual } from 'viem';
import type { YearnVault } from '../../types';
import { MerklApiService } from '../api/merklApi';
import { YearnApiService } from '../api/yearnApi';
import { ContractReaderService } from '../contractReader';
import type { APRCalculator, RewardCalculatorResult } from './types';

export class SteerAprCalculator implements APRCalculator {
  private merklApi: MerklApiService;
  private yearnApi: YearnApiService;
  private contractReader: ContractReaderService;

  constructor() {
    this.merklApi = new MerklApiService();
    this.yearnApi = new YearnApiService();
    this.contractReader = new ContractReaderService();
  }

  async calculateVaultAPRs(vaults: YearnVault[]): Promise<Record<string, RewardCalculatorResult[]>> {
    // merkl
    const sushiOpportunities = await this.merklApi.getSushiOpportunities();

    // all steer strategies from vaults
    const vaultStrategyPairs = vaults
      .map((vault) => ({
        vault,
        strategies: this.yearnApi.getActiveSteerLPStrategies(vault),
      }))
      .filter(({ strategies }) => strategies.length > 0);

    const vaultToStrategies: Record<string, string[]> = _.chain(vaultStrategyPairs)
      .map(({ vault, strategies }) => [vault.address, strategies])
      .fromPairs()
      .value();

    const allSteerStrategies = _.flatten(Object.values(vaultToStrategies));

    // Get pool mappings for all strategies
    const strategyToPool = await this.contractReader.getSteerPoolsFromStrategies(allSteerStrategies);

    // Calculate APRs for each vault
    const resultEntries = _.chain(vaultStrategyPairs)
      .map(({ vault, strategies }) => {
        const vaultResults = strategies
          .map((strategy) => this.calculateStrategyAPR(strategy, strategyToPool, sushiOpportunities, vault))
          .filter((result): result is RewardCalculatorResult => result !== null);

        return vaultResults.length > 0 ? [vault.address, vaultResults] : null;
      })
      .compact()
      .value() as Array<[string, RewardCalculatorResult[]]>;

    return Object.fromEntries(resultEntries);
  }

  private calculateStrategyAPR(
    strategyAddress: string,
    strategyToPool: Record<string, string>,
    sushiOpportunities: any[],
    vault: YearnVault
  ): RewardCalculatorResult | null {
    const poolAddress = strategyToPool[strategyAddress.toLowerCase()];
    if (!poolAddress) return null;

    const opportunity = sushiOpportunities.find((opp) =>
      isAddressEqual(opp.identifier as `0x${string}`, poolAddress as `0x${string}`)
    );

    if (!opportunity?.campaigns?.length) {
      console.log(`No Sushi opportunity found for pool ${poolAddress}`);
      return null;
    }

    // Calculate campaign values
    const campaignData = _.chain(opportunity.campaigns)
      .map((campaign: any) => {
        if (!campaign.rewardToken || !campaign.amount) return null;
        const dailyValue = this.calculateDailyRewardValue(campaign);
        return { campaign, dailyValue };
      })
      .compact()
      .value() as Array<{ campaign: any; dailyValue: number }>;

    const totalDailyValue = campaignData.reduce((sum, { dailyValue }) => sum + dailyValue, 0);

    // Calculate vault's share of the pool TVL
    const vaultTotalAssets: number = vault.tvl?.totalAssets ? parseFloat(vault.tvl.totalAssets) : 0;
    const vaultTVL: number = vaultTotalAssets / 10 ** (vault.token?.decimals || 18);
    const vaultPositionTVL: number = vaultTVL;

    const tokenBreakdowns = campaignData.map(({ campaign, dailyValue }) => {
      const tokenWeight: number = totalDailyValue > 0 ? dailyValue / totalDailyValue : 0;
      const vaultDailyValue: number = dailyValue;
      const tokenAPR: number = vaultPositionTVL > 0 ? ((vaultDailyValue * 365) / vaultPositionTVL) * 100 : 0;

      return {
        poolAddress,
        breakdown: {
          apr: tokenAPR,
          token: {
            address: campaign.rewardToken.address,
            symbol: campaign.rewardToken.symbol,
            decimals: campaign.rewardToken.decimals,
          },
          weight: tokenWeight,
        },
      };
    });

    return { poolAddress, tokenBreakdowns };
  }

  private calculateDailyRewardValue(campaign: any): number {
    return !campaign.amount
      ? 0
      : (parseFloat(campaign.amount) / 10 ** (campaign.rewardToken?.decimals || 18)) *
          (campaign.rewardToken.price || 0);
  }
}
