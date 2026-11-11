/**
 * Foreground vs offline reward settlement (C1 playtest investigation, 21 Sep 2026).
 *
 * For the same profile and the same simulated time, the foreground clock (small steps,
 * event logs, fight cache — the app's path) and offline catch-up must settle the same
 * rewards: Character XP, Class Mastery XP per class, gold, loot, fights and zone caches.
 * The only intended difference is what happens after a defeat (foreground stops and asks,
 * offline falls back to safe Farm), which is checked separately.
 */
import { describe, expect, it } from "vitest";
import type { SlotId } from "@emberbound/shared-types";
import {
  FightCache,
  advanceAdventure,
  applyCommand,
  canonicalJson,
  createProfile,
  parseSave,
  serializeSave,
  simulateOffline,
  stageReward,
  startRun,
  type AdventureEvent,
  type Profile,
} from "@emberbound/game-core";
import { clone, content } from "./helpers";

const HOUR = 3_600_000;
const GREEN_SET = ["wayfarer_blade", "linen_hood", "trail_tunic", "worn_grips", "road_boots", "copper_band"];
const RARE_SET = ["bloodletter", "seers_circlet", "ironbark_mantle", "flowing_wraps", "huntsmans_stride", "ember_seal"];
const EPIC_SET = ["stormcaller", "crown_of_thorns", "cinderweave", "venom_grips", "pilgrims_pace", "moonlit_loop"];

function hero(opts: { seed: number; cls: string; alt: string; level: number; mastery: number; gear: string[]; cleared: string[] }): Profile {
  opts = { ...opts, gear: opts.gear.map(id => content.item(id).classVariants?.[opts.cls] ?? id) };
  const p = createProfile(content, { name: "Tester", activeClassId: opts.cls, alternateClassId: opts.alt, masterSeed: opts.seed, nowWallMs: 0 });
  p.character.xp = content.levelTotals[opts.level - 1]!;
  p.character.level = opts.level;
  const track = content.classDef(opts.cls).masteryTrackId;
  p.character.masteryXp[opts.cls] = content.masteryTotals(track)[opts.mastery - 1]!;
  const ctx = { contentTimeMs: 0 };
  applyCommand(p, content, { type: "devGrant", baseIds: opts.gear }, ctx);
  for (const inst of p.inventory.instances) {
    if (opts.gear.includes(inst.baseId)) {
      applyCommand(p, content, { type: "equip", slot: content.item(inst.baseId).slot as SlotId, instanceId: inst.id }, ctx);
    }
  }
  for (const id of opts.cleared) {
    const zone = content.zone(id);
    p.adventure.zones[id] = { unlocked: true, cleared: true, bestStage: zone.stages.length, completions: 1, checkpoint: null };
    for (const next of zone.unlocks) p.adventure.zones[next] = { unlocked: true, cleared: false, bestStage: 0, completions: 0, checkpoint: null };
  }
  return p;
}

/** The app's foreground path: many small steps, event logs on, a shared fight cache. */
function foreground(p: Profile, ms: number, stepMs: number, events: AdventureEvent[] = []): AdventureEvent[] {
  const cache = new FightCache(4);
  let left = ms;
  while (left > 0) {
    const step = Math.min(stepMs, left);
    advanceAdventure(p, content, step, { offline: false, contentTimeMs: 0, recordEvents: true, cache, onEvent: (e) => events.push(e) });
    left -= step;
  }
  return events;
}

/** Everything that matters for progression (clock and settlement counters excluded). */
function progression(p: Profile) {
  return {
    level: p.character.level,
    xp: p.character.xp,
    masteryXp: { ...p.character.masteryXp },
    gold: p.gold,
    items: p.inventory.instances.map((i) => i.baseId),
    zones: p.adventure.zones,
    fights: p.stats.fights,
    victories: p.stats.victories,
    defeats: p.stats.defeats,
    runsCompleted: p.stats.runsCompleted,
    itemsFound: p.stats.itemsFound,
    run: p.adventure.run,
    activity: p.adventure.activity,
    simulatedMs: p.clock.simulatedMs,
  };
}

const settled = (events: AdventureEvent[]) =>
  events.filter((e): e is Extract<AdventureEvent, { type: "fightSettled" }> => e.type === "fightSettled");

const FARM_CASES = [
  { name: "Monk farming Greenfields (L8 M4, starter gear)", zone: "greenfields", hours: 2, opts: { seed: 11, cls: "monk", alt: "mage", level: 8, mastery: 4, gear: GREEN_SET, cleared: ["greenfields"] } },
  { name: "Mage farming Greenfields (L10 M6, Rare set)", zone: "greenfields", hours: 2, opts: { seed: 12, cls: "mage", alt: "monk", level: 10, mastery: 6, gear: RARE_SET, cleared: ["greenfields"] } },
  { name: "Monk farming Darkwood (L14 M10, Rare set)", zone: "darkwood", hours: 2, opts: { seed: 13, cls: "monk", alt: "mage", level: 14, mastery: 10, gear: RARE_SET, cleared: ["greenfields", "darkwood"] } },
  { name: "Mage farming Ashen (L22 M16, Epic set)", zone: "ashen_mountains", hours: 1, opts: { seed: 14, cls: "mage", alt: "monk", level: 22, mastery: 16, gear: EPIC_SET, cleared: ["greenfields", "darkwood", "ashen_mountains"] } },
];

