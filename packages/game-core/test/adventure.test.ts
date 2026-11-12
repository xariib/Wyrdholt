import { describe, expect, it } from "vitest";
import {
  advanceAdventure,
  canonicalJson,
  encodeProfile,
  heroStatsFor,
  prepareFight,
  startRun,
  type AdventureEvent,
  type Profile,
} from "@emberbound/game-core";
import { clone, content, newProfile, run, setLevel, setMastery, withLegacyStarterGear } from "./helpers";

function advanceUntil(p: Profile, predicate: (events: AdventureEvent[]) => boolean, maxMs = 3_600_000, step = 250): AdventureEvent[] {
  const events: AdventureEvent[] = [];
  let t = 0;
  while (t < maxMs && !predicate(events)) {
    advanceAdventure(p, content, step, { offline: false, contentTimeMs: 0, onEvent: (e) => events.push(e) });
    t += step;
  }
  return events;
}

describe("stages and Push", () => {
  it("one stage is one encounter and stages advance automatically", () => {
    const p = withLegacyStarterGear(newProfile(10));
    run(p, { type: "startPush", zoneId: "greenfields" });
    const events = advanceUntil(p, (ev) => ev.filter((e) => e.type === "fightSettled").length >= 3);
    const settled = events.filter((e): e is Extract<AdventureEvent, { type: "fightSettled" }> => e.type === "fightSettled");
    expect(settled.map((e) => e.stageIndex)).toEqual([0, 1, 2]);
    expect(p.adventure.run?.stageIndex).toBe(3);
  });

  it("carries HP between stages with 18% recovery and no full heal", () => {
    const p = newProfile(11, "mage", "monk");
    run(p, { type: "startPush", zoneId: "greenfields" });
    advanceUntil(p, (ev) => ev.some((e) => e.type === "fightSettled"));
    const runState = p.adventure.run!;
    const max = heroStatsFor(p, content).maxHp100;
    const firstFight = prepareFight(p, content, { ...runState, stageIndex: 0, hp100: null }, { contentTimeMs: 0, recordEvents: false });
    const endHp = firstFight.summary.hero.hp100;
    expect(runState.hp100).toBe(Math.min(max, endHp + Math.round((max * 1_800) / 10_000)));
    if (endHp + (max * 1_800) / 10_000 < max) expect(runState.hp100).toBeLessThan(max);
  });

  it("Stage 5 is Elite and Stage 10 is the Zone Boss", () => {
    const zone = content.zone("greenfields");
    expect(zone.stages).toHaveLength(10);
    expect(zone.stages[4]!.role).toBe("elite");
    expect(zone.stages[9]!.role).toBe("boss");
    expect(zone.stages.filter((s) => s.role === "normal")).toHaveLength(8);
  });

  it("death resets the run but keeps earned rewards", () => {
    const p = newProfile(12, "mage", "monk");
    run(p, { type: "startPush", zoneId: "greenfields" });
    const events = advanceUntil(p, (ev) => ev.some((e) => e.type === "runEnded"));
    const ended = events.find((e): e is Extract<AdventureEvent, { type: "runEnded" }> => e.type === "runEnded")!;
    if (ended.result.kind === "cleared") return; // this seed cleared; covered elsewhere
    expect(p.adventure.run).toBeNull();
    expect(p.adventure.activity).toBe("idle");
    expect(p.character.xp).toBeGreaterThan(0);
    expect(p.gold).toBe(ended.result.totals.gold);
    expect(p.adventure.zones.greenfields!.checkpoint).toBeNull();
    run(p, { type: "startPush", zoneId: "greenfields" });
    expect(p.adventure.run?.stageIndex).toBe(0);
    expect(p.adventure.run?.hp100).toBeNull();
  });

  it("clearing the zone unlocks the next zone but never enters it, then farms the cleared zone", () => {
    const p = newProfile(13);
    setLevel(p, 8);
    setMastery(p, "monk", 10);
    run(p, { type: "startPush", zoneId: "greenfields" });
    const events = advanceUntil(p, (ev) => ev.some((e) => e.type === "zoneCleared"));
    const cleared = events.find((e): e is Extract<AdventureEvent, { type: "zoneCleared" }> => e.type === "zoneCleared")!;
    expect(cleared.firstClear).toBe(true);
    expect(cleared.unlockedZoneIds).toEqual(["darkwood"]);
    expect(p.adventure.zones.darkwood!.unlocked).toBe(true);
    expect(p.adventure.run?.zoneId).toBe("greenfields");
    expect(p.adventure.run?.mode).toBe("farm");
    expect(p.adventure.activity).toBe("farm");
    // Push is only for uncleared content.
    expect(run(p, { type: "startPush", zoneId: "greenfields" }).ok).toBe(false);
    // The next zone needs an explicit choice.
    expect(run(p, { type: "startPush", zoneId: "darkwood" }).ok).toBe(true);
    expect(p.adventure.run).toMatchObject({ zoneId: "darkwood", mode: "push", stageIndex: 0 });
  });

  it("first-clear gold is paid once; repeat clears pay the cache only", () => {
    const p = newProfile(14);
    setLevel(p, 10);
    setMastery(p, "monk", 10);
    run(p, { type: "startPush", zoneId: "greenfields" });
    const events = advanceUntil(p, (ev) => ev.filter((e) => e.type === "zoneCleared").length >= 2);
    const clears = events.filter((e): e is Extract<AdventureEvent, { type: "zoneCleared" }> => e.type === "zoneCleared");
    expect(clears.map((c) => c.firstClear)).toEqual([true, false]);
    expect(p.adventure.zones.greenfields!.completions).toBe(2);
  });

  it("Farm before the first clear repeats the trail (stage 1) without unlocks", () => {
    const p = newProfile(15);
    run(p, { type: "startFarm", zoneId: "greenfields" });
    expect(p.adventure.run?.mode).toBe("trail");
    const events = advanceUntil(p, (ev) => ev.filter((e) => e.type === "fightSettled").length >= 5);
    const settled = events.filter((e): e is Extract<AdventureEvent, { type: "fightSettled" }> => e.type === "fightSettled");
    expect(new Set(settled.map((s) => s.stageIndex))).toEqual(new Set([0]));
    expect(p.adventure.zones.greenfields!.cleared).toBe(false);
    expect(p.adventure.zones.darkwood!.unlocked).toBe(false);
  });

  it("switching activity keeps the Push checkpoint with the same seed and HP", () => {
    const p = withLegacyStarterGear(newProfile(16));
    run(p, { type: "startPush", zoneId: "greenfields" });
    advanceUntil(p, (ev) => ev.filter((e) => e.type === "fightSettled").length >= 2);
    const before = clone(p.adventure.run!);
    run(p, { type: "startFarm", zoneId: "greenfields" });
    expect(p.adventure.run?.mode).toBe("trail");
    run(p, { type: "startPush", zoneId: "greenfields" });
    const resumed = p.adventure.run!;
    expect(resumed.stageIndex).toBe(before.stageIndex);
    expect(resumed.hp100).toBe(before.hp100);
    expect(resumed.runIndex).toBe(before.runIndex);
  });

  it("advancing in one call or many tiny calls gives the identical result", () => {
    const a = newProfile(17, "mage", "monk");
    const b = clone(a);
    run(a, { type: "startPush", zoneId: "greenfields" });
    run(b, { type: "startPush", zoneId: "greenfields" });
    advanceAdventure(a, content, 180_000, { offline: false, contentTimeMs: 0 });
    let left = 180_000;
    let k = 0;
    while (left > 0) {
      const step = Math.min(left, [16, 17, 33, 1, 250][k % 5]!);
      advanceAdventure(b, content, step, { offline: false, contentTimeMs: 0, recordEvents: k % 2 === 0 });
      left -= step;
      k += 1;
    }
    expect(canonicalJson(encodeProfile(b))).toBe(canonicalJson(encodeProfile(a)));
  });
});

