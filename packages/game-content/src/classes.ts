import type { ClassDef, MasteryTrackDef } from "@emberbound/shared-types";
import { MASTERY_XP_STEPS } from "./progression";

/**
 * Class Mastery tracks and the class tree.
 * - Techniques and parameters: MASTERY_AUDIT.md.
 * - Mastery XP per rank: C1 pacing table (progression.ts).
 * - Base stats: PROVISIONAL.
 */

// ---------------------------------------------------------------------------
// Class Mastery (MASTERY_AUDIT: "What unlocks at each mastery")
// ---------------------------------------------------------------------------

const milestones = [1, 5, 10, 15, 20];

export const monkTrack: MasteryTrackDef = {
  id: "mastery_monk",
  maxRank: 20,
  milestones,
  foundationAttackBpPerRank: 250, // 2.5% of class base attack per rank above M1 (C1 retune; was 1.2%)
  xp: { steps: MASTERY_XP_STEPS },
  techniques: [
    {
      id: "monk_restoring_rhythm",
      name: "Restoring Rhythm",
      unlockRank: 1,
      // C1 class targets: 70% / 4 s -> 30% / 8 s (docs/reports/C1_CLASS_BALANCE.md).
      description: "Every third hit restores 30% attack as health. At most one heal per 8 seconds.",
      add: [{ kind: "nth_hit_heal", id: "restoring_rhythm", every: 3, potencyBp: 3_000, cooldownMs: 8_000 }],
    },
    {
      id: "monk_combo_strike",
      name: "Combo Strike",
      unlockRank: 5,
      description: "Every third hit adds a 60% attack combo.",
      add: [
        { kind: "nth_hit_extra_damage", id: "combo_strike", every: 3, potencyBp: 6_000, damageType: "physical" }, // C1 retune 70% -> 60%
      ],
    },
    {
      id: "monk_flow_state",
      name: "Flow State",
      unlockRank: 10,
      description: "Every ninth hit grants 30% haste for 4 seconds.",
      add: [
        { kind: "nth_hit_haste", id: "flow_state", every: 9, statusId: "flow", hasteBp: 3_000, durationMs: 4_000 }, // C1 retune 25% -> 30%
      ],
    },
    {
      id: "monk_practiced_rhythm",
      name: "Practiced Rhythm",
      unlockRank: 15,
      description: "Combo Strike potency rises to 95% attack. Flow grants 35% haste.",
      patch: [
        { mechanicId: "combo_strike", set: { potencyBp: 9_500 } },
        { mechanicId: "flow_state", set: { hasteBp: 3_500 } },
      ],
    },
    {
      id: "monk_flowing_combo",
      name: "Flowing Combo",
      unlockRank: 20,
      description: "Flow lasts 5 seconds. Third hits during Flow add a further 40% attack combo.",
      patch: [{ mechanicId: "flow_state", set: { durationMs: 5_000 } }],
      add: [
        {
          kind: "nth_hit_extra_damage",
          id: "flowing_combo",
          every: 3,
          potencyBp: 4_000,
          damageType: "physical",
          requiresStatus: "flow",
        },
      ],
    },
  ],
};

