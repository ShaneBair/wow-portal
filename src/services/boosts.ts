import type { ArcaneTomeBoostConfig, CharacterLevelBoostConfig, FlightPathsBoostConfig, ItemDeliveryBoostConfig, MoneyBoostConfig, PortableHolesBoostConfig } from "./boost-config.js";
import {
  characterLevelBoostService,
  type CharacterLevelBoostService,
  type CharacterLevelInput,
  type CharacterLevelMetadata,
  type CharacterLevelSuccess
} from "./character-level-boost.js";
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
import {
  itemDeliveryService,
  type ItemDeliveryInput,
  type ItemDeliveryMetadata,
  type ItemDeliveryPreview,
  type ItemDeliveryService,
  type ItemDeliverySuccess
} from "./item-delivery.js";
import {
  flightPathBoostService,
  type FlightPathBoostService,
  type FlightPathInput,
  type FlightPathsMetadata,
  type FlightPathSuccess
} from "./flight-path-boost.js";

export interface BoostsOverview {
  characters: BoostCharacter[];
  money: MoneyBoostConfig;
  portableHoles: PortableHolesMetadata;
  arcaneTome: ArcaneTomeMetadata;
  characterLevel: CharacterLevelMetadata;
  itemDelivery: ItemDeliveryMetadata;
  flightPaths: FlightPathsMetadata;
}

export interface BoostsServiceDependencies {
  money?: PlayerBoostService;
  portableHoles?: PortableHoleBoostService;
  arcaneTome?: ArcaneTomeBoostService;
  characterLevel?: CharacterLevelBoostService;
  itemDelivery?: ItemDeliveryService;
  flightPaths?: FlightPathBoostService;
}

export class BoostsService {
  private readonly money: PlayerBoostService;
  private readonly portableHoles: PortableHoleBoostService;
  private readonly arcaneTome: ArcaneTomeBoostService;
  private readonly characterLevel: CharacterLevelBoostService;
  private readonly itemDelivery: ItemDeliveryService;
  private readonly flightPaths: FlightPathBoostService;

  constructor(dependencies: BoostsServiceDependencies = {}) {
    this.money = dependencies.money ?? playerBoostService;
    this.portableHoles = dependencies.portableHoles ?? portableHoleBoostService;
    this.arcaneTome = dependencies.arcaneTome ?? arcaneTomeBoostService;
    this.characterLevel = dependencies.characterLevel ?? characterLevelBoostService;
    this.itemDelivery = dependencies.itemDelivery ?? itemDeliveryService;
    this.flightPaths = dependencies.flightPaths ?? flightPathBoostService;
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

  readCharacterLevelConfig(): CharacterLevelBoostConfig {
    return this.characterLevel.readConfig();
  }

  readItemDeliveryConfig(): ItemDeliveryBoostConfig {
    return this.itemDelivery.readConfig();
  }

  readFlightPathsConfig(): FlightPathsBoostConfig { return this.flightPaths.readConfig(); }

  async getOverview(accountId: number): Promise<BoostsOverview> {
    const [moneyOverview, portableHoles, arcaneTome, characterLevel, itemDelivery, flightPaths] = await Promise.all([
      this.money.getOverview(accountId),
      this.portableHoles.getMetadata(accountId),
      this.arcaneTome.getMetadata(accountId),
      this.characterLevel.getMetadata(accountId),
      this.itemDelivery.getMetadata(accountId),
      this.flightPaths.getMetadata()
    ]);
    return { ...moneyOverview, portableHoles, arcaneTome, characterLevel, itemDelivery, flightPaths };
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

  requestCharacterLevel(accountId: number, input: CharacterLevelInput): Promise<CharacterLevelSuccess> {
    return this.characterLevel.requestCharacterLevel(accountId, input);
  }

  lookupItem(itemId: number): Promise<ItemDeliveryPreview | undefined> {
    return this.itemDelivery.lookupItem(itemId);
  }

  requestItemDelivery(accountId: number, input: ItemDeliveryInput): Promise<ItemDeliverySuccess> {
    return this.itemDelivery.requestItem(accountId, input);
  }

  requestFlightPaths(accountId: number, input: FlightPathInput): Promise<FlightPathSuccess> {
    return this.flightPaths.requestFlightPaths(accountId, input);
  }
}

export const boostsService = new BoostsService();