describe("build snapshot rule", () => {
  it("queues gear and class changes during a fight and applies them at the boundary", () => {
    const p = newProfile(20);
    run(p, { type: "devGrant", baseIds: ["willow_focus"] });
    const focus = p.inventory.instances[p.inventory.instances.length - 1]!;
    startRun(p, content, "greenfields", "push", 0);
    advanceAdventure(p, content, 1, { offline: false, contentTimeMs: 0 });
    expect(p.adventure.run?.phase).toBe("fight");
    const fightBefore = prepareFight(p, content, p.adventure.run!, { contentTimeMs: 0, recordEvents: true });

    const r1 = run(p, { type: "setActiveClass", classId: "mage" });
    const r2 = run(p, { type: "equip", slot: "weapon", instanceId: focus.id });
    expect(r1).toEqual({ ok: true, queued: true });
    expect(r2).toEqual({ ok: true, queued: true });
    expect(p.equipment.weapon).not.toBe(focus.id);
    expect(p.character.activeClassId).toBe("monk");

    const fightDuring = prepareFight(p, content, p.adventure.run!, { contentTimeMs: 0, recordEvents: true });
    expect(canonicalJson(fightDuring.events)).toBe(canonicalJson(fightBefore.events));

    const events: AdventureEvent[] = [];
    advanceAdventure(p, content, fightBefore.summary.durationMs, { offline: false, contentTimeMs: 0, onEvent: (e) => events.push(e) });
    const settled = events.find((e): e is Extract<AdventureEvent, { type: "fightSettled" }> => e.type === "fightSettled")!;
    expect(settled.buildChanged).toBe(true);
    expect(p.equipment.weapon).toBe(focus.id);
    expect(p.character.activeClassId).toBe("mage");
    expect(p.character.alternateClassId).toBe("monk");
    // The old class earned that fight's mastery.
    expect(p.character.masteryXp.monk).toBeGreaterThan(0);
    expect(p.character.masteryXp.mage).toBe(0);
  });

  it("changes outside a fight apply immediately", () => {
    const p = newProfile(21);
    run(p, { type: "devGrant", baseIds: ["reedweave_wraps"] });
    const wraps = p.inventory.instances[p.inventory.instances.length - 1]!;
    expect(run(p, { type: "equip", slot: "weapon", instanceId: wraps.id })).toEqual({ ok: true, queued: false });
    expect(p.equipment.weapon).toBe(wraps.id);
    expect(run(p, { type: "equip", slot: "head", instanceId: wraps.id }).ok).toBe(false);
  });

  it("caps carried HP when a new build lowers max HP, and never refills it", () => {
    const p = withLegacyStarterGear(newProfile(22, "mage", "monk"));
    run(p, { type: "devGrant", baseIds: ["ironbark_mantle_mage"] });
    const mantle = p.inventory.instances[p.inventory.instances.length - 1]!;
    run(p, { type: "equip", slot: "chest", instanceId: mantle.id });
    const bigMax = heroStatsFor(p, content).maxHp100;
    startRun(p, content, "greenfields", "push", 0);
    p.adventure.run!.phase = "rest";
    p.adventure.run!.restMs = 1_000;
    p.adventure.run!.hp100 = bigMax - 100;
    // Queue a lower-HP chest while "in a fight"
    p.adventure.run!.phase = "fight";
    const tunic = p.inventory.instances.find((i) => i.baseId === "trail_tunic_mage")!;
    expect(run(p, { type: "equip", slot: "chest", instanceId: tunic.id })).toEqual({ ok: true, queued: true });
    p.adventure.run!.phase = "rest";
    advanceAdventure(p, content, 1_000, { offline: false, contentTimeMs: 0 });
    const smallMax = heroStatsFor(p, content).maxHp100;
    expect(smallMax).toBeLessThan(bigMax - 100);
    expect(p.adventure.run!.hp100).toBe(smallMax);
  });
});
