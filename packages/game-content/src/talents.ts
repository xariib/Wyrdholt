import type { TalentDef, TalentTreeDef } from "@emberbound/shared-types";

function branch(name: string, ...nodes: TalentDef[]): TalentTreeDef["branches"][number] {
  return { name, nodes };
}

export const TALENT_TREES: TalentTreeDef[] = [
  { classId: "warrior", branches: [
    branch("Bloodsteel",
      { id: "warrior_honed_edge", name: "Honed Edge", description: "+3 Attack.", stats: { attack: 3 } },
      { id: "warrior_find_weakness", name: "Find Weakness", description: "Direct hits ignore 15% of enemy armor.", mechanic: { kind: "armor_pierce", id: "talent_find_weakness", pierceBp: 1_500 } },
      { id: "warrior_headsman", name: "Headsman", description: "Direct hits deal +15% damage against targets at or below 35% HP.", mechanic: { kind: "execute", id: "talent_headsman", thresholdBp: 3_500, bonusBp: 1_500 } }),
    branch("Iron Guard",
      { id: "warrior_steel_plate", name: "Steel Plate", description: "+5 Armor.", stats: { armor: 5 } },
      { id: "warrior_hold_the_line", name: "Hold the Line", description: "+25 HP.", stats: { hp: 25 } },
      { id: "warrior_answering_blade", name: "Answering Blade", description: "After taking health damage, 25% chance to retaliate for 45% attack. 2s cooldown.", mechanic: { kind: "on_damaged_retaliate", id: "talent_answering_blade", chanceBp: 2_500, potencyBp: 4_500, damageType: "physical", cooldownMs: 2_000, appliesDots: 0 } }),
  ] },
  { classId: "monk", branches: [
    branch("Open Palm",
      { id: "monk_quick_hands", name: "Quick Hands", description: "+0.10 attacks per second.", stats: { attackRateMilli: 100 } },
      { id: "monk_centered_strike", name: "Centered Strike", description: "Every fifth hit adds a physical strike for 35% attack.", mechanic: { kind: "nth_hit_extra_damage", id: "talent_centered_strike", every: 5, potencyBp: 3_500, damageType: "physical" } },
      { id: "monk_watercourse", name: "Watercourse", description: "Every fourth hit grants +12% attack speed for 3s.", mechanic: { kind: "nth_hit_haste", id: "talent_watercourse", statusId: "watercourse", every: 4, hasteBp: 1_200, durationMs: 3_000 } }),
    branch("Still Mind",
      { id: "monk_rooted_stance", name: "Rooted Stance", description: "+15 HP and +2 Armor.", stats: { hp: 15, armor: 2 } },
      { id: "monk_healing_breath", name: "Healing Breath", description: "Every fifth hit heals 4% max HP. 5s cooldown.", mechanic: { kind: "nth_hit_heal", id: "talent_healing_breath", every: 5, potencyBp: 400, cooldownMs: 5_000 } },
      { id: "monk_empty_vessel", name: "Empty Vessel", description: "Every eighth hit heals 6% max HP. 6s cooldown.", mechanic: { kind: "nth_hit_heal", id: "talent_empty_vessel", every: 8, potencyBp: 600, cooldownMs: 6_000 } }),
  ] },
  { classId: "mage", branches: [
    branch("Pyromancy",
      { id: "mage_hot_coals", name: "Hot Coals", description: "+3 Attack and +2% Crit.", stats: { attack: 3, critBp: 200 } },
      { id: "mage_living_ember", name: "Living Ember", description: "20% chance on hit to ignite for 20% attack per second for 4s. One stack.", mechanic: { kind: "on_hit_dot", id: "talent_living_ember", statusId: "talent_ember_burn", chanceBp: 2_000, potencyBp: 2_000, tickMs: 1_000, durationMs: 4_000, maxStacks: 1 } },
      { id: "mage_solar_flare", name: "Solar Flare", description: "Every fifth attack deals 30% attack as magic damage to all living enemies.", mechanic: { kind: "nth_attack_splash", id: "talent_solar_flare", every: 5, potencyBp: 3_000, damageType: "magic" } }),
    branch("Abjuration",
      { id: "mage_woven_runes", name: "Woven Runes", description: "+20 HP and +1 Armor.", stats: { hp: 20, armor: 1 } },
      { id: "mage_glass_aegis", name: "Glass Aegis", description: "Start each fight with 7% max HP as ward. Ward cap 14%.", mechanic: { kind: "ward", id: "talent_glass_aegis", startBp: 700, every: 1, potencyBp: 0, capBp: 1_400 } },
      { id: "mage_rune_cycle", name: "Rune Cycle", description: "Every third attack adds 30% attack as ward, capped at 19% max HP.", mechanic: { kind: "ward", id: "talent_rune_cycle", startBp: 0, every: 3, potencyBp: 3_000, capBp: 1_900 } }),
  ] },
  { classId: "ranger", branches: [
    branch("Deadeye",
      { id: "ranger_steady_aim", name: "Steady Aim", description: "+3% Crit.", stats: { critBp: 300 } },
      { id: "ranger_bodkin", name: "Bodkin", description: "Direct hits ignore 18% of enemy armor.", mechanic: { kind: "armor_pierce", id: "talent_bodkin", pierceBp: 1_800 } },
      { id: "ranger_loose_twice", name: "Loose Twice", description: "Every fourth hit adds a physical strike for 40% attack.", mechanic: { kind: "nth_hit_extra_damage", id: "talent_loose_twice", every: 4, potencyBp: 4_000, damageType: "physical" } }),
    branch("Wildcraft",
      { id: "ranger_quick_feet", name: "Quick Feet", description: "+0.08 attacks per second and +10 HP.", stats: { attackRateMilli: 80, hp: 10 } },
      { id: "ranger_nightshade", name: "Nightshade", description: "25% chance on hit to poison for 15% attack per second for 4s. Two stacks.", mechanic: { kind: "on_hit_dot", id: "talent_nightshade", statusId: "nightshade", chanceBp: 2_500, potencyBp: 1_500, tickMs: 1_000, durationMs: 4_000, maxStacks: 2 } },
      { id: "ranger_thorn_volley", name: "Thorn Volley", description: "Every fourth attack also hits up to two other enemies for 35% attack each.", mechanic: { kind: "nth_attack_split", id: "talent_thorn_volley", every: 4, targets: 2, potencyBp: 3_500, damageType: "physical", appliesDots: 0 } }),
  ] },
];
