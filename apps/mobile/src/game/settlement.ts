import {
  activeBossAttempt,
  activeHuntAttempt,
  applyCommand,
  masteryRank,
  offlineFallback,
  type ContentIndex,
  type OfflineSummary,
  type Profile,
  type RunMode,
} from "@emberbound/game-core";

/**
 * What an offline settlement changed, measured from the profile before and after
 * (C1 playtest investigation: make Character XP vs Mastery observable on the device).
 * Read-only: computed next to game-core, never fed back into it.
 */
export interface SettlementTelemetry {
  requestedMs: number;
  simulatedMs: number;
  activityAtStart: Profile["adventure"]["activity"];
  /** Set when the character was standing still after a defeat and safe Farm was started first. */
  resumedFrom: string | null;
  /** Class that fought at the start and at the end (a queued switch can apply mid-settlement). */
  classAtStart: string;
  classAtEnd: string;
  characterXp: number;
  levelBefore: number;
  levelAfter: number;
  /** Mastery XP gained per class (only classes that changed). */
  masteryByClass: Record<string, number>;
  masteryRankBefore: number;
  masteryRankAfter: number;
  gold: number;
  items: number;
  fights: number;
  victories: number;
  defeats: number;
  /** Activity targets in order, e.g. "Push Darkwood 0:04 · Farm Greenfields 7:56". */
  targets: { mode: RunMode; zoneId: string; ms: number }[];
}

export function settlementTelemetry(
  content: ContentIndex,
  before: Profile,
  after: Profile,
  summary: OfflineSummary,
  resumedFrom: string | null,
): SettlementTelemetry {
  const cls = after.character.activeClassId;
  const rankOf = (p: Profile) => masteryRank(content, cls, p.character.masteryXp[cls] ?? 0);
  const masteryByClass: Record<string, number> = {};
  const ids = new Set([...Object.keys(before.character.masteryXp), ...Object.keys(after.character.masteryXp)]);
  for (const id of ids) {
    const gained = (after.character.masteryXp[id] ?? 0) - (before.character.masteryXp[id] ?? 0);
    if (gained !== 0) masteryByClass[id] = gained;
  }
  return {
    requestedMs: summary.requestedMs,
    simulatedMs: summary.simulatedMs,
    activityAtStart: summary.activityAtStart,
    resumedFrom,
    classAtStart: before.character.activeClassId,
    classAtEnd: cls,
    characterXp: after.character.xp - before.character.xp,
    levelBefore: before.character.level,
    levelAfter: after.character.level,
    masteryByClass,
    masteryRankBefore: rankOf(before),
    masteryRankAfter: rankOf(after),
    gold: after.gold - before.gold,
    items: summary.itemsFound,
    fights: summary.fights,
    victories: summary.victories,
    defeats: summary.defeats,
    targets: summary.segments.map((s) => ({ ...s })),
  };
}

/**
 * After a failed run the character stands still until the player chooses. Start the same
 * safe Farm that offline catch-up uses after a failure (strongest cleared zone, else the
 * first zone's trail), so progress never silently stops — also when the app is closed on
 * the result screen. Returns the zone and mode started, or null when nothing was needed.
 */
export function resumeAfterDefeat(profile: Profile, content: ContentIndex, contentTimeMs: number): { zoneId: string; mode: RunMode } | null {
  if (activeBossAttempt(profile) || activeHuntAttempt(profile)) return null;
  const adv = profile.adventure;
  const failed = adv.lastResult;
  if (adv.activity !== "idle" || !failed || failed.kind === "cleared") return null;
  const target = offlineFallback(profile, content, { mode: failed.mode, zoneId: failed.zoneId });
  if (!target) return null;
  const result = applyCommand(profile, content, { type: "startFarm", zoneId: target.zoneId }, { contentTimeMs });
  return result.ok ? target : null;
}
