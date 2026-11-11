import { describe, expect, it } from "vitest";
import { CONTENT } from "@emberbound/game-content";
import { ContentIndex, advanceGame, applyCommand, canUseItem, createInstance, discoverHunts, parseSave,
  prepareBossFight, prepareHuntFight, replayFight, serializeSave, settleOffline, startHunt, validateProfile, type Profile } from "@emberbound/game-core";
import { clone, content, newProfile, setLevel, setMastery } from "./helpers";

function ready(classId = "mage", zoneId = "greenfields"): Profile {
  const p = newProfile(1042, classId, classId === "monk" ? "mage" : "monk");
  setLevel(p, 30); setMastery(p, classId, 20);
  for (const item of CONTENT.items.filter(i => i.rarity === "legendary" && canUseItem(i, classId))) p.equipment[item.slot] = createInstance(p, item.id, { isNew: false }).id;
  Object.assign(p.adventure.zones[zoneId]!, { cleared: true, unlocked: true, bestStage: 10, completions: 1 });
  discoverHunts(p, content, zoneId, 1);
  return p;
}
function finish(p: Profile, c = content) {
  const fight = prepareHuntFight(c, p.hunts!.active!, false)!;
  advanceGame(p, c, fight.summary.durationMs, { offline: false, contentTimeMs: 0 });
  expect(validateProfile(p)).toBeNull();
  expect(parseSave(serializeSave(p, 0)).ok).toBe(true);
  return fight;
}