describe("offline vs foreground Farm settle the same rewards", () => {
  it.each(FARM_CASES)("$name", ({ zone, hours, opts }) => {
    const base = hero(opts);
    applyCommand(base, content, { type: "startFarm", zoneId: zone }, { contentTimeMs: 0 });
    const ms = hours * HOUR;

    const off = clone(base);
    const summary = simulateOffline(off, content, ms, 0);
    const fg = clone(base);
    const fgEvents = foreground(fg, ms, 250);

    // Precondition: a clean Farm (no defeats), so both paths follow the same policy.
    expect(summary.defeats).toBe(0);
    expect(summary.fights).toBeGreaterThan(100);
    expect(progression(off)).toEqual(progression(fg));
    // And the mastery actually moved, for the class that fought, as much as XP rules say.
    const gained = off.character.masteryXp[opts.cls]! - base.character.masteryXp[opts.cls]!;
    expect(summary.mastery).toBe(gained);
    expect(gained).toBeGreaterThan(0);
    expect(off.character.masteryXp[opts.alt] ?? 0).toBe(base.character.masteryXp[opts.alt] ?? 0);
    expect(settled(fgEvents).length).toBe(summary.fights);
  });

  it("the foreground step size does not change anything (16 ms frames vs 5 s chunks)", () => {
    const base = hero(FARM_CASES[0]!.opts);
    applyCommand(base, content, { type: "startFarm", zoneId: "greenfields" }, { contentTimeMs: 0 });
    const a = clone(base);
    const b = clone(base);
    foreground(a, 20 * 60_000, 16);
    foreground(b, 20 * 60_000, 5_000);
    expect(progression(a)).toEqual(progression(b));
  });

  it("offline settles in one call or many (same total), and survives a save round trip", () => {
    const base = hero(FARM_CASES[2]!.opts);
    applyCommand(base, content, { type: "startFarm", zoneId: "darkwood" }, { contentTimeMs: 0 });
    const once = clone(base);
    simulateOffline(once, content, 3 * HOUR, 0);
    let pieces = clone(base);
    for (let i = 0; i < 6; i += 1) {
      simulateOffline(pieces, content, HOUR / 2, 0);
      const parsed = parseSave(serializeSave(pieces, 0));
      if (!parsed.ok) throw new Error(parsed.reason);
      pieces = parsed.profile;
    }
    expect(progression(pieces)).toEqual(progression(once));
  });
});

describe("offline Mastery settles for every source", () => {
  const base = hero(FARM_CASES[2]!.opts);
  applyCommand(base, content, { type: "startFarm", zoneId: "darkwood" }, { contentTimeMs: 0 });
  const p = clone(base);
  const events: AdventureEvent[] = [];
  const summary = simulateOffline(p, content, 2 * HOUR, 0, { onEvent: (e) => events.push(e) });
  const zone = content.zone("darkwood");
  const wins = settled(events).filter((e) => e.outcome === "victory");

  it("every ordinary, Elite and Boss victory grants its stage mastery offline", () => {
    for (const role of ["normal", "elite", "boss"] as const) expect(wins.some((e) => e.role === role)).toBe(true);
    for (const e of wins) {
      const expected = stageReward(content, zone, zone.stages[e.stageIndex]!);
      expect(e.mastery).toBe(expected.mastery);
      expect(e.mastery).toBeGreaterThan(0);
    }
    const boss = wins.find((e) => e.role === "boss")!;
    const normal = wins.find((e) => e.role === "normal" && e.stageIndex === boss.stageIndex - 1);
    if (normal) expect(boss.mastery).toBeGreaterThan(normal.mastery);
  });

  it("completion caches add their mastery offline", () => {
    const completions = events.filter((e) => e.type === "zoneCleared").length;
    expect(completions).toBeGreaterThan(0);
    const fromFights = wins.reduce((sum, e) => sum + e.mastery, 0);
    expect(summary.mastery).toBe(fromFights + completions * zone.cache.mastery);
    expect(zone.cache.mastery).toBeGreaterThan(0);
  });
});