export const mageTrack: MasteryTrackDef = {
  id: "mastery_mage",
  maxRank: 20,
  milestones,
  foundationAttackBpPerRank: 250, // 2.5% of class base attack per rank above M1 (C1 retune; was 1.2%)
  xp: { steps: MASTERY_XP_STEPS },
  techniques: [
    {
      id: "mage_ignition",
      name: "Ignition",
      unlockRank: 1,
      description: "Fireballs apply Burn, up to 1 class stack.",
      // Burn tick values are PROVISIONAL.
      add: [
        {
          kind: "on_hit_dot",
          id: "ignition",
          statusId: "burn",
          chanceBp: 10_000,
          maxStacks: 1,
          tickMs: 1_000,
          durationMs: 4_000,
          potencyBp: 2_000,
        },
      ],
    },
    {
      id: "mage_arcane_ward",
      name: "Arcane Ward",
      unlockRank: 1,
      // C2 (roadmap 16 Sep 2026): the Mage's C1 extra HP/armor (130 + 13/level HP, +2 armor/level)
      // moves into this ward; the frailer base (100 + 10/level HP, +1 armor/level) plus the ward keeps
      // the Mage's C1 walls (docs/reports/C2_FOUR_CLASS.md). It scales with attack, so it grows with
      // gear, level and Mastery like the Mage's damage.
      description: "Every fourth spell adds 7% attack to a ward that absorbs damage before health, up to 20% max health. The ward fades after each fight.",
      add: [{ kind: "ward", id: "arcane_ward", startBp: 0, every: 4, potencyBp: 700, capBp: 2_000 }],
    },
    {
      id: "mage_wildfire",
      name: "Wildfire",
      unlockRank: 5,
      description: "Every fourth spell splashes all enemies.",
      // Splash potency: C1 class targets 50% -> 75%, C1 retune 75% -> 80% (the splash also hits the main target).
      add: [{ kind: "nth_attack_splash", id: "wildfire", every: 4, potencyBp: 8_000, damageType: "magic" }],
    },
    {
      id: "mage_spell_echo",
      name: "Spell Echo",
      unlockRank: 10,
      // C1 class targets: chance 28% -> 20%.
      description: "Attacks have a 20% chance to echo for 90% attack damage.",
      add: [{ kind: "on_hit_echo", id: "spell_echo", chanceBp: 2_000, potencyBp: 9_000, damageType: "magic" }],
    },
    {
      id: "mage_kindled_flame",
      name: "Kindled Flame",
      unlockRank: 15,
      description: "Class Burn reaches 2 stacks.",
      patch: [{ mechanicId: "ignition", set: { maxStacks: 2 } }],
    },
    {
      id: "mage_spellstorm",
      name: "Spellstorm",
      unlockRank: 20,
      // Echo 42% -> 30%, keeping the audit's 1.5x step over Spell Echo.
      description: "Wildfire triggers every third spell. Echo chance rises to 30%.",
      patch: [
        { mechanicId: "wildfire", set: { every: 3 } },
        { mechanicId: "spell_echo", set: { chanceBp: 3_000 } },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Warrior and Ranger (C2). Technique names and identities follow the migration spec.
// Numbers: C2 four-class calibration (22 Sep 2026) against the C1 retune zone budgets,
// which stay calibrated on Monk/Mage (docs/reports/C2_FOUR_CLASS.md). Earlier values
// from the C2 preparation are noted as "was".
// ---------------------------------------------------------------------------

export const warriorTrack: MasteryTrackDef = {
  id: "mastery_warrior",
  maxRank: 20,
  milestones,
  foundationAttackBpPerRank: 250, // 2.5% of class base attack per rank above M1 (C1 retune; was 1.2%)
  xp: { steps: MASTERY_XP_STEPS },
  techniques: [
    {
      id: "warrior_bleeding_strikes",
      name: "Bleeding Strikes",
      unlockRank: 1,
      description: "Every hit applies Bleed: 12% attack per second per stack for 5 seconds, up to 3 stacks per enemy.",
      add: [
        {
          kind: "on_hit_dot",
          id: "bleeding_strikes",
          statusId: "bleed",
          chanceBp: 10_000,
          maxStacks: 3,
          tickMs: 1_000,
          durationMs: 5_000,
          potencyBp: 1_200,
        },
      ],
    },
    {
      id: "warrior_retaliation",
      name: "Retaliation",
      unlockRank: 5,
      description: "When an enemy hits you, 35% chance to strike it back for 100% attack. At most once per second.",
      add: [
        {
          kind: "on_damaged_retaliate",
          id: "retaliation",
          chanceBp: 3_500,
          potencyBp: 10_000, // C2 calibration: was 60%
          damageType: "physical",
          cooldownMs: 1_000,
          appliesDots: 0,
        },
      ],
    },
    {
      id: "warrior_execute",
      name: "Execute",
      unlockRank: 10,
      description: "Your hits deal 40% more damage to enemies at or below 30% health.",
      add: [{ kind: "execute", id: "execute", thresholdBp: 3_000, bonusBp: 4_000 }], // C2 calibration: was +50%
    },
    {
      id: "warrior_deep_wounds",
      name: "Deep Wounds",
      unlockRank: 15,
      description: "Bleed stacks up to 5 and deals 14% attack per stack. Retaliation also applies Bleed.",
      patch: [
        { mechanicId: "bleeding_strikes", set: { maxStacks: 5, potencyBp: 1_400 } },
        { mechanicId: "retaliation", set: { appliesDots: 1 } },
      ],
    },
    {
      id: "warrior_relentless_finish",
      name: "Relentless Finish",
      unlockRank: 20,
      description: "Execute range rises to 35%. Every hit on an enemy in Execute range adds a 40% attack finishing blow.",
      patch: [{ mechanicId: "execute", set: { thresholdBp: 3_500 } }],
      add: [
        {
          kind: "nth_hit_extra_damage",
          id: "relentless_finish",
          every: 1,
          potencyBp: 4_000,
          damageType: "physical",
          requiresTargetHpBelowBp: 3_500,
        },
      ],
    },
  ],
};

export const rangerTrack: MasteryTrackDef = {
  id: "mastery_ranger",
  maxRank: 20,
  milestones,
  foundationAttackBpPerRank: 250, // 2.5% of class base attack per rank above M1 (C1 retune; was 1.2%)
  xp: { steps: MASTERY_XP_STEPS },
  techniques: [
    {
      id: "ranger_poisoned_shots",
      name: "Poisoned Shots",
      unlockRank: 1,
      description: "Every shot applies Poison: 14% attack per second per stack for 6 seconds, up to 4 stacks per enemy.",
      add: [
        {
          kind: "on_hit_dot",
          id: "poisoned_shots",
          statusId: "poison",
          chanceBp: 10_000,
          maxStacks: 4,
          tickMs: 1_000,
          durationMs: 6_000,
          potencyBp: 1_400, // C2 calibration: was 8%
        },
      ],
    },
    {
      id: "ranger_split_arrow",
      name: "Split Arrow",
      unlockRank: 5,
      description: "Every second shot also hits another enemy for 80% attack and poisons it.",
      add: [
        {
          kind: "nth_attack_split",
          id: "split_arrow",
          every: 2,
          targets: 1,
          potencyBp: 8_000, // C2 calibration: was 50%
          damageType: "physical",
          appliesDots: 1,
        },
      ],
    },
    {
      id: "ranger_piercing_shot",
      name: "Piercing Shot",
      unlockRank: 10,
      // C2 calibration: armor pierce alone was worth about +4% (C1 enemies have at most 16 armor),
      // so every third shot also strikes through for 100% attack. It works on single targets,
      // where Split Arrow does nothing (Elites, the Ashen Boss).
      description: "Your shots ignore 40% of enemy armor. Every third shot strikes through for an extra 100% attack.",
      add: [
        { kind: "armor_pierce", id: "piercing_shot", pierceBp: 4_000 },
        { kind: "nth_hit_extra_damage", id: "piercing_strike", every: 3, potencyBp: 10_000, damageType: "physical" },
      ],
    },
    {
      id: "ranger_lingering_hunt",
      name: "Lingering Hunt",
      unlockRank: 15,
      description: "Poison lasts 9 seconds and stacks up to 6. Split Arrow hits two other enemies.",
      patch: [
        { mechanicId: "poisoned_shots", set: { maxStacks: 6, durationMs: 9_000 } },
        { mechanicId: "split_arrow", set: { targets: 2 } },
      ],
    },
    {
      id: "ranger_venom_burst",
      name: "Venom Burst",
      unlockRank: 20,
      description: "A shot that brings an enemy to 6 Poison stacks bursts them: 4 seconds of that Poison at once.",
      add: [{ kind: "stack_burst", id: "venom_burst", statusId: "poison", minStacks: 6, potencyBp: 40_000 }],
    },
  ],
};

// ---------------------------------------------------------------------------
// Class tree. Base stats are PROVISIONAL.
// ---------------------------------------------------------------------------

export const CLASSES: ClassDef[] = [
  {
    id: "monk",
    name: "Monk",
    parentClassId: null,
    tier: 1,
    unlockRequirements: [],
    masteryTrackId: "mastery_monk",
    implemented: true,
    damageType: "physical",
    identity: ["Fast", "Combo", "Sustain"],
    tagline: "Discipline fuels inner strength.",
    // C1 class targets: hp 110 + 12/level -> 105 + 10/level.
    base: { hp: 105, attack: 10, armor: 3, attackRateMilli: 1_400, critBp: 500 },
    growth: { hp: 10, attack: 2, armor: 1 },
    sprite: "monk",
  },
  {
    id: "mage",
    name: "Mage",
    parentClassId: null,
    tier: 1,
    unlockRequirements: [],
    masteryTrackId: "mastery_mage",
    implemented: true,
    damageType: "magic",
    identity: ["Burn", "AoE", "Ward", "Spell procs"],
    tagline: "Knowledge shapes reality.",
    // C1 class targets (docs/reports/C1_CLASS_BALANCE.md): hp 92 + 9/level -> 130 + 13/level,
    // armor +0 -> +2/level. C2: the Mage is frailer than the Monk (100 + 10/level HP, +1 armor/level)
    // and its survivability comes from Arcane Ward (M1) instead.
    base: { hp: 100, attack: 14, armor: 2, attackRateMilli: 1_000, critBp: 500 },
    growth: { hp: 10, attack: 3, armor: 1 },
    sprite: "mage",
  },
  {
    id: "warrior",
    name: "Warrior",
    parentClassId: null,
    tier: 1,
    unlockRequirements: [],
    masteryTrackId: "mastery_warrior",
    implemented: true,
    damageType: "physical",
    identity: ["Bleed", "Retaliation", "Execute"],
    tagline: "Strike hard and finish what you start.",
    // C2 calibration: heavy hits and heavy armor (growth was hp 14, attack 2, armor 1). No sustain,
    // so its toughness is raw HP/armor, and Retaliation turns being hit into damage.
    base: { hp: 130, attack: 11, armor: 6, attackRateMilli: 900, critBp: 500 },
    growth: { hp: 16, attack: 3, armor: 2 },
    sprite: "warrior",
  },
  {
    id: "ranger",
    name: "Ranger",
    parentClassId: null,
    tier: 1,
    unlockRequirements: [],
    masteryTrackId: "mastery_ranger",
    implemented: true,
    damageType: "physical",
    identity: ["Crit", "Poison", "Multi-target", "Armor pierce"],
    tagline: "Find your mark in the wild.",
    // C2 calibration (was hp 100 + 10/level, attack 12, armor growth 0): a low start and more growth.
    // No sustain or defensive technique, so its toughness is raw HP/armor (below the Warrior's).
    base: { hp: 90, attack: 11, armor: 3, attackRateMilli: 1_150, critBp: 1_000 },
    growth: { hp: 17, attack: 2, armor: 2 },
    sprite: "ranger",
  },
];
