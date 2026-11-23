import { describe, expect, it } from "vitest";
import {
  activeBossAttempt, applyCommand, bossProgress, cloneProfile, currentBuild, huntResetAt, huntWeekAt,
  parseSave, prepareBossFight, resolveHeroStats, rollLoot, serializeSave, simulateOffline,
} from "@emberbound/game-core";
import { content, newProfile, run, setLevel, setMastery } from "./helpers";

const sunday = Date.UTC(2026, 10, 22, 23, 59, 59);
const monday = Date.UTC(2026, 10, 23);
const bramble = "hunt_brambleback";
const start = (profile: ReturnType<typeof newProfile>, at: number, bossId = bramble) =>
  applyCommand(profile, content, { type: "startBoss", tier: 1, autoPush: false, bossId }, { contentTimeMs: at });

function reload(profile: ReturnType<typeof newProfile>) {
  const parsed = parseSave(serializeSave(profile, sunday));
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.profile;
}

describe("weekly Hunts", () => {
  it("unlocks by region and pays one exclusive drop at the entry week's reset boundary", () => {
    const p = newProfile(888, "warrior", "ranger");
    expect(huntResetAt(huntWeekAt(sunday))).toBe(monday);
    expect(huntWeekAt(monday)).toBe(huntWeekAt(sunday) + 1);
    expect(start(p, sunday).ok).toBe(false);
    p.adventure.zones.greenfields!.cleared = true;
    setLevel(p, 25);
    setMastery(p, "warrior", 12);
    expect(start(p, sunday).ok).toBe(true);
    expect(start(p, sunday, "hunt_gloamweaver").ok).toBe(false);
    const saved = reload(p);
    const offline = cloneProfile(saved);
    const attempt = activeBossAttempt(saved)!;
    const fight = prepareBossFight(content, attempt, false)!;
    const { durationMs, outcome } = fight.summary;
    expect(outcome).toBe("victory");
    expect(run(saved, { type: "setActiveClass", classId: "ranger" })).toMatchObject({ ok: true, queued: true });
    expect(applyCommand(saved, content, { type: "advance", ms: durationMs }, { contentTimeMs: monday }).ok).toBe(true);
    const summary = simulateOffline(offline, content, durationMs, monday);
    const reward = content.hunts.get(bramble)!;
    expect(saved.character.xp - p.character.xp).toBe(reward.xp);
    expect(saved.character.masteryXp.warrior! - p.character.masteryXp.warrior!).toBe(reward.mastery);
    expect(saved.character.masteryXp.ranger).toBe(0);
    expect(saved.gold - p.gold).toBe(reward.gold);
    expect(saved.inventory.instances.map(i => i.baseId)).toEqual([reward.rewards.warrior]);
    expect(offline.inventory.instances.map(i => i.baseId)).toEqual([reward.rewards.warrior]);
    expect(summary).toMatchObject({ itemsFound: 1, notableInstanceIds: [offline.inventory.instances[0]!.id] });
    expect(saved.character.activeClassId).toBe("ranger");
    expect(bossProgress(reload(saved), bramble)?.huntCompletedWeek).toBe(huntWeekAt(sunday));
    expect(start(saved, sunday).ok).toBe(false);
    expect(start(saved, monday).ok).toBe(true);
    expect(bossProgress(reload(saved), bramble)?.attemptCount).toBe(2);
    expect(activeBossAttempt(saved)?.record.seed).not.toBe(attempt.record.seed);
  });

  it("lets a loss be retried and never drops Hunt gear from ordinary encounters", () => {
    const profile = newProfile(1);
    profile.adventure.zones.greenfields!.cleared = true;
    expect(start(profile, monday).ok).toBe(true);
    const fight = prepareBossFight(content, activeBossAttempt(profile)!, false)!;
    expect(fight.summary.outcome).not.toBe("victory");
    expect(applyCommand(profile, content, { type: "advance", ms: fight.summary.durationMs }, { contentTimeMs: monday }).ok).toBe(true);
    expect(profile.inventory.instances).toHaveLength(0);
    expect(profile.gold).toBe(0);
    expect(start(reload(profile), monday).ok).toBe(true);
    for (let seed = 1; seed <= 768; seed++) {
      const drop = rollLoot(profile, content, "ashen_cache", 20, seed, { source: "test" });
      expect(drop).toBeTruthy();
      expect(content.item(drop!.baseId).huntId).toBeUndefined();
    }
  });
});

describe("class skill trees", () => {
  it.each(["warrior", "monk", "mage", "ranger"])("enforces %s branch order, point budgets, and replay stats", classId => {
    const profile = newProfile(112, classId, classId === "mage" ? "monk" : "mage");
    const nodes = content.talentTrees.get(classId)!.branches[0]!.nodes;
    const spend = (...ids: string[]) => run(profile, { type: "setTalents", classId, talentIds: ids });
    expect(spend(nodes[0]!.id).ok).toBe(false);
    setMastery(profile, classId, 9);
    expect(spend(nodes[1]!.id).ok).toBe(false);
    expect(spend(nodes[0]!.id, nodes[0]!.id).ok).toBe(false);
    expect(spend(nodes[0]!.id, "fake_skill").ok).toBe(false);
    const before = currentBuild(profile);
    expect(spend(...nodes.map(node => node.id)).ok).toBe(true);
    const loaded = reload(profile);
    const after = currentBuild(loaded);
    const baseStats = resolveHeroStats(content, before, new Map());
    const talented = resolveHeroStats(content, after, new Map());
    expect(after.talentIds).toEqual(nodes.map(node => node.id).sort());
    expect(talented.mechanics.map(mechanic => mechanic.id)).toContain(nodes[2]!.mechanic!.id);
    expect(talented.display).not.toEqual(baseStats.display);
    expect(spend().ok).toBe(true);
    expect(currentBuild(reload(profile)).talentIds).toBeUndefined();
  });

  it("saves a respec during combat and applies it only after settlement", () => {
    const profile = newProfile(112, "warrior", "mage");
    profile.adventure.zones.greenfields!.cleared = true;
    setLevel(profile, 25);
    setMastery(profile, "warrior", 9);
    expect(start(profile, monday).ok).toBe(true);
    const id = content.talentTrees.get("warrior")!.branches[1]!.nodes[0]!.id;
    expect(run(profile, { type: "setTalents", classId: "warrior", talentIds: [id] })).toEqual({ ok: true, queued: true });
    const saved = reload(profile);
    const attempt = activeBossAttempt(saved)!;
    expect(attempt.record.build.talentIds).toBeUndefined();
    expect(currentBuild(saved).talentIds).toBeUndefined();
    const fight = prepareBossFight(content, attempt, false)!;
    applyCommand(saved, content, { type: "advance", ms: fight.summary.durationMs }, { contentTimeMs: monday });
    expect(currentBuild(reload(saved)).talentIds).toEqual([id]);
  });
});
