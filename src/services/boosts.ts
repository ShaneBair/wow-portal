import type { ArcaneTomeBoostConfig, MoneyBoostConfig, PortableHolesBoostConfig } from "./boost-config.js";
import {
  arcaneTomeBoostService,
  type ArcaneTomeBoostService,
  type ArcaneTomeInput,
  type ArcaneTomeMetadata,
  type ArcaneTomeSuccess
} from "./arcane-tome-boost.js";
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
  arcaneTome: ArcaneTomeMetadata;
}

export interface BoostsServiceDependencies {
  money?: PlayerBoostService;
  portableHoles?: PortableHoleBoostService;
  arcaneTome?: ArcaneTomeBoostService;
}

export class BoostsService {
  private readonly money: PlayerBoostService;
  private readonly portableHoles: PortableHoleBoostService;
  private readonly arcaneTome: ArcaneTomeBoostService;

  constructor(dependencies: BoostsServiceDependencies = {}) {
    this.money = dependencies.money ?? playerBoostService;
    this.portableHoles = dependencies.portableHoles ?? portableHoleBoostService;
    this.arcaneTome = dependencies.arcaneTome ?? arcaneTomeBoostService;
  }

  readMoneyConfig(): MoneyBoostConfig {
    return this.money.readConfig();
  }

  readPortableHolesConfig(): PortableHolesBoostConfig {
    return this.portableHoles.readConfig();
  }

  readArcaneTomeConfig(): ArcaneTomeBoostConfig {
    return this.arcaneTome.readConfig();
  }

  async getOverview(accountId: number): Promise<BoostsOverview> {
    const [moneyOverview, portableHoles, arcaneTome] = await Promise.all([
      this.money.getOverview(accountId),
      this.portableHoles.getMetadata(accountId),
      this.arcaneTome.getMetadata(accountId)
    ]);
    return { ...moneyOverview, portableHoles, arcaneTome };
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

  requestArcaneTome(accountId: number, input: ArcaneTomeInput): Promise<ArcaneTomeSuccess> {
    return this.arcaneTome.requestArcaneTome(accountId, input);
  }
}

export const boostsService = new BoostsService();
