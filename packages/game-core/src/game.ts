import { advanceAdventure, type AdvanceOptions } from "./adventure/run";
import { advanceBoss, type BossFightCache } from "./boss/ladder";
import type { ContentIndex } from "./content";
import type { BossResult, Profile } from "./profile/types";

export interface AdvanceGameOptions extends AdvanceOptions {
  bossCache?: BossFightCache;
  onBossResult?: (result: BossResult) => void;
}

/** Advance the current activity, returning the time spent fighting Solo Bosses. */
export function advanceGame(profile: Profile, content: ContentIndex, deltaMs: number, options: AdvanceGameOptions): number {
  if (!Number.isSafeInteger(deltaMs) || deltaMs < 0) throw new Error(`Invalid delta ${deltaMs}`);
  const remaining = profile.ashenKing?.active ? advanceBoss(profile, content, deltaMs, options) : deltaMs;
  if (remaining > 0) advanceAdventure(profile, content, remaining, options);
  return deltaMs - remaining;
}
