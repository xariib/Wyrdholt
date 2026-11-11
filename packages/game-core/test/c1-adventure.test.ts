import { describe, expect, it } from "vitest";
import type { ContentSnapshot, SlotId } from "@emberbound/shared-types";
import { CONTENT } from "@emberbound/game-content";
import {
  BP,
  ContentIndex,
  advanceAdventure,
  applyCommand,
  characterLevelFromXp,
  createProfile,
  lootChanceScaleBp,
  rollLoot,
  simulateOffline,
  stageReward,
  stepTotals,
  type AdventureEvent,
  type Profile,
} from "@emberbound/game-core";
import { content } from "./helpers";

/** CONTENT with a patch applied (tests only). */
function patched(edit: (snap: ContentSnapshot) => void): ContentIndex {
  const snap = JSON.parse(JSON.stringify(CONTENT)) as ContentSnapshot;
  edit(snap);
  return new ContentIndex(snap);
}

const RARE_SET = ["bloodletter", "seers_circlet", "ironbark_mantle", "flowing_wraps", "huntsmans_stride", "ember_seal"];
const EPIC_SET = ["stormcaller", "crown_of_thorns", "cinderweave", "venom_grips", "pilgrims_pace", "moonlit_loop"];

/** A Monk at the given level and mastery wearing `gear`, with `cleared` zones cleared. */
function hero(c: ContentIndex, seed: number, level: number, mastery: number, gear: string[], cleared: string[] = []): Profile {
  gear = gear.map(id => c.item(id).classVariants?.monk ?? id);
  const p = createProfile(c, { name: "Tester", activeClassId: "monk", alternateClassId: "mage", masterSeed: seed, nowWallMs: 0 });
  p.character.xp = c.levelTotals[level - 1]!;
  p.character.level = level;
  p.character.masteryXp.monk = c.masteryTotals("mastery_monk")[mastery - 1]!;
  const ctx = { contentTimeMs: 0 };
  applyCommand(p, c, { type: "devGrant", baseIds: gear }, ctx);
  for (const inst of p.inventory.instances) {
    if (gear.includes(inst.baseId)) applyCommand(p, c, { type: "equip", slot: c.item(inst.baseId).slot as SlotId, instanceId: inst.id }, ctx);
  }
  for (const id of cleared) {
    const zone = c.zone(id);
    p.adventure.zones[id] = { unlocked: true, cleared: true, bestStage: zone.stages.length, completions: 1, checkpoint: null };
    for (const next of zone.unlocks) p.adventure.zones[next] = { ...p.adventure.zones[next]!, unlocked: true };
  }
  return p;
}

function advanceUntil(c: ContentIndex, p: Profile, done: (events: AdventureEvent[]) => boolean, maxMs = 3 * 3_600_000): AdventureEvent[] {
  const events: AdventureEvent[] = [];
  for (let t = 0; t < maxMs && !done(events); t += 5_000) {
    advanceAdventure(p, c, 5_000, { offline: false, contentTimeMs: 0, onEvent: (e) => events.push(e) });
  }
  return events;
}

const cleared = (events: AdventureEvent[]) => events.filter((e): e is Extract<AdventureEvent, { type: "zoneCleared" }> => e.type === "zoneCleared");
const settled = (events: AdventureEvent[]) => events.filter((e): e is Extract<AdventureEvent, { type: "fightSettled" }> => e.type === "fightSettled");

