import { advanceAdventure, type AdvanceOptions } from "./adventure/run";
import { advanceBoss, type BossFightCache } from "./boss/ladder";
import { activeBossAttempt } from "./boss/progress";
import type { ContentIndex } from "./content";
import type { BossResult, Profile } from "./profile/types";
import { advanceHunt, type HuntFightCache } from "./hunts/hunts";
import { activeHuntAttempt } from "./hunts/discovery";
import type { HuntResult } from "./hunts/types";

export interface AdvanceGameOptions extends AdvanceOptions {
  huntCache?: HuntFightCache;
  onHuntResult?: (result: HuntResult) => void;
  bossCache?: BossFightCache;
  onBossResult?: (result: BossResult) => void;
}

/** Advance the current activity, returning time spent in Solo Boss or Hunt encounters. */
export function advanceGame(profile: Profile, content: ContentIndex, deltaMs: number, options: AdvanceGameOptions): number {
  if (!Number.isSafeInteger(deltaMs) || deltaMs < 0) throw new Error(`Invalid delta ${deltaMs}`);
  const remaining = activeBossAttempt(profile) ? advanceBoss(profile, content, deltaMs, options)
    : activeHuntAttempt(profile) ? advanceHunt(profile, content, deltaMs, options) : deltaMs;
  if (remaining > 0) advanceAdventure(profile, content, remaining, options);
  return deltaMs - remaining;
}
