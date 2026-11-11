import type { ContentConfig, ContentSnapshot, RarityDef, RuleDef } from "@emberbound/shared-types";
import { SOLO_BOSSES } from "./bosses";
import { HUNTS } from "./hunts";
import { CLASSES, mageTrack, monkTrack, rangerTrack, warriorTrack } from "./classes";
import { ENEMIES } from "./enemies";
import { ITEMS, STARTER_ITEMS, STARTER_WEAPONS } from "./items";
import { LONG_TERM } from "./longTerm";
import { SOCIAL } from "./social";
import { LEVEL_XP_STEPS } from "./progression";
import { LOOT_TABLES, ZONES } from "./zones";

export { DEV_SAMPLE_ITEMS } from "./items";

/**
 * Emberbound content (data only).
 *
 * Values marked PROVISIONAL were not available from the supplied milestone reports
 * (the Godot content files were not accessible). Everything is data, so tuning
 * needs no game-core change.
 *
 * Sources:
 * - Mastery unlocks and parameters: MASTERY_AUDIT.md
 * - Run structure, recovery, caches: ADVENTURE_MILESTONE.md
 * - Loot rarity weights and item names: PROGRESSION_BALANCE.md
 * - Pacing (XP/mastery tables, budgets, drop chances): C1 design, docs/design/C1_ADVENTURE.md
 */

export const CONTENT_VERSION = "emberbound-content/0.6.0-class-gear";

const config: ContentConfig = {
  recoveryBp: 1_800, // 18% of max HP after non-final victories (ADVENTURE_MILESTONE)
  restMs: 1_200, // ordinary intermission (ZONE_RUNS)
  completionRestMs: 2_000,
  defeatRestMs: 6_000,
  maxFightMs: 120_000,
  offlineCapMs: 24 * 60 * 60 * 1_000, // a full day away is simulated (C1 retune, 21 Sep 2026; was 8 h)
  critMultiplierBp: 15_000,
  damageVarianceBp: 700, // +/-7% (MASTERY_AUDIT survival protocol)
  minDamage100: 100,
  heroFirstAttackMs: 450,
  enemyStaggerMs: 180,
  minAttackIntervalMs: 120,
  levelXp: { steps: LEVEL_XP_STEPS },
  maxCharacterLevel: 30,
  masteryStageBase10: 20, // round(2 + 0.4 x stage level) (ADVENTURE_MILESTONE)
  masteryStagePerLevel10: 4,
  masteryBossMultiplier: 3,
  notableOfflineMax: 3,
  // C1: stage drops scale down for victories shorter than 10 s (T2/T3: no loot floods
  // from farming trivial content). At-level normal fights last ~8–12 s.
  lootFullChanceMs: 10_000,
};

const rarities: RarityDef[] = [
  { id: "common", name: "Common", order: 0, color: "#b9b3a6", notable: false },
  { id: "uncommon", name: "Uncommon", order: 1, color: "#6fbf5a", notable: false },
  { id: "rare", name: "Rare", order: 2, color: "#4f8fe6", notable: true },
  { id: "epic", name: "Epic", order: 3, color: "#a45ee5", notable: true },
  { id: "legendary", name: "Legendary", order: 4, color: "#e8a13a", notable: true },
];

const rules: RuleDef[] = [
  { id: "test_enemy_hp_150", name: "Test: Hardy Foes", kind: "enemy_hp_bp", valueBp: 15_000, testOnly: true },
  { id: "test_enemy_soft", name: "Test: Soft Hits", kind: "enemy_damage_bp", valueBp: 100, testOnly: true },
  { id: "test_enemy_tough", name: "Test: Iron Hide", kind: "enemy_hp_bp", valueBp: 400_000, testOnly: true },
  {
    id: "test_windowed_embers",
    name: "Test: Windowed Embers",
    kind: "dot_damage_bp",
    valueBp: 20_000,
    testOnly: true,
    availability: { startMs: 1_000_000, endMs: 2_000_000 },
  },
];

export const CONTENT: ContentSnapshot = {
  hunts: HUNTS,
  contentVersion: CONTENT_VERSION,
  config,
  rarities,
  classes: CLASSES,
  masteryTracks: [monkTrack, mageTrack, warriorTrack, rangerTrack],
  items: ITEMS,
  enemies: ENEMIES,
  zones: ZONES,
  lootTables: LOOT_TABLES,
  rules,
  starterItems: STARTER_ITEMS,
  starterWeapons: STARTER_WEAPONS,
  soloBosses: SOLO_BOSSES,
  longTerm: LONG_TERM,
  social: SOCIAL,
};

export { FORGE_V1 } from "./forge";
