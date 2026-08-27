import type { MoneyBoostConfig, PortableHolesBoostConfig } from "./boost-config.js";
import {
  playerBoostService,
  type BoostCharacter,
  type MoneyBoostInput,
  type MoneyBoostSuccess,
  type PlayerBoostService
} from "./player-boosts.js";
import {
  portableHoleBoostService,
  type PortableHoleBoostService,
  type PortableHolesInput,
  type PortableHolesMetadata,
  type PortableHolesSuccess
} from "./portable-hole-boost.js";

export interface BoostsOverview {
  characters: BoostCharacter[];
  money: MoneyBoostConfig;
  portableHoles: PortableHolesMetadata;
}

export interface BoostsServiceDependencies {
  money?: PlayerBoostService;
  portableHoles?: PortableHoleBoostService;
}

export class BoostsService {
  private readonly money: PlayerBoostService;
  private readonly portableHoles: PortableHoleBoostService;

  constructor(dependencies: BoostsServiceDependencies = {}) {
    this.money = dependencies.money ?? playerBoostService;
    this.portableHoles = dependencies.portableHoles ?? portableHoleBoostService;
  }

  readMoneyConfig(): MoneyBoostConfig {
    return this.money.readConfig();
  }

  readPortableHolesConfig(): PortableHolesBoostConfig {
    return this.portableHoles.readConfig();
  }

  async getOverview(accountId: number): Promise<BoostsOverview> {
    const [moneyOverview, portableHoles] = await Promise.all([
      this.money.getOverview(accountId),
      this.portableHoles.getMetadata(accountId)
    ]);
    return { ...moneyOverview, portableHoles };
  }

  requestMoney(accountId: number, input: MoneyBoostInput): Promise<MoneyBoostSuccess> {
    return this.money.requestMoney(accountId, input);
  }

  requestPortableHoles(
    accountId: number,
    input: PortableHolesInput
  ): Promise<PortableHolesSuccess> {
    return this.portableHoles.requestPortableHoles(accountId, input);
  }
}

export const boostsService = new BoostsService();
