import type { CombatEvent, FightRecord, ItemInstance } from "@emberbound/shared-types";
import type { ContentIndex } from "../content";
import { masteryRank } from "../character/progression";
import { resolveHeroStats, type HeroStats } from "../character/stats";
import type { FightSummary } from "../combat/engine";
import type { EncounterSetup } from "../encounter/budget";
import { buildKey, currentBuild, equippedInstances } from "../items/inventory";
import { rollLoot } from "../loot/loot";
import { BP, applyBp, mulDivFloor } from "../math/fixed";
import { Prng, deriveSeed } from "../math/prng";
import { grantRewards, stageReward } from "../progression/rewards";
import type { Profile, RewardTotals, RunMode, RunResult, RunState, ZoneProgress } from "../profile/types";
import { executeRecord } from "../replay/replay";
import { resolveActiveRuleIds } from "../rules/modifiers";
import { RULES_VERSION } from "../rules/version";

// ---------------------------------------------------------------------------
// Seeds
// ---------------------------------------------------------------------------

export function fightSeed(masterSeed: number, runIndex: number, stageIndex: number): number {
  return deriveSeed(masterSeed, `run/${runIndex}/stage/${stageIndex}/fight`);
}

/** Independent chance roll on its own seed (no draw when the chance is 0% or 100%). */
function rollChance(chanceBp: number, seed: number): boolean {
  return new Prng(seed).rollBp(chanceBp);
}

/**
 * Share of a stage table's drop chance for a victory of `durationMs`: 100% at
 * `fullChanceMs` or longer, proportionally less below (0 disables the scaling).
 */
export function lootChanceScaleBp(fullChanceMs: number, durationMs: number): number {
  if (fullChanceMs <= 0 || durationMs >= fullChanceMs) return BP;
  return mulDivFloor(Math.max(0, durationMs), BP, fullChanceMs);
}

export function lootSeed(masterSeed: number, runIndex: number, stageIndex: number, label: string): number {
  return deriveSeed(masterSeed, `run/${runIndex}/stage/${stageIndex}/${label}`);
}

// ---------------------------------------------------------------------------
// Prepared fights (cached so per-frame advancing is cheap)
// ---------------------------------------------------------------------------

export interface PreparedFight {
  key: string;
  record: FightRecord;
  hero: HeroStats;
  setup: EncounterSetup;
  summary: FightSummary;
  /** Full event log, when requested (foreground rendering, replay). */
  events: CombatEvent[] | null;
}

export class FightCache {
  private readonly entries: PreparedFight[] = [];
  private readonly heroStats = new Map<string, HeroStats>();

  constructor(private readonly capacity = 4) {}

  get(key: string, needEvents: boolean): PreparedFight | undefined {
    const hit = this.entries.find((e) => e.key === key);
    if (hit && needEvents && hit.events === null) return undefined;
    return hit;
  }

  /** Look up a fight without requiring events. */
  peek(key: string): PreparedFight | undefined {
    return this.entries.find((e) => e.key === key);
  }

  /** Forget fights (after the profile was replaced, e.g. by offline catch-up). */
  clearFights(): void {
    this.entries.length = 0;
  }

  put(entry: PreparedFight): void {
    const existing = this.entries.findIndex((e) => e.key === entry.key);
    if (existing >= 0) this.entries.splice(existing, 1);
    this.entries.unshift(entry);
    if (this.entries.length > this.capacity) this.entries.length = this.capacity;
  }

  hero(key: string, make: () => HeroStats): HeroStats {
    let stats = this.heroStats.get(key);
    if (!stats) {
      if (this.heroStats.size > 32) this.heroStats.clear();
      stats = make();
      this.heroStats.set(key, stats);
    }
    return stats;
  }
}

