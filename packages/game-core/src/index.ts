/**
 * @emberbound/game-core — pure deterministic simulation.
 *
 * Allowed dependencies: ECMAScript built-ins and @emberbound/shared-types.
 * Forbidden: React, PixiJS, DOM/browser APIs, Node APIs, Capacitor, Math.random,
 * wall-clock reads. Enforced by tools/check-core-purity.mjs and by type-checking
 * this package with `lib: ["ES2022"]` and no ambient types.
 */

export { RULES_VERSION, SAVE_SCHEMA_VERSION } from "./rules/version";
export { BP, HP_SCALE, mulDivRound, mulDivFloor, applyBp, geometricCurveTotals, stepTotals } from "./math/fixed";
export { Prng, deriveSeed, fnv1a32, splitmix32 } from "./math/prng";
export { sha256Hex, utf8Bytes } from "./hash/sha256";
export { canonicalJson } from "./hash/canonical";
export { ContentIndex } from "./content";
export { isWindowOpen, resolveActiveRuleIds, combineRuleEffects, type RuleEffects } from "./rules/modifiers";
export {
  levelFromTotals,
  curveProgress,
  characterLevelFromXp,
  masteryRank,
  masteryProgress,
  techniqueStatuses,
  nextMilestone,
  resolveClassMechanics,
  type CurveProgress,
  type TechniqueStatus,
} from "./character/progression";
export { resolveHeroStats, type HeroStats } from "./character/stats";
export {
  simulateFight,
  ArraySink,
  NULL_SINK,
  type EventSink,
  type FightInput,
  type FightSummary,
  type FightCounters,
  type ActorFinal,
} from "./combat/engine";
export { buildEncounter, type EnemyInit, type EncounterSetup } from "./encounter/budget";
export {
  findInstance,
  createInstance,
  reservedInstanceIds,
  currentBuild,
  equippedInstances,
  buildKey,
} from "./items/inventory";
export { rollLoot } from "./loot/loot";
export { stageReward, grantRewards, type StageReward } from "./progression/rewards";
export {
  advanceAdventure,
  prepareFight,
  heroStatsFor,
  startRun,
  leaveCurrentRun,
  applyPendingBuild,
  isFightActive,
  zoneProgress,
  offlineFallback,
  fightSeed,
  lootSeed,
  lootChanceScaleBp,
  FightCache,
  type PreparedFight,
  type AdventureEvent,
  type AdvanceOptions,
} from "./adventure/run";
export { applyCommand, type Command, type CommandResult } from "./commands/commands";
export { simulateOffline, settleOffline, type OfflineSummary } from "./offline/offline";
export { createProfile, validateNewCharacter, type NewCharacterInput } from "./profile/create";
export { cloneProfile } from "./profile/clone";
export type * from "./profile/types";
export {
  executeRecord,
  replayFight,
  fightHash,
  checkRecordCompatibility,
  ReplayMismatchError,
  type ReplayResult,
  type ExecutedFight,
} from "./replay/replay";
export {
  serializeSave,
  parseSave,
  encodeProfile,
  decodeProfile,
  validateProfile,
  SAVE_FORMAT,
  type SaveEnvelope,
  type ParseResult,
} from "./save/codec";
export {
  writeSaveSafely,
  loadSaveSafely,
  MemorySaveFs,
  DEFAULT_SAVE_PATHS,
  type SaveFileAdapter,
  type SavePaths,
  type LoadOutcome,
} from "./save/safeWrite";
export {
  SELF_TEST_CASES,
  runSelfTest,
  goldenMatches,
  type SelfTestCase,
  type SelfTestResult,
  type GoldenFile,
  type CaseOutput,
} from "./selftest/fixtures";
export { default as GOLDEN } from "./selftest/golden.json";

export { fuse, forgeCeiling, eligibleForgeIds, FORGE_RULES_VERSION } from "./items/forge";
export { isItemLocked, setItemLock, ITEM_LOCK_SAVE_SCHEMA_VERSION } from "./items/locks";
export type { ForgeResult } from "./items/forge";
export { previewSalvage, salvageItem, SALVAGE_RULES_VERSION } from "./items/salvage";
export type { SalvageInput, SalvageReceipt, SalvageResult } from "./items/salvage";

export { previewBulkSalvage, salvageItems, BULK_SALVAGE_RULES_VERSION } from "./items/bulkSalvage";
export type { BulkSalvageInput, BulkSalvageReceipt, BulkSalvageResult } from "./items/bulkSalvage";
