import type { DungeonDef, RaidDef } from "@emberbound/shared-types";

const dungeons: DungeonDef[] = [{
  id: "briar_vault", name: "Briar Vault", unlockZoneId: "greenfields", rewardGold: 75, guildMarks: 20,
  waves: [
    { enemies: ["meadow_slime", "field_wolf", "meadow_slime"], hpBudget: 1_100, dpsBudget100: 780 },
    { enemies: ["field_wolf", "field_wolf", "field_wolf"], hpBudget: 1_600, dpsBudget100: 900 },
    { enemies: ["thornback_boar", "meadow_slime", "field_wolf"], hpBudget: 2_100, dpsBudget100: 1_100 },
  ],
}];

const raids: RaidDef[] = [{
  id: "cinder_breach", name: "Cinder Breach", durationMs: 3 * 24 * 60 * 60 * 1_000, rewardGold: 300,
  phases: [
    { enemies: ["ember_warlord", "field_wolf", "meadow_slime"], hpBudget: 10_000, dpsBudget100: 3_000, damageGoal100: 750_000, addGoal: 2 },
    { enemies: ["ember_warlord", "ash_hound", "ash_hound"], hpBudget: 18_000, dpsBudget100: 4_000, damageGoal100: 1_400_000, addGoal: 3 },
    { enemies: ["caldera_drake", "ash_hound", "basalt_golem"], hpBudget: 30_000, dpsBudget100: 5_000, damageGoal100: 2_000_000, addGoal: 4 },
  ],
}];

export const SOCIAL = { dungeons, raids };