export function heroStatsFor(profile: Profile, content: ContentIndex, cache?: FightCache, build = currentBuild(profile)): HeroStats {
  const make = (): HeroStats => resolveHeroStats(content, build, equippedInstances(profile, build));
  if (!cache) return make();
  const rank = masteryRank(content, build.classId, build.masteryXp);
  return cache.hero(buildKey(build, rank), make);
}

export function prepareFight(
  profile: Profile,
  content: ContentIndex,
  run: RunState,
  options: { contentTimeMs: number; recordEvents: boolean; cache?: FightCache; reuseFights?: boolean },
): PreparedFight {
  const zone = content.zone(run.zoneId);
  const stage = zone.stages[run.stageIndex];
  if (!stage) throw new Error(`Run points at missing stage ${run.stageIndex}`);
  const build = currentBuild(profile);
  const seed = fightSeed(profile.masterSeed, run.runIndex, run.stageIndex);
  const ruleIds = resolveActiveRuleIds(content, zone, stage, options.contentTimeMs);
  // Offline catch-up passes `reuseFights: false`: every fight is new, so skip the fight-cache key.
  const useFightCache = options.cache !== undefined && options.reuseFights !== false;
  const key = useFightCache
    ? `${seed}|${buildKey(build)}|${run.hp100 ?? "full"}|${zone.id}|${stage.index}|${ruleIds.join(",")}`
    : "";
  if (useFightCache) {
    const cached = options.cache?.get(key, options.recordEvents);
    if (cached) return cached;
  }

  const instances = equippedInstances(profile, build);
  const hero = heroStatsFor(profile, content, options.cache, build);
  const record: FightRecord = {
    format: "emberbound-fight-record/1",
    rulesVersion: RULES_VERSION,
    contentVersion: content.snapshot.contentVersion,
    contentHash: content.hash,
    seed,
    build,
    // Snapshot copies for kept records; offline records are transient and use references.
    itemInstances: options.recordEvents
      ? [...instances.values()].map((i): ItemInstance => ({ ...i }))
      : [...instances.values()],
    encounter: { zoneId: zone.id, stageIndex: stage.index },
    startHp100: run.hp100,
    activeRuleIds: ruleIds,
  };
  // Same execution path as the replay tool: live results are replayable by construction.
  const executed = executeRecord(content, record, { recordEvents: options.recordEvents, hero });
  const prepared: PreparedFight = {
    key,
    record,
    hero,
    setup: executed.setup,
    summary: executed.summary,
    events: executed.events,
  };
  if (useFightCache) options.cache?.put(prepared);
  return prepared;
}

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

export function emptyTotals(): RewardTotals {
  return { xp: 0, gold: 0, mastery: 0, items: 0 };
}

export function zoneProgress(profile: Profile, zoneId: string): ZoneProgress {
  let zp = profile.adventure.zones[zoneId];
  if (!zp) {
    zp = { unlocked: false, cleared: false, bestStage: 0, completions: 0, checkpoint: null };
    profile.adventure.zones[zoneId] = zp;
  }
  return zp;
}

export function startRun(
  profile: Profile,
  content: ContentIndex,
  zoneId: string,
  mode: RunMode,
  restMs: number,
): RunState {
  const zone = content.zone(zoneId);
  const zp = zoneProgress(profile, zoneId);
  const adv = profile.adventure;
  let run: RunState;
  if (mode === "push" && zp.checkpoint) {
    run = {
      zoneId,
      mode,
      runIndex: zp.checkpoint.runIndex,
      stageIndex: zp.checkpoint.stageIndex,
      hp100: zp.checkpoint.hp100,
      phase: "rest",
      elapsedMs: 0,
      restMs,
      runElapsedMs: 0,
      bestAtStart: zp.bestStage,
      totals: emptyTotals(),
    };
    zp.checkpoint = null;
  } else {
    adv.runCounter += 1;
    profile.stats.runsStarted += 1;
    run = {
      zoneId,
      mode,
      runIndex: adv.runCounter,
      stageIndex: mode === "trail" ? zone.trailStageIndex : 0,
      hp100: null,
      phase: "rest",
      elapsedMs: 0,
      restMs,
      runElapsedMs: 0,
      bestAtStart: zp.bestStage,
      totals: emptyTotals(),
    };
  }
  adv.zoneId = zoneId;
  adv.activity = mode === "push" ? "push" : "farm";
  adv.run = run;
  if (mode !== "trail") zp.bestStage = Math.max(zp.bestStage, run.stageIndex + 1);
  return run;
}

