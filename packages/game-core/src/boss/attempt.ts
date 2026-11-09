import type { BossFightRecord } from "@emberbound/shared-types";
import type { ContentIndex } from "../content";
import { currentBuild, equippedInstances } from "../items/inventory";
import { deriveSeed } from "../math/prng";
import type { Profile } from "../profile/types";
import { LONG_TERM_RULES_VERSION, RULES_VERSION } from "../rules/version";
import { ASHEN_KING_ID, bossProgress } from "./progress";
export { ASHEN_KING_ID } from "./progress";

export function bossFightSeed(masterSeed: number, bossId: string, tier: number, attemptIndex: number): number {
  return deriveSeed(masterSeed, `boss/${bossId}/tier/${tier}/attempt/${attemptIndex}/fight`);
}

/** Snapshot the current build for a full-HP fight. The caller supplies the boss attempt sequence. */
export function createBossFightRecord(
  profile: Profile,
  content: ContentIndex,
  { bossId, tier, attemptIndex }: BossFightRecord["encounter"] & { attemptIndex: number },
): BossFightRecord {
  content.soloBossTier(bossId, tier);
  if (!Number.isSafeInteger(attemptIndex) || attemptIndex < 1) throw new Error("Invalid solo boss attempt index");

  const build = currentBuild(profile);
  const season = content.seasons.get(bossId);
  const cleared = bossProgress(profile, bossId)?.highestClearedTier ?? 0;
  const relicAttackBp = season?.relicAttackBp[cleared - 1];
  if (relicAttackBp !== undefined) build.seasonRelicAttackBp = relicAttackBp;
  const longTerm = bossId !== ASHEN_KING_ID || build.promoted === true;
  const itemInstances = [...equippedInstances(profile, build).values()];
  return {
    format: "emberbound-boss-fight-record/1",
    rulesVersion: longTerm ? LONG_TERM_RULES_VERSION : RULES_VERSION,
    contentVersion: content.snapshot.contentVersion,
    contentHash: content.seasonHashes.get(bossId) ?? (longTerm ? content.promotionHash : content.bossHash),
    seed: bossFightSeed(profile.masterSeed, bossId, tier, attemptIndex),
    build,
    itemInstances: JSON.parse(JSON.stringify(itemInstances)) as BossFightRecord["itemInstances"],
    encounter: { bossId, tier },
    startHp100: null,
    activeRuleIds: season ? [season.rule.id] : [],
  };
}
