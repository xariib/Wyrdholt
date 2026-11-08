import type { SoloBossDef } from "@emberbound/shared-types";

export const SOLO_BOSSES: SoloBossDef[] = [
  {
    id: "ashen_king",
    name: "Ashen King",
    unlockZoneId: "ashen_mountains",
    attackRateMilli: 800,
    armor: 14,
    damageType: "physical",
    sprite: "warlord",
    tiers: [
      { hpBudget: 12_000, dpsBudget100: 1_500 },
      { hpBudget: 14_500, dpsBudget100: 1_650 },
      { hpBudget: 18_500, dpsBudget100: 1_900 },
      { hpBudget: 26_500, dpsBudget100: 2_380 },
      { hpBudget: 39_000, dpsBudget100: 3_160 },
    ],
  },
];
