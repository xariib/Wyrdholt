/**
 * Shared types for Emberbound.
 *
 * NUMBER CONVENTIONS (authoritative data):
 * - Every number in content, snapshots, saves and combat events is a safe integer.
 * - `...Bp` values are basis points: 10000 = 100%.
 * - `...100` values are hundredths (HP and damage are stored as HP x 100).
 * - `...Milli` values are thousandths (attack rate 1450 = 1.45 attacks per second).
 * - `...Ms` values are integer milliseconds on the simulation clock.
 *
 * See docs/technical/DETERMINISM.md.
 */

export type Id = string;

/** Basis points. 10000 = 100%. */
export type Bp = number;

export type SlotId = "weapon" | "head" | "chest" | "gloves" | "boots" | "ring";

export const SLOT_ORDER: readonly SlotId[] = ["weapon", "head", "chest", "gloves", "boots", "ring"];

export type DamageType = "physical" | "magic";

/** Optional availability window for time-limited content (seasons, events). `null` = open-ended. */
export interface TimeWindow {
  startMs: number | null;
  endMs: number | null;
}

// ---------------------------------------------------------------------------
// Rarity
// ---------------------------------------------------------------------------

export interface RarityDef {
  id: Id;
  name: string;
  /** Ascending order. Used for comparisons and loot fallback. */
  order: number;
  /** UI colour token (presentation hint only). */
  color: string;
  /** Surfaced in offline "notable finds". */
  notable: boolean;
}

// ---------------------------------------------------------------------------
// Stats and mechanics
// ---------------------------------------------------------------------------

export interface StatBlock {
  hp?: number;
  attack?: number;
  armor?: number;
  /** Additive attacks per second, x1000. */
  attackRateMilli?: number;
  critBp?: number;
}

/**
 * Data-driven combat mechanics. The engine interprets these kinds.
 * Class techniques and item effects both use this vocabulary.
 */
export type MechanicDef =
  | {
      kind: "nth_hit_heal";
      id: Id;
      every: number;
      potencyBp: Bp;
      cooldownMs: number;
    }
  | {
      kind: "nth_hit_extra_damage";
      id: Id;
      every: number;
      potencyBp: Bp;
      damageType: DamageType;
      /** Only triggers while the hero has this status. */
      requiresStatus?: Id;
      /** Only triggers when the struck target is at or below this share of its max HP (C2). */
      requiresTargetHpBelowBp?: Bp;
    }
  | {
      kind: "nth_hit_haste";
      id: Id;
      every: number;
      statusId: Id;
      hasteBp: Bp;
      durationMs: number;
    }
  | {
      kind: "on_hit_dot";
      id: Id;
      statusId: Id;
      chanceBp: Bp;
      maxStacks: number;
      tickMs: number;
      durationMs: number;
      /** Damage per stack per tick, as a share of attack. */
      potencyBp: Bp;
    }
  | {
      kind: "nth_attack_splash";
      id: Id;
      every: number;
      potencyBp: Bp;
      damageType: DamageType;
    }
  | {
      kind: "on_hit_echo";
      id: Id;
      chanceBp: Bp;
      potencyBp: Bp;
      damageType: DamageType;
    }
  | {
      kind: "on_hit_chain";
      id: Id;
      chanceBp: Bp;
      potencyBp: Bp;
      damageType: DamageType;
    }
  // --- C2 (Warrior, Ranger) ---------------------------------------------------
  | {
      /**
       * When an enemy's basic attack damages the hero, strike that enemy back.
       * Never triggered by its own damage, DoT ticks or other hero effects.
       */
      kind: "on_damaged_retaliate";
      id: Id;
      chanceBp: Bp;
      potencyBp: Bp;
      damageType: DamageType;
      /** Minimum time between two retaliations. */
      cooldownMs: number;
      /** 1 = the retaliation also applies the class's on-hit DoTs to the attacker. */
      appliesDots: number;
    }
  | {
      /** The hero's direct hits deal more damage to targets at or below a share of their max HP. */
      kind: "execute";
      id: Id;
      thresholdBp: Bp;
      bonusBp: Bp;
    }
  | {
      /**
       * Every Nth attack also hits up to `targets` other living enemies (never the main target).
       * With no other living enemy, nothing extra happens.
       */
      kind: "nth_attack_split";
      id: Id;
      every: number;
      targets: number;
      potencyBp: Bp;
      damageType: DamageType;
      /** 1 = split hits also apply the class's on-hit DoTs to their targets. */
      appliesDots: number;
    }
  | {
      /** The hero's direct hits ignore this share of the target's armor. */
      kind: "armor_pierce";
      id: Id;
      pierceBp: Bp;
    }
  | {
      /**
       * A hero hit on a target carrying at least `minStacks` of the hero's `statusId` DoT
       * consumes that DoT and deals `potencyBp` of its current per-tick damage at once
       * (no variance, crit or armor, like DoT ticks).
       */
      kind: "stack_burst";
      id: Id;
      statusId: Id;
      minStacks: number;
      potencyBp: Bp;
    }
  // --- C2 (Mage survivability) --------------------------------------------------
  | {
      /**
       * A damage-absorbing ward. The hero starts every fight with `startBp` of max HP as ward
       * (it does not carry over between fights); every `every`-th hero attack adds `potencyBp`
       * of attack to it. The ward never exceeds `capBp` of max HP. Enemy hits and DoT ticks on
       * the hero drain the ward (after armor) before HP. Several wards share one pool: starts
       * add up, the cap is the highest cap.
       */
      kind: "ward";
      id: Id;
      startBp: Bp;
      every: number;
      potencyBp: Bp;
      capBp: Bp;
    };

