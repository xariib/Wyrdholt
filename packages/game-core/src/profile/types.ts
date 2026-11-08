import type { BossFightRecord, FightOutcome, ItemInstance, SlotId } from "@emberbound/shared-types";

export type Activity = "push" | "farm" | "idle";
export type RunMode = "push" | "farm" | "trail";

export interface RewardTotals {
  xp: number;
  gold: number;
  mastery: number;
  items: number;
}

export interface ZoneProgress {
  unlocked: boolean;
  cleared: boolean;
  /** Highest stage number (1-based) entered in Push/Farm. */
  bestStage: number;
  completions: number;
  /** Unfinished Push checkpoint, kept when the player switches activity. */
  checkpoint: { runIndex: number; stageIndex: number; hp100: number | null } | null;
}

export interface RunState {
  zoneId: string;
  mode: RunMode;
  /** Seed stream index (unique per run). */
  runIndex: number;
  stageIndex: number;
  /**
   * Checkpoint: HP at the START of the current stage (x100). null = full.
   * Leaving and returning replays the same stage from this HP with the same seed.
   */
  hp100: number | null;
  phase: "rest" | "fight";
  /** Progress into the current rest or fight (simulation ms). */
  elapsedMs: number;
  restMs: number;
  runElapsedMs: number;
  /** Zone bestStage when this run began (for "new best" reporting). */
  bestAtStart: number;
  totals: RewardTotals;
}

export interface RunResult {
  kind: "defeat" | "timeout" | "cleared";
  zoneId: string;
  mode: RunMode;
  /** 1-based stage where the run ended (or the final stage when cleared). */
  stage: number;
  stagesTotal: number;
  enemyHp100: number;
  enemyMaxHp100: number;
  enemiesAlive: number;
  heroHp100: number;
  newBest: boolean;
  firstClear: boolean;
  unlockedZoneIds: string[];
  runElapsedMs: number;
  totals: RewardTotals;
}

export interface AdventureState {
  activity: Activity;
  /** Zone selected for the current activity. */
  zoneId: string;
  zones: Record<string, ZoneProgress>;
  run: RunState | null;
  /** Monotonic counter used to derive run seeds. */
  runCounter: number;
  lastResult: RunResult | null;
}

export interface PendingBuild {
  activeClassId?: string;
  equipment?: Partial<Record<SlotId, number | null>>;
}

export interface CharacterState {
  name: string;
  xp: number;
  level: number;
  activeClassId: string;
  alternateClassId: string;
  masteryXp: Record<string, number>;
}

export interface ProfileStats {
  fights: number;
  victories: number;
  defeats: number;
  runsStarted: number;
  runsCompleted: number;
  itemsFound: number;
  offlineSettlements: number;
}

export interface BossAttempt {
  record: BossFightRecord;
  elapsedMs: number;
  autoPush: boolean;
}

export interface BossResult {
  tier: number;
  outcome: FightOutcome | "interrupted";
  enemyHp100: number;
  enemyMaxHp100: number;
}

export interface BossProgress {
  version: 1;
  highestClearedTier: number;
  attemptCount: number;
  active: BossAttempt | null;
  lastResult: BossResult | null;
}

/**
 * The whole player state. Only integers, strings, booleans, null, arrays and
 * plain objects (canonicalJson enforces this when saving and hashing).
 *
 * game-core functions MUTATE the profile passed to them; callers that need
 * the previous state must clone it first (cloneProfile or a save round-trip).
 */
export interface Profile {
  /** Permanent Ashen King ladder. Present from the first attempt (schema 4). */
  ashenKing?: BossProgress;
  /** Per-copy player protection. Presence requires schema 3 or later. */
  itemLocks?: { version: 1; lockedInstanceIds: number[] };
  forge?: import("@emberbound/shared-types").ForgeState;
  schema: number;
  rulesVersion: string;
  contentVersion: string;
  /** Root of all seed streams. Issued by a server in the future. */
  masterSeed: number;
  createdAtWallMs: number;
  character: CharacterState;
  gold: number;
  inventory: {
    nextInstanceId: number;
    /** Sorted by id (ids are assigned in increasing order). */
    instances: ItemInstance[];
  };
  equipment: Partial<Record<SlotId, number>>;
  pending: PendingBuild | null;
  adventure: AdventureState;
  stats: ProfileStats;
  clock: {
    /** Wall-clock time up to which progress has been settled. */
    lastSettledWallMs: number;
    /** Total simulated adventure time (informational). */
    simulatedMs: number;
  };
}
