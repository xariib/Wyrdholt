import type { EnemyArchetypeDef } from "@emberbound/shared-types";

/**
 * Enemy archetypes. Weights split a stage's shared HP and damage budgets;
 * attack rate sets each member's cadence; armor is per archetype.
 *
 * Names: Elder Root, Hollow Matron and Caldera Drake come from the Godot reports.
 * All other enemies are PROVISIONAL originals.
 */
export const ENEMIES: EnemyArchetypeDef[] = [
  // Greenfields
  { id: "meadow_slime", name: "Meadow Slime", hpWeight: 8, damageWeight: 7, attackRateMilli: 800, armor: 0, damageType: "physical", sprite: "slime" },
  { id: "bristle_boar", name: "Bristle Boar", hpWeight: 12, damageWeight: 10, attackRateMilli: 700, armor: 4, damageType: "physical", sprite: "boar" },
  { id: "field_wolf", name: "Field Wolf", hpWeight: 9, damageWeight: 11, attackRateMilli: 1_200, armor: 1, damageType: "physical", sprite: "wolf" },
  { id: "thornback_boar", name: "Thornback Boar", hpWeight: 14, damageWeight: 12, attackRateMilli: 750, armor: 8, damageType: "physical", sprite: "boar_elite" },
  { id: "elder_root", name: "Elder Root", hpWeight: 20, damageWeight: 14, attackRateMilli: 600, armor: 6, damageType: "magic", sprite: "root_boss" },
  { id: "sproutling", name: "Sproutling", hpWeight: 4, damageWeight: 5, attackRateMilli: 900, armor: 0, damageType: "magic", sprite: "sprout" },

  // Darkwood
  { id: "gloom_spider", name: "Gloom Spider", hpWeight: 7, damageWeight: 9, attackRateMilli: 1_300, armor: 1, damageType: "physical", sprite: "spider" },
  { id: "hollow_wisp", name: "Hollow Wisp", hpWeight: 6, damageWeight: 12, attackRateMilli: 900, armor: 0, damageType: "magic", sprite: "wisp" },
  { id: "barkhide_brute", name: "Barkhide Brute", hpWeight: 16, damageWeight: 11, attackRateMilli: 600, armor: 10, damageType: "physical", sprite: "brute" },
  { id: "thornwarden", name: "Thornwarden", hpWeight: 18, damageWeight: 13, attackRateMilli: 800, armor: 12, damageType: "physical", sprite: "warden" },
  { id: "hollow_matron", name: "Hollow Matron", hpWeight: 22, damageWeight: 14, attackRateMilli: 750, armor: 8, damageType: "magic", sprite: "matron" },
  { id: "matron_brood", name: "Matron's Brood", hpWeight: 4, damageWeight: 5, attackRateMilli: 1_100, armor: 0, damageType: "physical", sprite: "spider" },

  // Ashen Mountains
  { id: "cinder_imp", name: "Cinder Imp", hpWeight: 6, damageWeight: 10, attackRateMilli: 1_400, armor: 2, damageType: "magic", sprite: "imp" },
  { id: "ash_hound", name: "Ash Hound", hpWeight: 10, damageWeight: 12, attackRateMilli: 1_200, armor: 4, damageType: "physical", sprite: "hound" },
  { id: "basalt_golem", name: "Basalt Golem", hpWeight: 18, damageWeight: 12, attackRateMilli: 550, armor: 16, damageType: "physical", sprite: "golem" },
  { id: "ember_warlord", name: "Ember Warlord", hpWeight: 18, damageWeight: 14, attackRateMilli: 900, armor: 12, damageType: "physical", sprite: "warlord" },
  { id: "caldera_drake", name: "Caldera Drake", hpWeight: 26, damageWeight: 16, attackRateMilli: 700, armor: 14, damageType: "magic", sprite: "drake" },
];
