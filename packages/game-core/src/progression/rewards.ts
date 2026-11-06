import type { StageDef, ZoneDef } from "@emberbound/shared-types";
import type { ContentIndex } from "../content";
import { characterLevelFromXp } from "../character/progression";
import { mulDivRound } from "../math/fixed";
import type { Profile, RewardTotals } from "../profile/types";

export interface StageReward {
  xp: number;
  gold: number;
  mastery: number;
}

export function stageReward(content: ContentIndex, zone: ZoneDef, stage: StageDef): StageReward {
  const cfg = content.snapshot.config;
  const r = zone.stageRewards;
  const base10 = r.masteryBase10 ?? cfg.masteryStageBase10;
  const perLevel10 = r.masteryPerLevel10 ?? cfg.masteryStagePerLevel10;
  let mastery = mulDivRound(base10 + perLevel10 * stage.level, 1, 10);
  let xp = r.xpBase + r.xpPerLevel * stage.level;
  let gold = r.goldBase + r.goldPerLevel * stage.level;
  if (stage.role === "boss") {
    const m = r.bossMultiplier ?? 1;
    xp *= m;
    gold *= m;
    mastery *= cfg.masteryBossMultiplier;
  } else if (stage.role === "elite") {
    const m = r.eliteMultiplier ?? 1;
    xp *= m;
    gold *= m;
    mastery *= m;
  }
  return { xp, gold, mastery };
}

/**
 * Grant XP, gold and Class Mastery XP. Mastery goes to the class that fought.
 * Level-ups never restore HP. Returns the number of levels gained.
 */
export function grantRewards(
  profile: Profile,
  content: ContentIndex,
  reward: StageReward,
  masteryClassId: string,
  totals?: RewardTotals,
): number {
  const character = profile.character;
  const before = character.level;
  const cap = content.levelTotals[content.levelTotals.length - 1] ?? 0;
  character.xp = Math.min(cap, character.xp + reward.xp);
  character.level = characterLevelFromXp(content, character.xp);
  profile.gold += reward.gold;
  const cls = content.classDef(masteryClassId);
  const masteryTotals = content.masteryTotals(cls.masteryTrackId);
  const masteryCap = masteryTotals[masteryTotals.length - 1] ?? 0;
  character.masteryXp[masteryClassId] = Math.min(
    masteryCap,
    (character.masteryXp[masteryClassId] ?? 0) + reward.mastery,
  );
  if (totals) {
    totals.xp += reward.xp;
    totals.gold += reward.gold;
    totals.mastery += reward.mastery;
  }
  return character.level - before;
}