export type MechanicKind = MechanicDef["kind"];

/** Changes numeric parameters of an already-unlocked mechanic (e.g. Practiced Rhythm). */
export interface MechanicPatch {
  mechanicId: Id;
  set: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Classes and Class Mastery
// ---------------------------------------------------------------------------

export interface TechniqueDef {
  id: Id;
  name: string;
  /** Mastery rank at which the technique unlocks (M1, M5, M10, M15, M20). */
  unlockRank: number;
  description: string;
  add?: MechanicDef[];
  patch?: MechanicPatch[];
}

export interface CurveDef {
  /** First step, in whole XP. */
  firstStep: number;
  /** Growth per step in basis points (12500 = +25% per step). */
  growthBp: Bp;
}

/**
 * XP needed per step (level L -> L+1, or rank R -> R+1).
 * - `curve`: geometric growth from a first step.
 * - `steps`: explicit table, one entry per step (length = max - 1). Used to shape
 *   pacing in hours directly (C1 content pacing).
 */
export type ProgressionDef = { curve: CurveDef; steps?: undefined } | { steps: number[]; curve?: undefined };

export interface MasteryTrackDef {
  id: Id;
  maxRank: number;
  milestones: number[];
  /** Small flat foundation: base attack bonus per rank above 1. */
  foundationAttackBpPerRank: Bp;
  xp: ProgressionDef;
  techniques: TechniqueDef[];
}

export type UnlockRequirement =
  | { kind: "characterLevel"; level: number }
  | { kind: "masteryRank"; classId: Id; rank: number }
  | { kind: "trialCleared"; trialId: Id };

export interface ClassDef {
  id: Id;
  name: string;
  /** null for base classes. Promotions point at their base class. */
  parentClassId: Id | null;
  /** 1 = base class, 2 = first promotion. */
  tier: number;
  unlockRequirements: UnlockRequirement[];
  masteryTrackId: Id;
  /** false = present in the class tree but not playable in this build. */
  implemented: boolean;
  damageType: DamageType;
  identity: string[];
  tagline: string;
  base: { hp: number; attack: number; armor: number; attackRateMilli: number; critBp: Bp };
  growth: { hp: number; attack: number; armor: number };
  /** Presentation hint for the renderer. */
  sprite: string;
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export interface ItemEffectDef {
  name: string;
  description: string;
  mechanics: MechanicDef[];
}

/** Catalog definition. Owned copies are ItemInstance records. */
export interface ItemDef {
  id: Id;
  name: string;
  slot: SlotId;
  rarity: Id;
  stats: StatBlock;
  effect?: ItemEffectDef;
  /** Loot eligibility uses encounter level, not character level. */
  minEncounterLevel: number;
  /** Descriptive build tags (FAST ATTACKS, CRIT, POISON...). */
  tags: string[];
  icon: string;
}

// ---------------------------------------------------------------------------
// Enemies, zones, loot, rules
// ---------------------------------------------------------------------------

export interface EnemyArchetypeDef {
  id: Id;
  name: string;
  /** Share of the stage HP budget relative to other members. */
  hpWeight: number;
  /** Share of the stage damage budget relative to other members. */
  damageWeight: number;
  attackRateMilli: number;
  armor: number;
  damageType: DamageType;
  sprite: string;
}

export type StageRole = "normal" | "elite" | "boss";

export interface StageDef {
  /** 0-based. */
  index: number;
  role: StageRole;
  /** Encounter level (drives rewards and loot eligibility). */
  level: number;
  /** Total HP of the whole group, in whole HP. */
  hpBudget: number;
  /** Total raw damage per second of the whole group, x100. */
  dpsBudget100: number;
  /** 1–3 archetype ids. Members share the budgets. */
  enemies: Id[];
  ruleIds?: Id[];
}

export interface ZoneDef {
  id: Id;
  name: string;
  description: string;
  order: number;
  /** false = exists as data (unlock target) but has no playable content in this build. */
  implemented: boolean;
  /** Test-only content; never listed in the player UI. */
  hidden?: boolean;
  availability?: TimeWindow;
  stages: StageDef[];
  /** Zone ids unlocked by the first full clear. Never entered automatically. */
  unlocks: Id[];
  /** Drop table for normal and elite stages. */
  lootTableId: Id;
  /** Drop table for the boss stage kill. */
  bossLootTableId: Id;
  /** Table for completion-cache rolls (defaults to bossLootTableId). */
  cacheLootTableId?: Id;
  /** Overrides config.recoveryBp when set. */
  recoveryBp?: Bp;
  stageRewards: StageRewardsDef;
  cache: {
    xp: number;
    gold: number;
    mastery: number;
    /** Item rolls on every completion (the first clear always gets them). */
    rolls: number;
    /** Chance that a REPEAT completion gets its rolls (default 100%). */
    repeatRollChanceBp?: Bp;
  };
  firstClearGold: number;
  /** Before the first clear, Farm repeats this stage only (the "trail"). */
  trailStageIndex: number;
  ruleIds?: Id[];
  background: string;
}

/** Per-stage rewards: base + perLevel x stage level, times the role multiplier. */
export interface StageRewardsDef {
  xpBase: number;
  xpPerLevel: number;
  goldBase: number;
  goldPerLevel: number;
  /** Mastery XP x10: round((base10 + perLevel10 x level) / 10). Defaults to config values. */
  masteryBase10?: number;
  masteryPerLevel10?: number;
  /** XP/gold/mastery multipliers for elite and boss stages (default 1; boss mastery uses config.masteryBossMultiplier). */
  eliteMultiplier?: number;
  bossMultiplier?: number;
}

export interface LootTableDef {
  id: Id;
  dropChanceBp: Bp;
  /** Rarity id -> weight, conditional on a drop. */
  weights: Record<Id, number>;
  /** Hard ceiling enforced in code, independent of weights. */
  maxRarity: Id;
}

export type RuleKind = "enemy_hp_bp" | "enemy_damage_bp" | "dot_damage_bp";

/**
 * Data-driven modifier ("Season Rule" style). Applied through content data,
 * never through special-case combat code.
 */
export interface RuleDef {
  id: Id;
  name: string;
  kind: RuleKind;
  valueBp: Bp;
  availability?: TimeWindow;
  testOnly?: boolean;
}

export interface ContentConfig {
  /** Inter-stage recovery after non-final victories. */
  recoveryBp: Bp;
  restMs: number;
  completionRestMs: number;
  defeatRestMs: number;
  maxFightMs: number;
  offlineCapMs: number;
  critMultiplierBp: Bp;
  damageVarianceBp: Bp;
  minDamage100: number;
  heroFirstAttackMs: number;
  enemyStaggerMs: number;
  minAttackIntervalMs: number;
  levelXp: ProgressionDef;
  maxCharacterLevel: number;
  masteryStageBase10: number;
  masteryStagePerLevel10: number;
  masteryBossMultiplier: number;
  notableOfflineMax: number;
  /**
   * Stage drops roll at the table's full chance for victories at least this long, and
   * proportionally less for shorter ones, so farming trivial content does not flood the bag.
   * Completion caches are not scaled. 0 disables the scaling.
   */
  lootFullChanceMs: number;
}

export interface ContentSnapshot {
  contentVersion: string;
  config: ContentConfig;
  rarities: RarityDef[];
  classes: ClassDef[];
  masteryTracks: MasteryTrackDef[];
  items: ItemDef[];
  enemies: EnemyArchetypeDef[];
  zones: ZoneDef[];
  lootTables: LootTableDef[];
  rules: RuleDef[];
  starterItems: Id[];
}

// ---------------------------------------------------------------------------
// Item instances
// ---------------------------------------------------------------------------

/**
 * One owned copy of a catalog item.
 *
 * The optional fields are reserved so rolled stats, modifiers, provenance,
 * upgrades and seasonal state can be added without changing ownership.
 * None of them are used by gameplay in the spike.
 */
export interface ItemInstance {
  /** Stable, unique, deterministically assigned (per-character sequence). */
  id: number;
  baseId: Id;
  /** Monotonic acquisition order (equals the id in the spike). */
  acquiredSeq: number;
  isNew: boolean;
  rolls?: Record<string, number>;
  modifiers?: Id[];
  provenance?: { source: string; zoneId?: Id; stageIndex?: number; runIndex?: number };
  upgrade?: { level: number };
  seasonal?: { seasonId: Id; state: Record<string, number> };
}

// ---------------------------------------------------------------------------
// Snapshots and replay
// ---------------------------------------------------------------------------

export interface BuildSnapshot {
  characterLevel: number;
  classId: Id;
  /** Mastery XP of the class that fights. */
  masteryXp: number;
  /** Slot -> item instance id. */
  equipment: Partial<Record<SlotId, number>>;
  artifactId: Id | null;
}

export interface EncounterRef {
  zoneId: Id;
  stageIndex: number;
}

/** Everything needed to reproduce one fight exactly. */
export interface FightRecord {
  format: "emberbound-fight-record/1";
  rulesVersion: string;
  contentVersion: string;
  contentHash: string;
  seed: number;
  build: BuildSnapshot;
  /** Every item instance the fight can read (the equipped ones). */
  itemInstances: ItemInstance[];
  encounter: EncounterRef;
  /** HP at fight start, x100. null = full HP. */
  startHp100: number | null;
  /** Active rule ids, resolved when the fight started. Part of the content snapshot. */
  activeRuleIds: Id[];
}

export type FightOutcome = "victory" | "defeat" | "timeout";

/** Authoritative combat event. All numbers are integers. */
export interface CombatEvent {
  t: number;
  /**
   * "ward" (C2): the hero's ward changed by a gain (`amt`, `via` = mechanic id); `ward` = ward after it.
   * With a ward in the kit, "hit" and "tick" events on the hero also carry `abs` (absorbed by the ward)
   * and `ward` (ward left); `eff` stays the HP actually lost. Without a ward these fields are absent.
   */
  type: "spawn" | "attack" | "hit" | "heal" | "status" | "status_end" | "tick" | "death" | "end" | "ward";
  [key: string]: number | string;
}

export type { ForgeConfig, ForgeInput, ForgeReceipt, ForgeState, ForgeMode } from "./forge";