describe("C1 progression tables", () => {
  it("step tables turn into cumulative totals and reject bad steps", () => {
    expect(stepTotals([60, 110, 180])).toEqual([0, 60, 170, 350]);
    expect(() => stepTotals([10, 0])).toThrow();
    expect(() => stepTotals([10, 1.5])).toThrow();
    expect(() => stepTotals([Number.MAX_SAFE_INTEGER, 10])).toThrow();
  });

  it("level and mastery tables cover every level and rank, and never get cheaper", () => {
    const steps = CONTENT.config.levelXp.steps!;
    expect(steps).toHaveLength(CONTENT.config.maxCharacterLevel - 1);
    expect(content.levelTotals).toEqual(stepTotals(steps));
    for (let i = 1; i < steps.length; i += 1) expect(steps[i]!).toBeGreaterThanOrEqual(steps[i - 1]!);
    for (const track of CONTENT.masteryTracks) {
      const s = track.xp.steps!;
      expect(s).toHaveLength(track.maxRank - 1);
      for (let i = 1; i < s.length; i += 1) expect(s[i]!).toBeGreaterThanOrEqual(s[i - 1]!);
    }
  });

  it("maps level XP with exact boundaries and caps at level 30", () => {
    const totals = content.levelTotals;
    expect(characterLevelFromXp(content, 0)).toBe(1);
    expect(characterLevelFromXp(content, totals[11]! - 1)).toBe(11);
    expect(characterLevelFromXp(content, totals[11]!)).toBe(12);
    expect(characterLevelFromXp(content, Number.MAX_SAFE_INTEGER)).toBe(30);
  });

  it("rejects a table whose length does not match the cap", () => {
    expect(() =>
      patched((s) => {
        s.config.levelXp = { steps: [10, 20] };
      }),
    ).toThrow();
    expect(() =>
      patched((s) => {
        s.masteryTracks[0]!.xp = { steps: [10, 20] };
      }).masteryTotals("mastery_monk"),
    ).toThrow();
  });
});

describe("C1 stage rewards", () => {
  it("Elite stages multiply XP, gold and mastery; the Boss multiplies XP and gold by its own factor", () => {
    for (const zone of ["greenfields", "darkwood", "ashen_mountains"].map((id) => content.zone(id))) {
      const elite = zone.stages.find((s) => s.role === "elite")!;
      const boss = zone.stages.find((s) => s.role === "boss")!;
      const plain = (stage: typeof elite) => stageReward(content, zone, { ...stage, role: "normal" });
      const e = stageReward(content, zone, elite);
      const b = stageReward(content, zone, boss);
      const em = zone.stageRewards.eliteMultiplier ?? 1;
      const bm = zone.stageRewards.bossMultiplier ?? 1;
      expect(e).toEqual({ xp: plain(elite).xp * em, gold: plain(elite).gold * em, mastery: plain(elite).mastery * em });
      expect(b).toEqual({
        xp: plain(boss).xp * bm,
        gold: plain(boss).gold * bm,
        mastery: plain(boss).mastery * CONTENT.config.masteryBossMultiplier,
      });
    }
  });

  it("zone mastery overrides replace the global stage formula", () => {
    const c = patched((s) => {
      const z = s.zones.find((x) => x.id === "darkwood")!;
      z.stageRewards.masteryBase10 = 100;
      z.stageRewards.masteryPerLevel10 = 0;
    });
    const zone = c.zone("darkwood");
    expect(stageReward(c, zone, zone.stages[0]!).mastery).toBe(10);
  });

  it("later zones pay more per fight", () => {
    const perFight = (id: string) => {
      const zone = content.zone(id);
      return zone.stages.reduce((sum, s) => sum + stageReward(content, zone, s).xp, 0);
    };
    expect(perFight("darkwood")).toBeGreaterThan(perFight("greenfields"));
    expect(perFight("ashen_mountains")).toBeGreaterThan(perFight("darkwood"));
  });
});

