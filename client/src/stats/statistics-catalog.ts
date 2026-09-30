import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { StatisticPanelProps } from "./statistic-panel.js";

export type StatisticCategoryId =
  | "combat"
  | "deaths"
  | "progression"
  | "exploration"
  | "economy"
  | "pvp-bots";

export type StatisticPopulationMode = "event" | "all-characters" | "human-vs-bot";

export interface StatisticCategory {
  id: StatisticCategoryId;
  label: string;
  order: number;
}

export interface StatisticDefinition {
  slug: string;
  title: string;
  shortDescription: string;
  category: StatisticCategoryId;
  icon: string;
  keywords: readonly string[];
  populationMode: StatisticPopulationMode;
  component: LazyExoticComponent<ComponentType<StatisticPanelProps>>;
  order: number;
}

export const STATISTIC_CATEGORIES = [
  { id: "combat", label: "Combat", order: 10 },
  { id: "deaths", label: "Deaths & Danger", order: 20 },
  { id: "progression", label: "Progression", order: 30 },
  { id: "exploration", label: "Exploration", order: 40 },
  { id: "economy", label: "Economy", order: 50 },
  { id: "pvp-bots", label: "PvP & Bots", order: 60 }
] as const satisfies readonly StatisticCategory[];

export const STATISTICS_CATALOG = [
  {
    slug: "server-mvp",
    title: "Server MVP",
    shortDescription: "The characters with the most recorded boss killing blows.",
    category: "combat",
    icon: "🏆",
    keywords: ["boss", "kills", "creature", "raid"],
    populationMode: "event",
    component: lazy(() => import("../components/ServerMvpPanel.js").then((module) => ({ default: module.ServerMvpPanel }))),
    order: 10
  },
  {
    slug: "public-enemy",
    title: "Public Enemy #1",
    shortDescription: "Creature types responsible for the most recorded killing blows.",
    category: "combat",
    icon: "⚔️",
    keywords: ["creature", "enemy", "kills", "pet"],
    populationMode: "event",
    component: lazy(() => import("../components/PublicEnemyPanel.js").then((module) => ({ default: module.PublicEnemyPanel }))),
    order: 20
  },
  {
    slug: "most-deaths",
    title: "Most Deaths",
    shortDescription: "The characters with the highest recorded death totals.",
    category: "deaths",
    icon: "☠️",
    keywords: ["death", "character", "danger"],
    populationMode: "event",
    component: lazy(() => import("../components/DeathLeaderboardPanel.js").then((module) => ({ default: module.DeathLeaderboardPanel }))),
    order: 10
  },
  {
    slug: "bad-neighborhood",
    title: "Bad Neighborhood",
    shortDescription: "The zones where the most recorded deaths occurred.",
    category: "deaths",
    icon: "🗺️",
    keywords: ["zone", "location", "deadly", "danger"],
    populationMode: "event",
    component: lazy(() => import("../components/BadNeighborhoodPanel.js").then((module) => ({ default: module.BadNeighborhoodPanel }))),
    order: 20
  },
  {
    slug: "real-raid-boss",
    title: "The Real Raid Boss",
    shortDescription: "The creatures with the most recorded player killing blows.",
    category: "deaths",
    icon: "🐲",
    keywords: ["boss", "creature", "killer", "death"],
    populationMode: "event",
    component: lazy(() => import("../components/RealRaidBossPanel.js").then((module) => ({ default: module.RealRaidBossPanel }))),
    order: 30
  },
  {
    slug: "completionist",
    title: "Completionist",
    shortDescription: "The characters with the most recorded quest completions.",
    category: "progression",
    icon: "📜",
    keywords: ["quest", "completed", "leveling"],
    populationMode: "event",
    component: lazy(() => import("../components/CompletionistPanel.js").then((module) => ({ default: module.CompletionistPanel }))),
    order: 10
  },
  {
    slug: "touching-grass",
    title: "Touching Grass",
    shortDescription: "The characters active in the widest variety of zones.",
    category: "exploration",
    icon: "🌿",
    keywords: ["zone", "travel", "world", "activity", "map"],
    populationMode: "event",
    component: lazy(() => import("../components/TouchingGrassPanel.js").then((module) => ({ default: module.TouchingGrassPanel }))),
    order: 10
  },
  {
    slug: "vendor-trash-magnate",
    title: "Vendor Trash Magnate",
    shortDescription: "The current characters with the most lifetime vendor earnings.",
    category: "economy",
    icon: "💰",
    keywords: ["gold", "money", "sold", "vendor", "earnings"],
    populationMode: "all-characters",
    component: lazy(() => import("../components/VendorTrashMagnatePanel.js").then((module) => ({ default: module.VendorTrashMagnatePanel }))),
    order: 10
  },
  {
    slug: "bot-wrangler",
    title: "Bot Wrangler",
    shortDescription: "Human characters with the most recorded PvP kills against bots.",
    category: "pvp-bots",
    icon: "🤖",
    keywords: ["playerbot", "human", "victim", "pvp", "kills"],
    populationMode: "human-vs-bot",
    component: lazy(() => import("../components/BotWranglerPanel.js").then((module) => ({ default: module.BotWranglerPanel }))),
    order: 10
  }
] as const satisfies readonly StatisticDefinition[];

const categoryOrder = new Map(STATISTIC_CATEGORIES.map((category) => [category.id, category.order]));

export const ORDERED_STATISTICS: readonly StatisticDefinition[] = [...STATISTICS_CATALOG].sort((left, right) =>
  (categoryOrder.get(left.category) ?? Number.MAX_SAFE_INTEGER) -
    (categoryOrder.get(right.category) ?? Number.MAX_SAFE_INTEGER) ||
  left.order - right.order ||
  left.title.localeCompare(right.title) ||
  left.slug.localeCompare(right.slug)
);

export function getStatisticCategory(categoryId: StatisticCategoryId): StatisticCategory {
  const category = STATISTIC_CATEGORIES.find((candidate) => candidate.id === categoryId);
  if (!category) {
    throw new Error(`Unknown statistics category: ${categoryId}`);
  }
  return category;
}

export function getStatistic(slug: string | undefined): StatisticDefinition | undefined {
  return STATISTICS_CATALOG.find((statistic) => statistic.slug === slug);
}

export function validateStatisticsCatalog(): readonly string[] {
  const errors: string[] = [];
  const categoryIds = new Set(STATISTIC_CATEGORIES.map((category) => category.id));
  const slugs = new Set<string>();
  const titles = new Set<string>();

  for (const statistic of STATISTICS_CATALOG) {
    const normalizedTitle = statistic.title.toLocaleLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(statistic.slug)) errors.push(`Invalid slug: ${statistic.slug}`);
    if (slugs.has(statistic.slug)) errors.push(`Duplicate slug: ${statistic.slug}`);
    if (titles.has(normalizedTitle)) errors.push(`Duplicate title: ${statistic.title}`);
    if (!categoryIds.has(statistic.category)) errors.push(`Unknown category: ${statistic.category}`);
    if (!Number.isInteger(statistic.order)) errors.push(`Invalid order for ${statistic.slug}`);
    if (!["event", "all-characters", "human-vs-bot"].includes(statistic.populationMode)) {
      errors.push(`Invalid population mode for ${statistic.slug}`);
    }
    slugs.add(statistic.slug);
    titles.add(normalizedTitle);
  }

  return errors;
}