/** Leave the current attempt cleanly. A Push keeps its stage checkpoint. */
export function leaveCurrentRun(profile: Profile): void {
  const adv = profile.adventure;
  const run = adv.run;
  if (run && run.mode === "push") {
    zoneProgress(profile, run.zoneId).checkpoint = {
      runIndex: run.runIndex,
      stageIndex: run.stageIndex,
      hp100: run.hp100,
    };
  }
  adv.run = null;
  adv.activity = "idle";
}

export function isFightActive(profile: Profile): boolean {
  const adv = profile.adventure;
  return adv.activity !== "idle" && adv.run !== null && adv.run.phase === "fight";
}

/** Apply queued class/gear changes. Only called at safe fight boundaries. */
export function applyPendingBuild(profile: Profile): boolean {
  const pending = profile.pending;
  if (!pending) return false;
  const character = profile.character;
  if (pending.activeClassId !== undefined && pending.activeClassId !== character.activeClassId) {
    if (pending.activeClassId === character.alternateClassId) {
      character.alternateClassId = character.activeClassId;
      character.activeClassId = pending.activeClassId;
    }
  }
  for (const [slot, id] of Object.entries(pending.equipment ?? {})) {
    const key = slot as keyof Profile["equipment"];
    if (id === null || id === undefined) delete profile.equipment[key];
    else profile.equipment[key] = id;
  }
  profile.pending = null;
  return true;
}

function clampHpToBuild(hp100: number | null, maxHp100: number): number | null {
  if (hp100 === null) return null;
  return Math.min(hp100, maxHp100);
}

// ---------------------------------------------------------------------------
// Advancing time
// ---------------------------------------------------------------------------

export type AdventureEvent =
  | {
      type: "fightSettled";
      zoneId: string;
      stageIndex: number;
      /** Stage role and fight length (telemetry). */
      role: "normal" | "elite" | "boss";
      durationMs: number;
      mode: RunMode;
      outcome: FightSummary["outcome"];
      xp: number;
      gold: number;
      mastery: number;
      levelsGained: number;
      itemIds: number[];
      buildChanged: boolean;
    }
  | { type: "runStarted"; zoneId: string; mode: RunMode; runIndex: number; stageIndex: number }
  | { type: "zoneCleared"; zoneId: string; firstClear: boolean; unlockedZoneIds: string[]; mode: RunMode }
  | { type: "runEnded"; result: RunResult }
  | { type: "fallback"; fromMode: RunMode; toMode: RunMode; zoneId: string }
  | { type: "stopped"; reason: string };

export interface AdvanceOptions {
  /** Offline catch-up: a failed Push falls back to safe Farm instead of stopping. */
  offline: boolean;
  /** Time used to evaluate content availability windows. */
  contentTimeMs: number;
  /** Keep full event logs for the current fight (foreground rendering). */
  recordEvents?: boolean;
  cache?: FightCache;
  /** false for offline catch-up: fights are never revisited, so skip fight caching. */
  reuseFights?: boolean;
  onEvent?: (event: AdventureEvent) => void;
  onTime?: (mode: RunMode, zoneId: string, ms: number) => void;
}

/**
 * Advance the Adventure by `deltaMs` of simulation time.
 * Deterministic: the same profile + content + delta always gives the same result,
 * independent of how the delta is split into calls.
 */