describe("C1 loot", () => {
  it("scales stage drop chance with fight length", () => {
    expect(lootChanceScaleBp(10_000, 10_000)).toBe(BP);
    expect(lootChanceScaleBp(10_000, 25_000)).toBe(BP);
    expect(lootChanceScaleBp(10_000, 5_000)).toBe(5_000);
    expect(lootChanceScaleBp(10_000, 0)).toBe(0);
    expect(lootChanceScaleBp(0, 1)).toBe(BP);
  });

  it("rolls at the table chance times the scale", () => {
    const p = hero(content, 60, 10, 5, []);
    const rate = (scaleBp: number) => {
      let n = 0;
      for (let seed = 0; seed < 20_000; seed += 1) if (rollLoot(p, content, "greenfields_farm", 6, seed, { source: "test" }, scaleBp)) n += 1;
      return n / 20_000;
    };
    const chance = content.lootTable("greenfields_farm").dropChanceBp / BP;
    expect(Math.abs(rate(BP) - chance)).toBeLessThan(chance * 0.2);
    expect(Math.abs(rate(BP / 2) - chance / 2)).toBeLessThan(chance * 0.15);
    expect(rate(0)).toBe(0);
  });

  it("respects each zone's rarity cap and item level gates", () => {
    const p = hero(content, 61, 10, 5, []);
    const seen = (table: string, level: number) => {
      const set = new Set<string>();
      for (let seed = 0; seed < 4_000; seed += 1) {
        const drop = rollLoot(p, content, table, level, seed, { source: "test" });
        if (drop) set.add(content.item(drop.baseId).rarity);
      }
      return set;
    };
    expect(seen("darkwood_cache", 14).has("legendary")).toBe(false);
    expect(seen("darkwood_cache", 14).has("epic")).toBe(true);
    expect(seen("ashen_cache", 20).has("legendary")).toBe(true);
    // Legendaries need encounter level 13: a level-12 roll falls back to Epic.
    expect(seen("ashen_cache", 12).has("legendary")).toBe(false);
  });
});

describe("C1 completion caches", () => {
  function cacheItems(c: ContentIndex, p: Profile) {
    return p.inventory.instances.filter((i) => i.provenance?.source === "cache").map((i) => c.item(i.baseId));
  }

  it("the first clear always rolls the cache table; repeat clears roll with repeatRollChanceBp", () => {
    for (const [chance, expectedRepeats] of [
      [0, 0],
      [BP, 3],
    ] as const) {
      const c = patched((s) => {
        s.lootTables.push({ id: "test_cache", dropChanceBp: BP, weights: { common: 1 }, maxRarity: "common" });
        const z = s.zones.find((x) => x.id === "greenfields")!;
        z.cacheLootTableId = "test_cache";
        z.cache.repeatRollChanceBp = chance;
      });
      const p = hero(c, 62, 12, 9, RARE_SET);
      applyCommand(p, c, { type: "startPush", zoneId: "greenfields" }, { contentTimeMs: 0 });
      const events = advanceUntil(c, p, (ev) => cleared(ev).length >= 4);
      expect(cleared(events).map((e) => e.firstClear)).toEqual([true, false, false, false]);
      const items = cacheItems(c, p);
      // The cache table (not the boss table) was used: only commons.
      expect(items.every((i) => i.rarity === "common")).toBe(true);
      expect(items).toHaveLength(1 + expectedRepeats);
    }
  });

  it("repeat cache rolls land near the configured chance", () => {
    const c = patched((s) => {
      s.zones.find((x) => x.id === "greenfields")!.cache.repeatRollChanceBp = 2_500;
    });
    const p = hero(c, 63, 14, 10, RARE_SET);
    applyCommand(p, c, { type: "startPush", zoneId: "greenfields" }, { contentTimeMs: 0 });
    const events = advanceUntil(c, p, (ev) => cleared(ev).length >= 201, 48 * 3_600_000);
    const repeats = cleared(events).length - 1;
    const rolled = cacheItems(c, p).length - 1;
    expect(repeats).toBe(200);
    expect(rolled / repeats).toBeGreaterThan(0.15);
    expect(rolled / repeats).toBeLessThan(0.35);
  });
});

