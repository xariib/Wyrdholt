import { describe, expect, it } from "vitest";
import { CONTENT } from "@emberbound/game-content";
import {
  activeBossAttempt, advanceGame, applyCommand, bossProgress, createInstance, currentBuild, currentSeason,
  heroStatsFor, parseSave, prepareFight, promotionCleared, replayFight, seasonTierOpenAt, serializeSave,
  settleOffline, type Profile,
} from "@emberbound/game-core";
import { content, newProfile, setLevel, setMastery } from "./helpers";

const [first, second] = [...content.seasons.values()];

function ready(classId = "monk") {
  const profile = newProfile(5_105, classId, classId === "mage" ? "monk" : "mage");
  setLevel(profile, 30);
  setMastery(profile, classId, 20);
  Object.assign(profile.adventure.zones.ashen_mountains!, { unlocked: true, cleared: true, completions: 1, bestStage: 10 });
  for (const item of CONTENT.items.filter(item => item.rarity === "legendary")) {
    profile.equipment[item.slot] = createInstance(profile, item.id, { isNew: false }).id;
  }
  return profile;
}

function start(profile: Profile, bossId: string, tier = 1, contentTimeMs = 0) {
  return applyCommand(profile, content, { type: "startBoss", bossId, tier, autoPush: false }, { contentTimeMs });
}

function reload(profile: Profile): Profile {
  const save = parseSave(serializeSave(profile, profile.clock.lastSettledWallMs));
  if (!save.ok) throw new Error(save.reason);
  return save.profile;
}

function win(profile: Profile, time = 0) {
  const attempt = activeBossAttempt(profile)!;
  const { summary } = replayFight(content, attempt.record);
  expect(summary.outcome).toBe("victory");
  advanceGame(profile, content, summary.durationMs - attempt.elapsedMs, { offline: false, contentTimeMs: time });
  expect(activeBossAttempt(profile)).toBeUndefined();
}

describe("permanent class advancement", () => {
  it.each(["monk", "mage", "warrior", "ranger"])("persists and applies %s promotion once", classId => {
    const profile = ready(classId);
    const id = `trial_${classId}`;
    setLevel(profile, 24);
    expect(start(profile, id).ok).toBe(false);
    setLevel(profile, 25);
    setMastery(profile, classId, 19);
    expect(start(profile, id).ok).toBe(false);
    expect(profile.longTerm).toBeUndefined();
    setMastery(profile, classId, 20);
    setLevel(profile, 30);
    const attack = heroStatsFor(profile, content).attack100;
    expect(start(profile, id).ok).toBe(true);
    expect(start(profile, "ashen_king").ok).toBe(false);
    const restored = reload(profile);
    expect(restored.schema).toBe(5);
    expect(activeBossAttempt(restored)?.record.build.promoted).toBeUndefined();
    win(restored);
    const completed = reload(restored);
    expect(promotionCleared(completed, classId)).toBe(true);
    expect(start(completed, id).ok).toBe(false);
    expect(heroStatsFor(completed, content).attack100).toBe(Math.round(attack * 1.1));
    const fight = prepareFight(completed, content, completed.adventure.run!, { contentTimeMs: 0, recordEvents: true });
    expect(fight.record.format).toBe("emberbound-fight-record/3");
    expect(replayFight(content, fight.record).summary).toEqual(fight.summary);
    expect(promotionCleared(completed, completed.character.alternateClassId)).toBe(false);
    expect(start(completed, "ashen_king").ok).toBe(true);
    expect(reload(completed).schema).toBe(5);
  });
});

describe("finite seasons", () => {
  it("pins the rule and Relic, gates tiers by time, and preserves prior titles through rollover", () => {
    const profile = ready();
    const season = first!;
    const id = season.boss.id;
    expect(start(profile, id, 1, season.startMs - 1).ok).toBe(false);
    expect(start(profile, id, 1, season.startMs).ok).toBe(true);
    expect(activeBossAttempt(profile)?.record.activeRuleIds).toEqual([season.rule.id]);
    expect(activeBossAttempt(profile)?.record.build.seasonRelicAttackBp).toBeUndefined();
    win(profile, season.startMs);
    expect(currentBuild(profile).seasonRelicAttackBp).toBeUndefined();
    const tier2 = seasonTierOpenAt(season, 2);
    expect(start(profile, id, 2, tier2 - 1).ok).toBe(false);
    expect(start(profile, id, 2, tier2).ok).toBe(true);
    const restored = reload(profile);
    const attempt = activeBossAttempt(restored)!;
    expect(attempt.record.build.seasonRelicAttackBp).toBe(season.relicAttackBp[0]);
    expect(() => replayFight(content, { ...attempt.record, activeRuleIds: [] })).toThrow("Invalid seasonal rule");
    const duration = replayFight(content, attempt.record).summary.durationMs;
    restored.clock.lastSettledWallMs = season.endMs - 10;
    const report = settleOffline(restored, content, season.endMs + duration);
    expect(report.boss).toMatchObject({ bossId: id, tier: 2, result: { outcome: "victory" } });
    expect(settleOffline(restored, content, season.endMs + duration).boss).toBeUndefined();
    expect(start(restored, id, 3, season.endMs + duration).ok).toBe(false);
    expect(currentSeason(content, season.endMs)).toEqual(second);
    expect(start(restored, second!.boss.id, 1, season.endMs + duration).ok).toBe(true);
    expect(activeBossAttempt(restored)?.record.build.seasonRelicAttackBp).toBeUndefined();
    expect(bossProgress(reload(restored), id)?.highestClearedTier).toBe(2);
    expect(restored.adventure.zones.ashen_mountains?.cleared).toBe(true);
  });
});