export function advanceAdventure(
  profile: Profile,
  content: ContentIndex,
  deltaMs: number,
  options: AdvanceOptions,
): void {
  if (!Number.isSafeInteger(deltaMs) || deltaMs < 0) throw new Error(`Invalid delta ${deltaMs}`);
  let remaining = deltaMs;
  let guard = 0;
  while (remaining > 0) {
    guard += 1;
    if (guard > 10_000_000) throw new Error("advanceAdventure: runaway loop");
    const adv = profile.adventure;
    const run = adv.run;
    if (adv.activity === "idle" || !run) break;

    if (run.phase === "rest") {
      const need = run.restMs - run.elapsedMs;
      if (remaining < need) {
        consume(profile, run, remaining, options);
        remaining = 0;
        break;
      }
      consume(profile, run, need, options);
      remaining -= need;
      // Fight boundary: queued build changes apply before the fight starts.
      if (profile.pending) {
        applyPendingBuild(profile);
        run.hp100 = clampHpToBuild(run.hp100, heroStatsFor(profile, content, options.cache).maxHp100);
      }
      run.phase = "fight";
      run.elapsedMs = 0;
      continue;
    }

    const fight = prepareFight(profile, content, run, {
      contentTimeMs: options.contentTimeMs,
      recordEvents: options.recordEvents === true,
      ...(options.cache ? { cache: options.cache } : {}),
      ...(options.reuseFights === false ? { reuseFights: false } : {}),
    });
    const need = fight.summary.durationMs - run.elapsedMs;
    if (remaining < need) {
      consume(profile, run, remaining, options);
      remaining = 0;
      break;
    }
    consume(profile, run, need, options);
    remaining -= need;
    settleFight(profile, content, run, fight, options);
  }
}

function consume(profile: Profile, run: RunState, ms: number, options: AdvanceOptions): void {
  if (ms <= 0) return;
  run.elapsedMs += ms;
  run.runElapsedMs += ms;
  profile.clock.simulatedMs += ms;
  options.onTime?.(run.mode, run.zoneId, ms);
}