describe("Hunts", () => {
  it("discovers only in cleared farming, never changes legacy content hashes, and keeps schema 1 until then", () => {
    const p = newProfile();
    discoverHunts(p, content, "greenfields", 86_400_000);
    expect(p.hunts).toBeUndefined(); expect(p.schema).toBe(1);
    const legacy = clone(CONTENT); delete legacy.hunts;
    const old = new ContentIndex(legacy);
    expect(content.hash).toBe(old.hash); expect(content.bossHash).toBe(old.bossHash);
    expect(content.promotionHash).toBe(old.promotionHash);
  });

  it("counts identical farming time in chunks, stops discoveries at capacity, and keeps farming", () => {
    const a = ready(); const b = clone(a);
    discoverHunts(a, content, "greenfields", 86_400_000);
    for (let i = 0; i < 24; i++) discoverHunts(b, content, "greenfields", 3_600_000);
    expect(a.hunts).toEqual(b.hunts); expect(a.hunts!.queue).toHaveLength(3);
    applyCommand(a, content, { type: "startFarm", zoneId: "greenfields" }, { contentTimeMs: 0 });
    const before = a.stats.fights;
    settleOffline(a, content, 3_600_000);
    expect(a.stats.fights).toBeGreaterThan(before); expect(a.hunts!.queue).toHaveLength(3);
    const state = clone(a.hunts);
    settleOffline(a, content, 3_600_000); settleOffline(a, content, 1);
    expect(a.hunts).toEqual(state);
  });

  it.each(["monk", "mage", "warrior", "ranger"])("lets %s finish every Hunt and earn compatible targeted loot", classId => {
    for (const hunt of CONTENT.hunts!.definitions) {
      const p = ready(classId, hunt.zoneId);
      expect(startHunt(p, content, 1, "weapon")).toBeNull();
      const record = clone(p.hunts!.active!.record);
      const replay = replayFight(content, record);
      expect(replay.summary.outcome).toBe("victory");
      finish(p);
      expect(p.hunts!.queue[0]!.step).toBe(1);
      expect(startHunt(p, content, 1, undefined, "raid")).toBeNull(); finish(p);
      const raidItem = p.hunts!.lastResult!.itemIds[0]!;
      expect(startHunt(p, content, 1)).toBeNull(); finish(p);
      expect(p.hunts!.completed).toBe(1); expect(p.hunts!.queue).toHaveLength(0);
      expect(p.inventory.instances.some(i => i.id === raidItem)).toBe(true);
      const reward = content.item(p.inventory.instances.find(i => i.id === p.hunts!.lastResult!.itemIds[0])!.baseId);
      expect(reward.slot).toBe("weapon"); expect(canUseItem(reward, classId)).toBe(true);
      expect(content.rarity(reward.rarity).order).toBeLessThanOrEqual(content.rarity(content.lootTable(content.zone(hunt.zoneId).cacheLootTableId!).maxRarity).order);
      const before = clone(p);
      expect(startHunt(p, content, 1)).not.toBeNull(); expect(p).toEqual(before);
    }
  });

  it("pins route and reward, weakens the boss, and preserves earned loot on defeat and retry", () => {
    const p = ready(); startHunt(p, content, 1, "ring"); finish(p);
    const base = clone(p);
    startHunt(p, content, 1, undefined, "weakness"); finish(p);
    startHunt(p, content, 1);
    const weak = prepareHuntFight(content, p.hunts!.active!, false)!;
    startHunt(base, content, 1, undefined, "direct");
    const direct = prepareHuntFight(content, base.hunts!.active!, false)!;
    expect(weak.setup.enemies[0]!.hitDamage100).toBeLessThan(direct.setup.enemies[0]!.hitDamage100);
    expect(startHunt(p, content, 1, "weapon")).not.toBeNull();
    const raid = ready("warrior", "ashen_mountains"); startHunt(raid, content, 1, "ring"); finish(raid);
    startHunt(raid, content, 1, undefined, "raid"); finish(raid);
    const rewardId = raid.hunts!.lastResult!.itemIds[0]!;
    const equipment = { ...raid.equipment };
    raid.equipment = {};
    raid.hunts!.queue[0]!.hp100 = 1;
    startHunt(raid, content, 1); finish(raid);
    expect(raid.hunts!.lastResult!.outcome).toBe("defeat");
    expect(raid.inventory.instances.some(i => i.id === rewardId)).toBe(true);
    expect(raid.hunts!.queue[0]!.hp100).toBeNull();
    raid.equipment = equipment;
    startHunt(raid, content, 1); finish(raid);
    expect(raid.hunts!.completed).toBe(1);
    expect(raid.inventory.instances.filter(i => i.id === rewardId)).toHaveLength(1);
  });

  it("round-trips each active stage, settles offline once, and waits for manual decisions", () => {
    let p = ready(); startHunt(p, content, 1, "chest");
    const parsed = parseSave(serializeSave(p, 0)); expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.reason); p = parsed.profile;
    const summary = settleOffline(p, content, 60_000);
    expect(summary.huntResult?.outcome).toBe("victory");
    expect(p.hunts!.active).toBeNull(); expect(p.hunts!.queue[0]!.step).toBe(1);
    expect(p.adventure.activity).toBe("farm");
    const before = clone(p); settleOffline(p, content, 60_000);
    expect(p.gold).toBe(before.gold); expect(p.hunts).toEqual(before.hunts);
  });

  it("rejects overlapping activities and corrupt Hunt saves without mutating the profile", () => {
    const p = ready(); startHunt(p, content, 1, "weapon");
    const before = clone(p);
    expect(applyCommand(p, content, { type: "startFarm", zoneId: "greenfields" }, { contentTimeMs: 0 }).ok).toBe(false);
    expect(startHunt(p, content, 1)).not.toBeNull(); expect(p).toEqual(before);
    for (const mutate of [
      (q: Profile) => { q.hunts!.active!.record.seed++; },
      (q: Profile) => { q.hunts!.queue[0]!.step = 9; },
      (q: Profile) => { q.hunts!.queue.push(clone(q.hunts!.queue[0]!)); },
      (q: Profile) => { q.hunts!.completed = 10; },
      (q: Profile) => { q.schema = 1; },
    ]) { const copy = clone(p); mutate(copy); expect(parseSave(serializeSave(copy, 0)).ok).toBe(false); }
  });

  it("interrupts changed Hunt content without a payout and preserves existing boss saves", () => {
    const p = ready(); startHunt(p, content, 1, "weapon");
    const revised = clone(CONTENT); revised.hunts!.definitions[0]!.boss.hpBudget++;
    const next = new ContentIndex(revised); const gold = p.gold;
    advanceGame(p, next, 1, { offline: true, contentTimeMs: 0 });
    expect(p.hunts!.lastResult!.outcome).toBe("interrupted"); expect(p.gold).toBe(gold);
    expect(p.hunts!.queue).toHaveLength(1); expect(p.adventure.activity).toBe("farm");
  });

  it("preserves schema 6 when adding promotions and locks, then pins the promoted Hunt build", () => {
    const p = ready("warrior", "ashen_mountains");
    expect(applyCommand(p, content, { type: "setItemLock", instanceId: p.equipment.weapon!, locked: true }, { contentTimeMs: 0 }).ok).toBe(true);
    expect(applyCommand(p, content, { type: "startBoss", bossId: "trial_warrior", tier: 1, autoPush: false }, { contentTimeMs: 0 }).ok).toBe(true);
    expect(p.schema).toBe(6); expect(parseSave(serializeSave(p, 0)).ok).toBe(true);
    const fight = prepareBossFight(content, p.longTerm!.ladders.trial_warrior!.active!, false)!;
    advanceGame(p, content, fight.summary.durationMs, { offline: true, contentTimeMs: 0 });
    expect(p.longTerm!.ladders.trial_warrior!.highestClearedTier).toBe(1);
    expect(startHunt(p, content, 1, "ring")).toBeNull();
    expect(p.hunts!.active!.record.build.promoted).toBe(true);
    expect(parseSave(serializeSave(p, 0)).ok).toBe(true);
  });
});