describe("C1 zone chain", () => {
  it("Darkwood unlocks Ashen Mountains; the next zone always needs an explicit Push", () => {
    const p = hero(content, 70, 16, 12, RARE_SET, ["greenfields"]);
    expect(applyCommand(p, content, { type: "startPush", zoneId: "ashen_mountains" }, { contentTimeMs: 0 })).toEqual({
      ok: false,
      error: "Ashen Mountains is locked.",
    });
    expect(applyCommand(p, content, { type: "startPush", zoneId: "darkwood" }, { contentTimeMs: 0 }).ok).toBe(true);
    const events = advanceUntil(content, p, (ev) => cleared(ev).length > 0);
    const first = cleared(events)[0]!;
    expect(first).toMatchObject({ zoneId: "darkwood", firstClear: true, unlockedZoneIds: ["ashen_mountains"] });
    expect(p.adventure.run).toMatchObject({ zoneId: "darkwood", mode: "farm" });
    expect(applyCommand(p, content, { type: "startPush", zoneId: "ashen_mountains" }, { contentTimeMs: 0 }).ok).toBe(true);
  });

  it("Ashen Mountains is the last zone: clearing it unlocks nothing and farms it", () => {
    const p = hero(content, 71, 23, 16, EPIC_SET, ["greenfields", "darkwood"]);
    applyCommand(p, content, { type: "startPush", zoneId: "ashen_mountains" }, { contentTimeMs: 0 });
    const events = advanceUntil(content, p, (ev) => cleared(ev).length > 0);
    expect(cleared(events)[0]).toMatchObject({ zoneId: "ashen_mountains", firstClear: true, unlockedZoneIds: [] });
    expect(p.adventure.run).toMatchObject({ zoneId: "ashen_mountains", mode: "farm" });
  });

  it("fightSettled reports the stage role and fight length", () => {
    const p = hero(content, 72, 16, 12, RARE_SET, ["greenfields"]);
    applyCommand(p, content, { type: "startPush", zoneId: "darkwood" }, { contentTimeMs: 0 });
    const events = settled(advanceUntil(content, p, (ev) => settled(ev).length >= 10));
    expect(events.slice(0, 10).map((e) => e.role)).toEqual(content.zone("darkwood").stages.map((s) => s.role));
    for (const e of events) expect(e.durationMs).toBeGreaterThan(0);
  });
});

describe("C1 offline step-down", () => {
  it("a failed Push in Ashen farms the strongest cleared zone", () => {
    const p = hero(content, 80, 16, 12, RARE_SET, ["greenfields", "darkwood"]);
    applyCommand(p, content, { type: "startPush", zoneId: "ashen_mountains" }, { contentTimeMs: 0 });
    p.adventure.run!.stageIndex = 9;
    p.adventure.run!.hp100 = 100;
    const s = simulateOffline(p, content, 3_600_000, 0);
    expect(s.push).toMatchObject({ status: "failed", zoneId: "ashen_mountains", stage: 10 });
    expect(s.segments.map((x) => [x.mode, x.zoneId])).toEqual([
      ["push", "ashen_mountains"],
      ["farm", "darkwood"],
    ]);
  });

  it("a failed Farm steps down to the next cleared zone below", () => {
    const p = hero(content, 81, 12, 9, RARE_SET, ["greenfields", "darkwood"]);
    applyCommand(p, content, { type: "startFarm", zoneId: "darkwood" }, { contentTimeMs: 0 });
    p.adventure.run!.stageIndex = 9;
    p.adventure.run!.hp100 = 100;
    const s = simulateOffline(p, content, 3_600_000, 0);
    expect(s.segments.map((x) => [x.mode, x.zoneId])).toEqual([
      ["farm", "darkwood"],
      ["farm", "greenfields"],
    ]);
    expect(p.adventure.run).toMatchObject({ zoneId: "greenfields", mode: "farm" });
    expect(s.segments.reduce((a, x) => a + x.ms, 0)).toBe(3_600_000);
  });
});

describe("C1 developer helpers", () => {
  it("devUnlockZones opens every playable zone without clearing any", () => {
    const p = hero(content, 90, 1, 1, []);
    expect(applyCommand(p, content, { type: "devUnlockZones" }, { contentTimeMs: 0 }).ok).toBe(true);
    for (const id of ["greenfields", "darkwood", "ashen_mountains"]) {
      expect(p.adventure.zones[id]).toMatchObject({ unlocked: true, cleared: false });
    }
    expect(p.adventure.zones.test_grounds?.unlocked ?? false).toBe(false);
  });
});