function settleFight(
  profile: Profile,
  content: ContentIndex,
  run: RunState,
  fight: PreparedFight,
  options: AdvanceOptions,
): void {
  const cfg = content.snapshot.config;
  const zone = content.zone(run.zoneId);
  const stage = zone.stages[run.stageIndex];
  if (!stage) throw new Error("settleFight: missing stage");
  const zp = zoneProgress(profile, zone.id);
  const summary = fight.summary;
  const fightClassId = fight.record.build.classId;
  profile.stats.fights += 1;

  if (summary.outcome === "victory") {
    profile.stats.victories += 1;
    const reward = stageReward(content, zone, stage);
    const levels = grantRewards(profile, content, reward, fightClassId, run.totals);
    const itemIds: number[] = [];
    const table = stage.role === "boss" ? zone.bossLootTableId : zone.lootTableId;
    const drop = rollLoot(
      profile,
      content,
      table,
      stage.level,
      lootSeed(profile.masterSeed, run.runIndex, run.stageIndex, "loot"),
      { source: "stage", zoneId: zone.id, stageIndex: stage.index, runIndex: run.runIndex },
      lootChanceScaleBp(cfg.lootFullChanceMs, summary.durationMs),
    );
    if (drop) {
      itemIds.push(drop.id);
      run.totals.items += 1;
      profile.stats.itemsFound += 1;
    }

    const buildChanged = applyPendingBuild(profile);
    const maxHp100 = heroStatsFor(profile, content, options.cache).maxHp100;
    const endHp = Math.min(summary.hero.hp100, maxHp100);
    const isFinal = run.stageIndex >= zone.stages.length - 1;
    const isTrail = run.mode === "trail";

    let cacheLevels = 0;
    const clearedEvents: AdventureEvent[] = [];
    if (isFinal && !isTrail) {
      const cache = zone.cache;
      cacheLevels = grantRewards(
        profile,
        content,
        { xp: cache.xp, gold: cache.gold, mastery: cache.mastery },
        fightClassId,
        run.totals,
      );
      // First clears always roll; repeat clears roll with repeatRollChanceBp (own seed stream).
      const cacheRolls =
        !zp.cleared ||
        rollChance(
          cache.repeatRollChanceBp ?? 10_000,
          lootSeed(profile.masterSeed, run.runIndex, run.stageIndex, "cache/gate"),
        );
      for (let i = 0; cacheRolls && i < cache.rolls; i += 1) {
        const cacheDrop = rollLoot(
          profile,
          content,
          zone.cacheLootTableId ?? zone.bossLootTableId,
          stage.level,
          lootSeed(profile.masterSeed, run.runIndex, run.stageIndex, `cache/${i}`),
          { source: "cache", zoneId: zone.id, stageIndex: stage.index, runIndex: run.runIndex },
        );
        if (cacheDrop) {
          itemIds.push(cacheDrop.id);
          run.totals.items += 1;
          profile.stats.itemsFound += 1;
        }
      }
      const firstClear = !zp.cleared;
      const unlocked: string[] = [];
      if (firstClear) {
        profile.gold += zone.firstClearGold;
        run.totals.gold += zone.firstClearGold;
        zp.cleared = true;
        for (const next of zone.unlocks) {
          const np = zoneProgress(profile, next);
          if (!np.unlocked) {
            np.unlocked = true;
            unlocked.push(next);
          }
        }
      }
      zp.completions += 1;
      zp.checkpoint = null;
      profile.stats.runsCompleted += 1;
      const result: RunResult = {
        kind: "cleared",
        zoneId: zone.id,
        mode: run.mode,
        stage: zone.stages.length,
        stagesTotal: zone.stages.length,
        enemyHp100: 0,
        enemyMaxHp100: sumMaxHp(fight),
        enemiesAlive: 0,
        heroHp100: endHp,
        newBest: false,
        firstClear,
        unlockedZoneIds: unlocked,
        runElapsedMs: run.runElapsedMs,
        totals: { ...run.totals },
      };
      profile.adventure.lastResult = result;
      clearedEvents.push({ type: "zoneCleared", zoneId: zone.id, firstClear, unlockedZoneIds: unlocked, mode: run.mode });
      clearedEvents.push({ type: "runEnded", result });
    }

    options.onEvent?.({
      type: "fightSettled",
      zoneId: zone.id,
      stageIndex: run.stageIndex,
      role: stage.role,
      durationMs: summary.durationMs,
      mode: run.mode,
      outcome: summary.outcome,
      xp: reward.xp,
      gold: reward.gold,
      mastery: reward.mastery,
      levelsGained: levels + cacheLevels,
      itemIds,
      buildChanged,
    });
    for (const e of clearedEvents) options.onEvent?.(e);

    if (isTrail) {
      // The pre-clear trail repeats one encounter; every repeat is a fresh run.
      zp.bestStage = Math.max(zp.bestStage, 1);
      const next = startRun(profile, content, zone.id, "trail", cfg.restMs);
      options.onEvent?.({ type: "runStarted", zoneId: zone.id, mode: "trail", runIndex: next.runIndex, stageIndex: next.stageIndex });
      return;
    }
    if (isFinal) {
      // Push success farms the zone just completed. Never enters the unlocked zone.
      const next = startRun(profile, content, zone.id, "farm", cfg.completionRestMs);
      options.onEvent?.({ type: "runStarted", zoneId: zone.id, mode: "farm", runIndex: next.runIndex, stageIndex: 0 });
      return;
    }
    const recovery = applyBp(maxHp100, zone.recoveryBp ?? cfg.recoveryBp);
    run.hp100 = Math.min(maxHp100, endHp + recovery);
    run.stageIndex += 1;
    run.phase = "rest";
    run.elapsedMs = 0;
    run.restMs = cfg.restMs;
    zp.bestStage = Math.max(zp.bestStage, run.stageIndex + 1);
    return;
  }

  // Defeat or timeout: the run ends. Earned rewards stay; this fight grants nothing.
  profile.stats.defeats += 1;
  const buildChanged = applyPendingBuild(profile);
  const alive = summary.enemies.filter((e) => e.alive);
  const stageNumber = run.stageIndex + 1;
  const result: RunResult = {
    kind: summary.outcome === "timeout" ? "timeout" : "defeat",
    zoneId: zone.id,
    mode: run.mode,
    stage: stageNumber,
    stagesTotal: zone.stages.length,
    enemyHp100: alive.reduce((sum, e) => sum + e.hp100, 0),
    enemyMaxHp100: sumMaxHp(fight),
    enemiesAlive: alive.length,
    heroHp100: summary.hero.hp100,
    newBest: run.mode !== "trail" && stageNumber > run.bestAtStart,
    firstClear: false,
    unlockedZoneIds: [],
    runElapsedMs: run.runElapsedMs,
    totals: { ...run.totals },
  };
  profile.adventure.lastResult = result;
  if (run.mode === "push") zp.checkpoint = null;
  options.onEvent?.({
    type: "fightSettled",
    zoneId: zone.id,
    stageIndex: run.stageIndex,
    role: stage.role,
    durationMs: summary.durationMs,
    mode: run.mode,
    outcome: summary.outcome,
    xp: 0,
    gold: 0,
    mastery: 0,
    levelsGained: 0,
    itemIds: [],
    buildChanged,
  });
  options.onEvent?.({ type: "runEnded", result });

  if (!options.offline) {
    profile.adventure.run = null;
    profile.adventure.activity = "idle";
    options.onEvent?.({ type: "stopped", reason: "defeat" });
    return;
  }

  // Offline: never retry risky content. Fall back to safer cleared content.
  const fallback = offlineFallback(profile, content, run);
  if (!fallback) {
    profile.adventure.run = null;
    profile.adventure.activity = "idle";
    options.onEvent?.({ type: "stopped", reason: "no-safe-content" });
    return;
  }
  const next = startRun(profile, content, fallback.zoneId, fallback.mode, cfg.defeatRestMs);
  options.onEvent?.({ type: "fallback", fromMode: run.mode, toMode: fallback.mode, zoneId: fallback.zoneId });
  options.onEvent?.({ type: "runStarted", zoneId: fallback.zoneId, mode: fallback.mode, runIndex: next.runIndex, stageIndex: next.stageIndex });
}

function sumMaxHp(fight: PreparedFight): number {
  return fight.summary.enemies.reduce((sum, e) => sum + e.maxHp100, 0);
}

/**
 * Offline fallback after a failure:
 * - Push failed  -> Farm the strongest cleared zone, else the first zone's trail.
 * - Farm failed  -> step down to a weaker cleared zone, else the trail.
 * - Trail failed -> stop.
 */
export function offlineFallback(
  profile: Profile,
  content: ContentIndex,
  failed: Pick<RunState, "mode" | "zoneId">,
): { zoneId: string; mode: RunMode } | null {
  if (failed.mode === "trail") return null;
  const playable = content.snapshot.zones
    .filter((z) => z.implemented && !z.hidden)
    .sort((a, b) => a.order - b.order);
  const failedOrder = content.zone(failed.zoneId).order;
  const cleared = playable.filter((z) => profile.adventure.zones[z.id]?.cleared === true);
  const candidates =
    failed.mode === "push" ? cleared : cleared.filter((z) => z.order < failedOrder);
  const best = candidates[candidates.length - 1];
  if (best) return { zoneId: best.id, mode: "farm" };
  const first = playable[0];
  return first ? { zoneId: first.id, mode: "trail" } : null;
}
