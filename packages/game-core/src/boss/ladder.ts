import type { BossFightRecord } from "@emberbound/shared-types";
import { applyPendingBuild, leaveCurrentRun, offlineFallback, startRun } from "../adventure/run";
import type { ContentIndex } from "../content";
import type { BossEncounterSetup } from "../encounter/budget";
import { canonicalJson } from "../hash/canonical";
import { sha256Hex } from "../hash/sha256";
import type { BossAttempt, BossProgress, BossResult, Profile } from "../profile/types";
import { checkRecordCompatibility, executeRecord, ReplayMismatchError, type ExecutedFight } from "../replay/replay";
import { BOSS_SAVE_SCHEMA_VERSION } from "../rules/version";
import { ASHEN_KING_ID, createBossFightRecord } from "./attempt";

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

export function startBossAttempt(profile: Profile, content: ContentIndex, tier: number, autoPush: boolean): string | null {
  const boss = content.soloBosses.get(ASHEN_KING_ID);
  const progress = profile.ashenKing;
  if (!boss || !profile.adventure.zones[boss.unlockZoneId]?.cleared) return "Clear Ashen Mountains to challenge the Ashen King.";
  if (progress?.active) return "An Ashen King attempt is already in progress.";
  const nextTier = (progress?.highestClearedTier ?? 0) + 1;
  if (nextTier > boss.tiers.length) return "You have cleared the Ashen King ladder.";
  if (tier !== nextTier || typeof autoPush !== "boolean") return "Choose the next available Ashen King tier.";
  if (progress?.attemptCount === Number.MAX_SAFE_INTEGER) return "The Ashen King attempt counter is full.";

  leaveCurrentRun(profile);
  profile.adventure.lastResult = null;
  applyPendingBuild(profile);
  const state = profile.ashenKing ??= { version: 1, highestClearedTier: 0, attemptCount: 0, active: null, lastResult: null };
  beginAttempt(profile, content, state, tier, autoPush);
  profile.schema = BOSS_SAVE_SCHEMA_VERSION;
  return null;
}

function beginAttempt(profile: Profile, content: ContentIndex, state: BossProgress, tier: number, autoPush: boolean): void {
  const attemptIndex = state.attemptCount + 1;
  const record = createBossFightRecord(profile, content, { bossId: ASHEN_KING_ID, tier, attemptIndex });
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
  const state = profile.ashenKing;
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
    applyPendingBuild(profile);
    const boss = content.soloBosses.get(ASHEN_KING_ID);
    if (outcome === "victory" && attempt.autoPush && !options.offline && boss && tier < boss.tiers.length
      && state.attemptCount < Number.MAX_SAFE_INTEGER) {
      beginAttempt(profile, content, state, tier + 1, true);
    } else {
      const farm = offlineFallback(profile, content, { mode: "push", zoneId: boss?.unlockZoneId ?? profile.adventure.zoneId });
      if (farm) startRun(profile, content, farm.zoneId, farm.mode, content.snapshot.config.restMs);
    }
    options.onBossResult?.(result);
  }
  return remaining;
}
