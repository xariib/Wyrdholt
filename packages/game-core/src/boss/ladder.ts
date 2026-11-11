import type { BossFightRecord } from "@emberbound/shared-types";
import { applyPendingBuild, leaveCurrentRun, offlineFallback, startRun } from "../adventure/run";
import type { ContentIndex } from "../content";
import { masteryRank } from "../character/progression";
import type { BossEncounterSetup } from "../encounter/budget";
import { canonicalJson } from "../hash/canonical";
import { sha256Hex } from "../hash/sha256";
import type { BossAttempt, BossProgress, BossResult, Profile } from "../profile/types";
import { checkRecordCompatibility, executeRecord, ReplayMismatchError, type ExecutedFight } from "../replay/replay";
import { BOSS_SAVE_SCHEMA_VERSION, LONG_TERM_SAVE_SCHEMA_VERSION } from "../rules/version";
import { createBossFightRecord } from "./attempt";
import { activeHuntAttempt } from "../hunts/discovery";
import { ASHEN_KING_ID, activeBossAttempt, bossProgress, seasonTierOpenAt } from "./progress";

export interface PreparedBossFight extends ExecutedFight<BossEncounterSetup> {
  key: string;
  record: BossFightRecord;
}

export type BossFightCache = WeakMap<BossFightRecord, PreparedBossFight>;

export function prepareBossFight(
  content: ContentIndex,
  attempt: BossAttempt,
  recordEvents: boolean,
  cache?: BossFightCache,
): PreparedBossFight | null {
  const { record } = attempt;
  const cached = cache?.get(record);
  if (cached && (!recordEvents || cached.events !== null)) return cached;
  try {
    checkRecordCompatibility(content, record);
  } catch (error) {
    if (error instanceof ReplayMismatchError) return null;
    throw error;
  }
  const fight = { ...executeRecord(content, record, { recordEvents }), key: sha256Hex(canonicalJson(record)), record };
  cache?.set(record, fight);
  return fight;
}

export function startBossAttempt(profile: Profile, content: ContentIndex, tier: number, autoPush: boolean, bossId = ASHEN_KING_ID, atMs = 0): string | null {
  const boss = content.soloBosses.get(bossId);
  if (!boss || (bossId !== ASHEN_KING_ID && !bossId.startsWith("trial_") && !content.seasons.has(bossId))) return "Unknown challenge.";
  const progress = bossProgress(profile, bossId);
  if (!profile.adventure.zones[boss.unlockZoneId]?.cleared) return `Clear ${content.zone(boss.unlockZoneId).name} to challenge ${boss.name}.`;
  if (activeBossAttempt(profile) || activeHuntAttempt(profile)) return "A challenge attempt is already in progress.";
  const nextTier = (progress?.highestClearedTier ?? 0) + 1;
  if (nextTier > boss.tiers.length) return `You have cleared ${boss.name}.`;
  if (tier !== nextTier || typeof autoPush !== "boolean" || (autoPush && bossId !== ASHEN_KING_ID)) return "Choose the next available challenge tier.";
  if (progress?.attemptCount === Number.MAX_SAFE_INTEGER) return "The challenge attempt counter is full.";

  const classId = profile.pending?.activeClassId ?? profile.character.activeClassId;
  const promotion = content.promotions.get(classId);
  if (bossId.startsWith("trial_") && (promotion?.boss.id !== bossId
    || profile.character.level < promotion.level
    || masteryRank(content, classId, profile.character.masteryXp[classId] ?? 0) < promotion.mastery)) {
    return "Meet the trial requirements and make that class active first.";
  }
  const season = content.seasons.get(bossId);
  const time = Math.max(atMs, profile.clock.lastSettledWallMs);
  if (season && (!Number.isSafeInteger(time) || time < seasonTierOpenAt(season, tier) || time >= season.endMs)) {
    return "This seasonal tier is currently closed.";
  }

  leaveCurrentRun(profile);
  profile.adventure.lastResult = null;
  applyPendingBuild(profile, content);
  const state = progress ?? { version: 1, highestClearedTier: 0, attemptCount: 0, active: null, lastResult: null };
  if (bossId === ASHEN_KING_ID) {
    profile.ashenKing = state;
    profile.schema = Math.max(profile.schema, BOSS_SAVE_SCHEMA_VERSION);
  } else {
    const longTerm = profile.longTerm ??= { version: 1, ladders: {} };
    longTerm.ladders[bossId] = state;
    profile.schema = Math.max(profile.schema, LONG_TERM_SAVE_SCHEMA_VERSION);
  }
  beginAttempt(profile, content, state, bossId, tier, autoPush);
  return null;
}

function beginAttempt(profile: Profile, content: ContentIndex, state: BossProgress, bossId: string, tier: number, autoPush: boolean): void {
  const attemptIndex = state.attemptCount + 1;
  const record = createBossFightRecord(profile, content, { bossId, tier, attemptIndex });
  state.active = { record, autoPush, elapsedMs: 0 };
  state.attemptCount = attemptIndex;
}

interface AdvanceBossOptions {
  offline: boolean;
  recordEvents?: boolean;
  bossCache?: BossFightCache;
  onBossResult?: (result: BossResult) => void;
}

/** Consume time on the active boss ladder and return the time available to Adventure. */
export function advanceBoss(profile: Profile, content: ContentIndex, deltaMs: number, options: AdvanceBossOptions): number {
  const bossId = activeBossAttempt(profile)?.record.encounter.bossId;
  if (!bossId) return deltaMs;
  const state = bossProgress(profile, bossId);
  let remaining = deltaMs;
  while (remaining > 0 && state?.active) {
    const attempt = state.active;
    const fight = prepareBossFight(content, attempt, options.recordEvents === true, options.bossCache);
    const elapsed = fight ? Math.min(remaining, Math.max(0, fight.summary.durationMs - attempt.elapsedMs)) : 0;
    attempt.elapsedMs += elapsed;
    profile.clock.simulatedMs += elapsed;
    remaining -= elapsed;
    if (fight && attempt.elapsedMs < fight.summary.durationMs) break;

    const tier = attempt.record.encounter.tier;
    const outcome = fight?.summary.outcome ?? "interrupted";
    const enemy = fight?.summary.enemies[0];
    const result: BossResult = { tier, outcome, enemyHp100: enemy?.hp100 ?? 0, enemyMaxHp100: enemy?.maxHp100 ?? 0 };
    state.lastResult = result;
    state.active = null;
    if (fight) {
      profile.stats.fights += 1;
      if (outcome === "victory") {
        profile.stats.victories += 1;
        state.highestClearedTier = tier;
      } else {
        profile.stats.defeats += 1;
      }
    }
    applyPendingBuild(profile, content);
    const boss = content.soloBosses.get(bossId);
    if (bossId === ASHEN_KING_ID && outcome === "victory" && attempt.autoPush && !options.offline && boss && tier < boss.tiers.length
      && state.attemptCount < Number.MAX_SAFE_INTEGER) {
      beginAttempt(profile, content, state, bossId, tier + 1, true);
    } else {
      const farm = offlineFallback(profile, content, { mode: "push", zoneId: boss?.unlockZoneId ?? profile.adventure.zoneId });
      if (farm) startRun(profile, content, farm.zoneId, farm.mode, content.snapshot.config.restMs);
    }
    options.onBossResult?.(result);
  }
  return remaining;
}
