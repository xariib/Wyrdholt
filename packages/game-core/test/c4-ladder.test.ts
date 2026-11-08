import { describe, expect, it } from "vitest";
import { CONTENT } from "@emberbound/game-content";
import {
  BOSS_SAVE_SCHEMA_VERSION, ContentIndex, advanceGame, applyCommand, ashenCrownAt, createInstance,
  currentBuild, executeRecord, heroStatsFor, parseSave, prepareFight, replayFight, serializeSave, settleOffline,
  simulateOffline, type Profile,
} from "@emberbound/game-core";
import { forgeState } from "../src/items/forge";
import { content, newProfile, run, setLevel, setMastery } from "./helpers";

const options = { offline: false, contentTimeMs: 0 };

function unlock(profile: Profile): void {
  const zone = profile.adventure.zones.ashen_mountains!;
  Object.assign(zone, { unlocked: true, cleared: true, completions: 1, bestStage: 10 });
}

function ready(): Profile {
  const profile = newProfile(4_104, "mage", "monk");
  unlock(profile);
  setLevel(profile, 30);
  setMastery(profile, "mage", 20);
  for (const item of CONTENT.items.filter(item => item.rarity === "legendary")) {
    profile.equipment[item.slot] = createInstance(profile, item.id, { isNew: false }).id;
  }
  return profile;
}

function reload(profile: Profile): Profile {
  const parsed = parseSave(serializeSave(profile, profile.clock.lastSettledWallMs));
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.profile;
}

function finish(profile: Profile, index = content): void {
  const record = profile.ashenKing!.active!.record;
  const { durationMs } = executeRecord(index, record, { recordEvents: false }).summary;
  advanceGame(profile, index, durationMs - profile.ashenKing!.active!.elapsedMs, options);
}

