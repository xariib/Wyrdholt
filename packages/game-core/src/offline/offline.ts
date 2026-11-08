import type { ContentIndex } from "../content";
import { FightCache, type AdventureEvent } from "../adventure/run";
import { advanceGame } from "../game";
import { findInstance } from "../items/inventory";
import type { Activity, BossResult, Profile, RunMode } from "../profile/types";

export interface OfflineSummary {
  requestedMs: number;
  simulatedMs: number;
  capped: boolean;
  activityAtStart: Activity;
  zoneAtStart: string;
  push: { status: "none" | "cleared" | "failed"; zoneId: string | null; stage: number; stagesTotal: number; enemyHp100: number; enemyMaxHp100: number };
  boss?: { tier: number; ms: number; result: BossResult | null };
  unlockedZoneIds: string[];
  /** Time spent per activity target, in order of first use. */
  segments: { mode: RunMode; zoneId: string; ms: number }[];
  fights: number;
  victories: number;
  defeats: number;
  xp: number;
  gold: number;
  mastery: number;
  levelBefore: number;
  levelAfter: number;
  itemsFound: number;
  /** At most `notableOfflineMax` distinct notable finds (rarity first). */
  notableInstanceIds: number[];
  otherItems: number;
  stoppedReason: string | null;
}

/**
 * Simulate `elapsedMs` of absence, capped by content, with the same pipeline
 * as online play. Offline Push continues the current zone; on failure it stops
 * risky Push and farms safe content; on success it farms the completed zone and
 * never enters the newly unlocked zone.
 */
export function simulateOffline(
  profile: Profile,
  content: ContentIndex,
  elapsedMs: number,
  contentTimeMs: number,
  /** Optional telemetry hook (balance simulations, dev tools). Never changes results. */
  hooks?: { onEvent?: (event: AdventureEvent) => void },
): OfflineSummary {
  const cfg = content.snapshot.config;
  const simulatedMs = Math.max(0, Math.min(elapsedMs, cfg.offlineCapMs));
  const adv = profile.adventure;
  const summary: OfflineSummary = {
    requestedMs: elapsedMs,
    simulatedMs,
    capped: elapsedMs > cfg.offlineCapMs,
    activityAtStart: adv.activity,
    zoneAtStart: adv.zoneId,
    push: { status: "none", zoneId: null, stage: 0, stagesTotal: 0, enemyHp100: 0, enemyMaxHp100: 0 },
    unlockedZoneIds: [],
    segments: [],
    fights: 0,
    victories: 0,
    defeats: 0,
    xp: 0,
    gold: 0,
    mastery: 0,
    levelBefore: profile.character.level,
    levelAfter: profile.character.level,
    itemsFound: 0,
    notableInstanceIds: [],
    otherItems: 0,
    stoppedReason: null,
  };
  const found: number[] = [];

  const onEvent = (event: AdventureEvent): void => {
    hooks?.onEvent?.(event);
    switch (event.type) {
      case "fightSettled":
        summary.fights += 1;
        if (event.outcome === "victory") summary.victories += 1;
        else summary.defeats += 1;
        summary.xp += event.xp;
        summary.gold += event.gold;
        summary.mastery += event.mastery;
        for (const id of event.itemIds) found.push(id);
        break;
      case "zoneCleared":
        if (event.mode === "push") {
          summary.push.status = "cleared";
          summary.push.zoneId = event.zoneId;
        }
        for (const z of event.unlockedZoneIds) summary.unlockedZoneIds.push(z);
        break;
      case "runEnded": {
        const r = event.result;
        if (r.kind === "cleared") break;
        if (r.mode === "push" && summary.push.status === "none") {
          summary.push = {
            status: "failed",
            zoneId: r.zoneId,
            stage: r.stage,
            stagesTotal: r.stagesTotal,
            enemyHp100: r.enemyHp100,
            enemyMaxHp100: r.enemyMaxHp100,
          };
        }
        break;
      }
      case "stopped":
        summary.stoppedReason = event.reason;
        break;
      case "fallback":
      case "runStarted":
        break;
    }
  };
  const onTime = (mode: RunMode, zoneId: string, ms: number): void => {
    const last = summary.segments[summary.segments.length - 1];
    if (last && last.mode === mode && last.zoneId === zoneId) last.ms += ms;
    else summary.segments.push({ mode, zoneId, ms });
  };

  const xpBefore = profile.character.xp;
  const goldBefore = profile.gold;
  const masteryBefore = sumValues(profile.character.masteryXp);
  const activeBoss = profile.ashenKing?.active;
  if (simulatedMs > 0 && (activeBoss || adv.activity !== "idle")) {
    const boss = activeBoss ? { tier: activeBoss.record.encounter.tier, ms: 0, result: null as BossResult | null } : null;
    const bossMs = advanceGame(profile, content, simulatedMs, {
      offline: true,
      contentTimeMs,
      cache: new FightCache(2),
      reuseFights: false,
      onEvent,
      onTime,
      onBossResult: (result) => {
        if (boss) boss.result = result;
        if (result.outcome === "interrupted") return;
        summary.fights += 1;
        if (result.outcome === "victory") summary.victories += 1;
        else summary.defeats += 1;
      },
    });
    if (boss) summary.boss = { ...boss, ms: bossMs };
  } else if (adv.activity === "idle") {
    summary.stoppedReason = "idle";
  }
  // Authoritative totals (include completion caches and first-clear gold).
  summary.xp = profile.character.xp - xpBefore;
  summary.gold = profile.gold - goldBefore;
  summary.mastery = sumValues(profile.character.masteryXp) - masteryBefore;
  summary.levelAfter = profile.character.level;
  summary.itemsFound = found.length;
  summary.notableInstanceIds = pickNotable(profile, content, found);
  summary.otherItems = found.length - summary.notableInstanceIds.length;
  profile.stats.offlineSettlements += 1;
  return summary;
}

/**
 * Settle wall-clock time since the last settlement. Idempotent: settling the
 * same moment twice grants nothing the second time. A clock that moved
 * backwards settles nothing.
 */
export function settleOffline(
  profile: Profile,
  content: ContentIndex,
  nowWallMs: number,
  contentTimeMs = nowWallMs,
): OfflineSummary {
  const elapsed = Math.max(0, nowWallMs - profile.clock.lastSettledWallMs);
  const summary = simulateOffline(profile, content, elapsed, contentTimeMs);
  profile.clock.lastSettledWallMs = Math.max(profile.clock.lastSettledWallMs, nowWallMs);
  return summary;
}

function sumValues(record: Record<string, number>): number {
  let total = 0;
  for (const v of Object.values(record)) total += v;
  return total;
}

function pickNotable(profile: Profile, content: ContentIndex, ids: readonly number[]): number[] {
  const max = content.snapshot.config.notableOfflineMax;
  const candidates: { id: number; order: number; baseId: string }[] = [];
  for (const id of ids) {
    const instance = findInstance(profile, id);
    if (!instance) continue;
    const item = content.item(instance.baseId);
    const rarity = content.rarity(item.rarity);
    const fillsEmptySlot = profile.equipment[item.slot] === undefined;
    if (!rarity.notable && !fillsEmptySlot) continue;
    candidates.push({ id, order: rarity.notable ? rarity.order + 100 : rarity.order, baseId: instance.baseId });
  }
  candidates.sort((a, b) => b.order - a.order || a.id - b.id);
  const picked: number[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    if (seen.has(c.baseId)) continue;
    seen.add(c.baseId);
    picked.push(c.id);
    if (picked.length >= max) break;
  }
  return picked;
}
