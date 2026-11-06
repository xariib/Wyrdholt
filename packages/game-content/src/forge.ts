import type { ForgeConfig } from "@emberbound/shared-types";
/** PROVISIONAL TEST economy. Separate versioned domain: does not change combat content hashes. */
export const FORGE_V1: ForgeConfig = {
  version: "wyrdholt-forge-content/1-test", provisional: true,
  rarities: ["common", "uncommon", "rare", "epic", "legendary"],
  recipes: {
    common: { count: 5, gold: 100, criticalBp: 500 },
    uncommon: { count: 5, gold: 300, criticalBp: 500 },
    rare: { count: 6, gold: 1200, criticalBp: 300 },
    epic: { count: 10, gold: 4000, criticalBp: 0 },
  },
  gates: [
    { zoneId: "greenfields", maxRarity: "rare" },
    { zoneId: "darkwood", maxRarity: "epic" },
    { zoneId: "ashen_mountains", maxRarity: "legendary" },
  ],
  outputPolicy: "uniform-catalog-by-slot-rarity",
};
