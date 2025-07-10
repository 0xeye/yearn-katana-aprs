import _ from 'lodash';
import type { YearnVault } from '../../types';
import { MerklApiService } from '../api/merklApi';
import { YearnApiService } from '../api/yearnApi';
import { ContractReaderService } from '../contractReader';
import type { APRCalculator, RewardCalculatorResult } from './types';

export class MorphoAprCalculator implements APRCalculator {
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
    const morphoOpportunities = await this.merklApi.getMorphoOpportunities();

    // all steer strategies from vaults
    const vaultStrategyPairs = vaults
      .map((vault) => ({
        vault,
        strategies: this.yearnApi.getActiveMorphoStrategies(vault),
      }))
      .filter(({ strategies }) => strategies.length > 0);

      const vaultToStrategies: Record<string, string[]> = _.chain(vaultStrategyPairs)
      .map(({ vault, strategies }) => [vault.address, strategies])
      .fromPairs()
      .value();

    const allSteerStrategies = _.flatten(Object.values(vaultToStrategies));

    // Get vaults for all strategies
    const strategyToVault = await this.contractReader.getMorphoVaultsFromStrategies(allSteerStrategies);

    // filter to whats needed for merkl

    // return


    console.log('Morpho reward calculation not yet implemented', strategyToVault);

    return {}
  }
}
