import type { SeasonDef } from "@emberbound/shared-types";
import type { ContentIndex } from "../content";
import type { BossAttempt, BossProgress, Profile } from "../profile/types";

export const ASHEN_KING_ID = "ashen_king";

export function bossProgress(profile: Profile, bossId: string): BossProgress | undefined {
  return bossId === ASHEN_KING_ID ? profile.ashenKing : profile.longTerm?.ladders[bossId];
}

export function activeBossAttempt(profile: Profile): BossAttempt | undefined {
  if (profile.ashenKing?.active) return profile.ashenKing.active;
  for (const progress of Object.values(profile.longTerm?.ladders ?? {})) {
    if (progress.active) return progress.active;
  }
  return undefined;
}

export function promotionCleared(profile: Profile, classId: string): boolean {
  return profile.longTerm?.ladders[`trial_${classId}`]?.highestClearedTier === 1;
}

export function currentSeason(content: ContentIndex, atMs: number): SeasonDef | undefined {
  return [...content.seasons.values()].find(s => s.startMs <= atMs && atMs < s.endMs);
}

export function seasonTierOpenAt(season: SeasonDef, tier: number): number {
  return season.startMs + (tier - 1) * season.tierIntervalMs;
}