describe("offline safe-fallback Farm after a failed Push", () => {
  it("still awards mastery, exactly like a player who fails and then farms by hand", () => {
    // Too weak for the Darkwood Boss: the Push fails, then offline farms Greenfields.
    const base = hero({ seed: 21, cls: "monk", alt: "mage", level: 11, mastery: 7, gear: RARE_SET, cleared: ["greenfields"] });
    applyCommand(base, content, { type: "startPush", zoneId: "darkwood" }, { contentTimeMs: 0 });
    base.adventure.run!.stageIndex = 9;
    base.adventure.run!.hp100 = 100; // 1 HP entering the Boss: the Push fails
    const ms = 2 * HOUR;

    const off = clone(base);
    const events: AdventureEvent[] = [];
    const summary = simulateOffline(off, content, ms, 0, { onEvent: (e) => events.push(e) });
    expect(summary.push.status).toBe("failed");
    expect(summary.segments.map((s) => [s.mode, s.zoneId])).toEqual([
      ["push", "darkwood"],
      ["farm", "greenfields"],
    ]);
    const afterFallback = settled(events).filter((e) => e.zoneId === "greenfields" && e.outcome === "victory");
    expect(afterFallback.length).toBeGreaterThan(100);
    expect(afterFallback.every((e) => e.mastery > 0)).toBe(true);

    // Foreground: same fight until the defeat, then the same Farm started by hand.
    const fg = clone(base);
    const fgEvents: AdventureEvent[] = [];
    const cache = new FightCache(4);
    let used = 0;
    while (fg.adventure.activity !== "idle") {
      advanceAdventure(fg, content, 1_000, { offline: false, contentTimeMs: 0, recordEvents: true, cache, onEvent: (e) => fgEvents.push(e) });
      used += 1_000;
      if (used > HOUR) throw new Error("the Push was expected to fail");
    }
    // Rewind the overshoot inside the last step: foreground stopped at the defeat.
    const pushMs = summary.segments[0]!.ms;
    expect(used - pushMs).toBeLessThan(1_000);
    fg.clock.simulatedMs = pushMs;
    startRun(fg, content, "greenfields", "farm", content.snapshot.config.defeatRestMs);
    foreground(fg, ms - pushMs, 250, fgEvents);
    expect(progression(fg)).toEqual(progression(off));
  });
});

describe("mastery goes to the class that fought", () => {
  it("a class switch queued before going offline applies at the next fight boundary", () => {
    const base = hero({ seed: 31, cls: "monk", alt: "mage", level: 10, mastery: 6, gear: RARE_SET, cleared: ["greenfields"] });
    base.character.masteryXp.mage = content.masteryTotals("mastery_mage")[2]!;
    applyCommand(base, content, { type: "startFarm", zoneId: "greenfields" }, { contentTimeMs: 0 });
    advanceAdventure(base, content, 3_000, { offline: false, contentTimeMs: 0 }); // mid-fight
    expect(applyCommand(base, content, { type: "setActiveClass", classId: "mage" }, { contentTimeMs: 0 }).ok).toBe(true);
    expect(base.pending?.activeClassId).toBe("mage");

    const off = clone(base);
    const events: AdventureEvent[] = [];
    simulateOffline(off, content, HOUR, 0, { onEvent: (e) => events.push(e) });
    const fg = clone(base);
    foreground(fg, HOUR, 250);
    expect(progression(off)).toEqual(progression(fg));

    // The fight in progress still belongs to the Monk; every later one to the Mage.
    const wins = settled(events).filter((e) => e.outcome === "victory");
    const monkGain = off.character.masteryXp.monk! - base.character.masteryXp.monk!;
    const mageGain = off.character.masteryXp.mage! - base.character.masteryXp.mage!;
    expect(off.character.activeClassId).toBe("mage");
    expect(monkGain).toBe(wins[0]!.mastery);
    expect(mageGain).toBeGreaterThan(monkGain * 50);
  });

  it("the Alternate class never earns mastery", () => {
    const base = hero({ seed: 32, cls: "mage", alt: "monk", level: 10, mastery: 6, gear: RARE_SET, cleared: ["greenfields"] });
    applyCommand(base, content, { type: "startFarm", zoneId: "greenfields" }, { contentTimeMs: 0 });
    const off = clone(base);
    simulateOffline(off, content, HOUR, 0);
    expect(off.character.masteryXp.monk ?? 0).toBe(base.character.masteryXp.monk ?? 0);
    expect(off.character.masteryXp.mage!).toBeGreaterThan(base.character.masteryXp.mage!);
  });
});

describe("what offline does NOT settle", () => {
  it("an idle character (after a foreground defeat, before the player picks an action) settles nothing", () => {
    const base = hero({ seed: 41, cls: "monk", alt: "mage", level: 11, mastery: 7, gear: RARE_SET, cleared: ["greenfields"] });
    applyCommand(base, content, { type: "startPush", zoneId: "darkwood" }, { contentTimeMs: 0 });
    base.adventure.run!.stageIndex = 9;
    base.adventure.run!.hp100 = 100;
    const fg = clone(base);
    for (let t = 0; fg.adventure.activity !== "idle"; t += 1_000) {
      if (t > HOUR) throw new Error("the Push was expected to fail");
      advanceAdventure(fg, content, 1_000, { offline: false, contentTimeMs: 0 });
    }
    const before = canonicalJson(progression(fg));
    const summary = simulateOffline(fg, content, 8 * HOUR, 0);
    expect(summary.stoppedReason).toBe("idle");
    expect(summary.fights).toBe(0);
    expect(canonicalJson(progression(fg))).toBe(before);
  });
});
