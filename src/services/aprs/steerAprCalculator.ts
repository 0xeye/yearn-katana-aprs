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
      .map(({ vault, strategies }) => [vault.address.toLowerCase(), strategies])
      .fromPairs()
      .value();

    const allSteerStrategies = _.flatten(Object.values(vaultToStrategies)).map((addr) => addr.toLowerCase());

    // Get pool mappings for all strategies
    let strategyToPool = await this.contractReader.getSteerPoolsFromStrategies(allSteerStrategies);
    // Normalize all keys and values to lowercase for consistent lookup
    strategyToPool = Object.fromEntries(
      Object.entries(strategyToPool).map(([k, v]) => [k.toLowerCase(), v.toLowerCase()])
    );

    // Calculate APRs for each vault
    const resultEntries = _.chain(vaultStrategyPairs)
      .map(({ vault, strategies }) => {
        const vaultResults = strategies
          .map((strategy) => this.calculateStrategyAPR(strategy, strategyToPool, sushiOpportunities))
          .filter((result): result is RewardCalculatorResult[] => result !== null);

        return vaultResults.length > 0 ? [vault.address, vaultResults] : null;
      })
      .compact()
      .value() as Array<[string, RewardCalculatorResult[]]>;

    return Object.fromEntries(resultEntries);
  }

  private calculateStrategyAPR(
    strategyAddress: string,
    strategyToPool: Record<string, string>,
    sushiOpportunities: any[]
  ): RewardCalculatorResult[] | null {
    const poolAddress = strategyToPool[strategyAddress.toLowerCase()];
    if (!poolAddress) return null;

    const opportunity = sushiOpportunities.find((opp) =>
      isAddressEqual(opp.identifier as `0x${string}`, poolAddress as `0x${string}`)
    );

    if (!opportunity?.campaigns?.length) {
      console.log(`No Sushi opportunity found for pool ${poolAddress}`);
      return [
        {
          strategyAddress,
          poolAddress,
          poolType: 'morpho',
          breakdown: {
            apr: 0,
            token: {
              address: '',
              symbol: '',
              decimals: 0,
            },
            weight: 0,
          },
        },
      ];
    }

    // Find all campaigns with the specified rewardToken address
    const targetRewardTokenAddress = '0x6E9C1F88a960fE63387eb4b71BC525a9313d8461'.toLowerCase(); //wrapped KAT
    const targetCampaigns = opportunity.campaigns.filter(
      (campaign: any) =>
        campaign.rewardToken &&
        campaign.rewardToken.address &&
        campaign.rewardToken.address.toLowerCase() === targetRewardTokenAddress
    );

    let strategyAprValues: Array<{ apr: number; campaign: any }> = [];
    if (targetCampaigns.length > 0 && opportunity.aprRecord && Array.isArray(opportunity.aprRecord.breakdowns)) {
      for (const campaign of targetCampaigns) {
        const campaignId = campaign.campaignId;
        const aprBreakdown = opportunity.aprRecord.breakdowns.find(
          (b: any) => b.identifier && b.identifier.toLowerCase() === String(campaignId).toLowerCase()
        );
        if (aprBreakdown && typeof aprBreakdown.value === 'number') {
          strategyAprValues.push({ apr: aprBreakdown.value, campaign });
        }
      }
    }

    // Return all APR breakdowns for each matching campaign
    const tokenBreakdowns: RewardCalculatorResult[] = strategyAprValues.map(({ apr, campaign }) => ({
      strategyAddress,
      poolAddress,
      poolType: 'morpho',
      breakdown: {
        apr,
        token: {
          address: campaign.rewardToken.address,
          symbol: campaign.rewardToken.symbol,
          decimals: campaign.rewardToken.decimals,
        },
        weight: 0,
      },
    }));

    return tokenBreakdowns;
  }
}