describe("Ashen King ladder", () => {
  it("gates on a clear, snapshots one attempt and preserves an unfinished Push", () => {
    const profile = ready();
    profile.adventure.zones.ashen_mountains!.cleared = false;
    expect(run(profile, { type: "startBoss", tier: 1, autoPush: false }).ok).toBe(false);
    expect(profile.ashenKing).toBeUndefined();
    unlock(profile);
    expect(run(profile, { type: "startBoss", tier: 2, autoPush: false }).ok).toBe(false);
    expect(run(profile, { type: "startPush", zoneId: "greenfields" }).ok).toBe(true);
    const push = profile.adventure.run!;
    push.hp100 = 11_000;
    expect(run(profile, { type: "startBoss", tier: 1, autoPush: false }).ok).toBe(true);
    expect(profile.adventure.run).toBeNull();
    const checkpoint = { runIndex: push.runIndex, stageIndex: push.stageIndex, hp100: push.hp100 };
    expect(profile.adventure.zones.greenfields!.checkpoint).toEqual(checkpoint);
    expect(run(profile, { type: "startBoss", tier: 1, autoPush: false }).ok).toBe(false);
    expect(run(profile, { type: "startFarm", zoneId: "greenfields" }).ok).toBe(false);

    const first = profile.ashenKing!.active!.record;
    expect(run(profile, { type: "setActiveClass", classId: "monk" })).toEqual({ ok: true, queued: true });
    expect(first.build.classId).toBe("mage");
    finish(profile);
    expect(profile.character.activeClassId).toBe("monk");
    expect(profile.adventure.run).toMatchObject({ zoneId: "ashen_mountains", mode: "farm" });
    expect(profile.adventure.zones.greenfields!.checkpoint).toEqual(checkpoint);
    expect(run(profile, { type: "startPush", zoneId: "greenfields" }).ok).toBe(true);
    expect(profile.adventure.run).toMatchObject(checkpoint);
  });

  it.each([1, 2, 3])("opens schema %i and preserves the existing save domains in schema 4", (schema) => {
    let profile = ready();
    if (schema >= 2) forgeState(profile);
    if (schema === 3) run(profile, { type: "setItemLock", instanceId: 1, locked: true });
    profile = reload(profile);
    expect(profile.schema).toBe(schema);
    const oldDomains = { forge: profile.forge, itemLocks: profile.itemLocks };
    expect(run(profile, { type: "startBoss", tier: 1, autoPush: false }).ok).toBe(true);
    const restored = reload(profile);
    expect(restored.schema).toBe(BOSS_SAVE_SCHEMA_VERSION);
    expect(restored.ashenKing).toEqual(profile.ashenKing);
    expect({ forge: restored.forge, itemLocks: restored.itemLocks }).toEqual(oldDomains);
    run(restored, { type: "setItemLock", instanceId: 2, locked: true });
    forgeState(restored);
    expect(reload(restored).schema).toBe(BOSS_SAVE_SCHEMA_VERSION);
  });

  it("reloads a partial fight and applies its first milestone once before farming", () => {
    const profile = ready();
    const baseAttack = heroStatsFor(profile, content).attack100;
    run(profile, { type: "startBoss", tier: 1, autoPush: true });
    advanceGame(profile, content, 1000, options);
    const record = profile.ashenKing!.active!.record;
    const expected = replayFight(content, record);
    const restored = reload(profile);
    expect(restored.ashenKing!.active).toMatchObject({ record, elapsedMs: 1000 });
    const elapsed = expected.summary.durationMs - 1000 + 300;
    const summary = settleOffline(restored, content, elapsed);
    expect(summary.boss).toEqual({ tier: 1, ms: elapsed - 300, result: restored.ashenKing!.lastResult });
    expect(summary.segments).toEqual([{ zoneId: "ashen_mountains", mode: "farm", ms: 300 }]);
    expect(restored.ashenKing).toMatchObject({ highestClearedTier: 1, attemptCount: 1, active: null, lastResult: { outcome: "victory" } });
    expect(settleOffline(restored, content, elapsed).boss).toBeUndefined();
    const settled = reload(restored);
    expect(run(settled, { type: "startBoss", tier: 1, autoPush: false }).ok).toBe(false);
    expect(currentBuild(settled)).toMatchObject({ artifactId: "ashen_crown", artifactAttackBp: 300 });
    expect(heroStatsFor(settled, content).attack100).toBe(Math.round(baseAttack * 1.03));
    const farm = prepareFight(settled, content, settled.adventure.run!, { contentTimeMs: 0, recordEvents: true });
    expect(farm.record.format).toBe("emberbound-fight-record/2");
    expect(replayFight(content, farm.record).summary).toEqual(farm.summary);
    expect(() => replayFight(content, { ...farm.record, format: "emberbound-fight-record/1" })).toThrow("Invalid Artifact bonus");
  });

  it("auto-pushes after online wins, awards each milestone and stops at the final tier", () => {
    const profile = ready();
    run(profile, { type: "startBoss", tier: 1, autoPush: true });
    for (let tier = 1; tier <= 5; tier += 1) {
      expect(profile.ashenKing!.active!.record.encounter.tier).toBe(tier);
      finish(profile);
      expect(reload(profile).ashenKing).toMatchObject({ highestClearedTier: tier, lastResult: { tier, outcome: "victory" } });
      expect(ashenCrownAt(profile.ashenKing!.highestClearedTier)?.attackBp).toBe(tier < 3 ? 300 : tier < 5 ? 600 : 900);
      if (tier < 5) expect(profile.ashenKing!.active!.record.build.artifactAttackBp).toBe(currentBuild(profile).artifactAttackBp);
    }
    expect(profile.ashenKing!.active).toBeNull();
    expect(profile.adventure.activity).toBe("farm");
    expect(run(profile, { type: "startBoss", tier: 6, autoPush: true }).ok).toBe(false);
  });

  it.each(["defeat", "timeout", "interrupted"] as const)("keeps a clear and the Artifact after %s on the next tier", (outcome) => {
    const profile = ready();
    run(profile, { type: "startBoss", tier: 1, autoPush: false });
    finish(profile);
    if (outcome === "defeat") {
      setLevel(profile, 1);
      setMastery(profile, "mage", 1);
      profile.equipment = newProfile().equipment;
    }
    const shortened = new ContentIndex({ ...CONTENT, config: { ...CONTENT.config, maxFightMs: 1 } });
    const startContent = outcome === "timeout" ? shortened : content;
    const finishContent = outcome === "defeat" ? content : shortened;
    expect(applyCommand(profile, startContent, { type: "startBoss", tier: 2, autoPush: true }, options).ok).toBe(true);
    if (outcome === "interrupted") simulateOffline(profile, finishContent, 1, 1);
    else finish(profile, finishContent);
    const settled = reload(profile);
    expect(settled.ashenKing).toMatchObject({ highestClearedTier: 1, attemptCount: 2, active: null, lastResult: { tier: 2, outcome } });
    if (outcome !== "interrupted") expect(settled.ashenKing!.lastResult!.enemyHp100).toBeGreaterThan(0);
    expect(currentBuild(settled).artifactAttackBp).toBe(300);
    expect(run(settled, { type: "startBoss", tier: 2, autoPush: false }).ok).toBe(true);
    expect(settled.ashenKing!.attemptCount).toBe(3);
  });

  it("refuses a schema 4 save without boss state and a mismatched active attempt", () => {
    const profile = ready();
    const envelope = JSON.parse(serializeSave(profile, 0));
    expect(parseSave(JSON.stringify({ ...envelope, schema: BOSS_SAVE_SCHEMA_VERSION }))).toEqual({ ok: false, reason: "invalid:solo-boss-schema" });
    run(profile, { type: "startBoss", tier: 1, autoPush: false });
    profile.ashenKing!.active!.record.encounter.tier = 2;
    expect(parseSave(serializeSave(profile, 0))).toEqual({ ok: false, reason: "invalid:solo-boss-attempt" });
  });
});
