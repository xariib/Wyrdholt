import { describe, expect, it } from "vitest";
import type { CombatEvent, ContentSnapshot, MechanicDef, SlotId } from "@emberbound/shared-types";
import { CONTENT } from "@emberbound/game-content";
import {
  ArraySink,
  ContentIndex,
  NULL_SINK,
  buildEncounter,
  canonicalJson,
  combineRuleEffects,
  currentBuild,
  equippedInstances,
  resolveClassMechanics,
  resolveHeroStats,
  simulateFight,
  type EnemyInit,
  type FightInput,
  type HeroStats,
} from "@emberbound/game-core";
import { content, newProfile, setLevel, setMastery } from "./helpers";

/**
 * C2 Mage ward (Arcane Ward, mechanic kind "ward"): the Mage's survivability moved from raw
 * HP/armor into a class mechanic (roadmap decision, 16 Sep 2026; calibrated 22 Sep 2026).
 */

const exactConfig = { ...content.snapshot.config, damageVarianceBp: 0 };
const noRules = combineRuleEffects(content, []);

function synthHero(mechanics: MechanicDef[], opts: { attack?: number; hp?: number; rate?: number } = {}): HeroStats {
  const attack = opts.attack ?? 100;
  const hp = opts.hp ?? 1_000;
  return {
    classId: "synthetic",
    level: 1,
    masteryRank: 1,
    maxHp100: hp * 100,
    attack100: attack * 100,
    armor: 0,
    attackRateMilli: opts.rate ?? 1_000,
    critBp: 0,
    damageType: "magic",
    mechanics,
    mechanicSources: mechanics.map(() => "class"),
    display: { hp, attack, armor: 0, attackRateMilli: opts.rate ?? 1_000, critBp: 0 },
    activeEffects: [],
  };
}

function synthEnemy(index: number, hp: number, opts: { hit?: number; rate?: number } = {}): EnemyInit {
  return {
    id: `e${index}`,
    index,
    archetypeId: "test",
    name: `Test ${index}`,
    maxHp100: hp * 100,
    hitDamage100: (opts.hit ?? 10) * 100,
    attackRateMilli: opts.rate ?? 1_000,
    armor: 0,
    damageType: "physical",
    sprite: "slime",
  };
}

function fight(hero: HeroStats, enemies: EnemyInit[], startHp100: number | null = null, seed = 7) {
  const sink = new ArraySink();
  const summary = simulateFight({ seed, hero, startHp100, enemies, effects: noRules, config: exactConfig }, sink);
  return { events: sink.events, summary };
}

const ward = (over: Partial<Extract<MechanicDef, { kind: "ward" }>> = {}): MechanicDef => ({
  kind: "ward",
  id: "arcane_ward",
  startBp: 0,
  every: 4,
  potencyBp: 700,
  capBp: 2_000,
  ...over,
});

const enemyHitsOnHero = (events: CombatEvent[]) => events.filter((e) => e.type === "hit" && e.tgt === "hero");

describe("Mage ward: engine rule", () => {
  it("starts every fight with startBp of max HP, capped", () => {
    const { events } = fight(synthHero([ward({ startBp: 1_500, capBp: 1_000 })], { hp: 1_000 }), [synthEnemy(0, 50)]);
    expect(events.find((e) => e.type === "ward")).toMatchObject({ t: 0, via: "start", ward: 100_00, cap: 100_00 });
  });

  it("absorbs enemy hits before HP; eff is the HP actually lost", () => {
    // Ward 50 HP, enemy hits 30: first hit fully absorbed, second 20 absorbed + 10 to HP.
    const { events, summary } = fight(synthHero([ward({ startBp: 500, every: 1_000, capBp: 500 })], { hp: 1_000, attack: 1, rate: 100 }), [
      synthEnemy(0, 100_000, { hit: 30 }),
    ]);
    const [first, second, third] = enemyHitsOnHero(events);
    expect(first).toMatchObject({ amt: 30_00, abs: 30_00, eff: 0, ward: 20_00, hp: 1_000_00 });
    expect(second).toMatchObject({ amt: 30_00, abs: 20_00, eff: 10_00, ward: 0, hp: 990_00 });
    expect(third).toMatchObject({ amt: 30_00, abs: 0, eff: 30_00, ward: 0, hp: 960_00 });
    expect(summary.counters.absorbed100).toBe(50_00);
  });

  it("every Nth hero attack adds potencyBp of attack, up to the cap", () => {
    const { events, summary } = fight(synthHero([ward({ every: 2, potencyBp: 5_000, capBp: 1_000 })], { hp: 1_000, attack: 40 }), [
      synthEnemy(0, 1_000, { hit: 1, rate: 100 }),
    ]);
    const gains = events.filter((e) => e.type === "ward" && e.via === "arcane_ward");
    expect(gains.length).toBeGreaterThan(0);
    // 50% of 40 attack = 20 per gain, never above 10% of 1,000 max HP.
    for (const g of gains) {
      expect(Number(g.amt)).toBeLessThanOrEqual(20_00);
      expect(Number(g.ward)).toBeLessThanOrEqual(100_00);
    }
    expect(summary.counters.procs["arcane_ward"]).toBe(gains.length);
    // Gains only on every second attack.
    const attackTimes = events.filter((e) => e.type === "attack" && e.src === "hero").map((e) => e.t);
    for (const g of gains) expect(attackTimes.filter((t) => t <= g.t).length % 2).toBe(0);
  });

  it("does not carry over: a fight started at partial HP still starts from the start ward", () => {
    const hero = synthHero([ward({ startBp: 1_000, capBp: 2_000 })], { hp: 1_000 });
    const a = fight(hero, [synthEnemy(0, 50)], null);
    const b = fight(hero, [synthEnemy(0, 50)], 300_00);
    expect(a.events.find((e) => e.type === "ward")!.ward).toBe(100_00);
    expect(b.events.find((e) => e.type === "ward")!.ward).toBe(100_00);
  });

  it("draws no randomness", () => {
    const enemies = [synthEnemy(0, 2_000, { hit: 12 }), synthEnemy(1, 2_000, { hit: 12 })];
    const plain = fight(synthHero([]), enemies);
    const warded = fight(synthHero([ward({ startBp: 500 })]), enemies);
    expect(warded.summary.rngDraws).toBe(plain.summary.rngDraws);
  });

  it("without a ward mechanic, events and summary carry no ward fields", () => {
    const { events, summary } = fight(synthHero([]), [synthEnemy(0, 500, { hit: 12 })]);
    expect(events.some((e) => e.type === "ward")).toBe(false);
    expect(enemyHitsOnHero(events).some((e) => "abs" in e || "ward" in e)).toBe(false);
    expect("absorbed100" in summary.counters).toBe(false);
  });

  it("recording events never changes the outcome", () => {
    const hero = synthHero([ward({ startBp: 300 })], { hp: 400, attack: 30 });
    const enemies = [synthEnemy(0, 900, { hit: 15 }), synthEnemy(1, 900, { hit: 15 })];
    const recorded = fight(hero, enemies).summary;
    const silent = simulateFight({ seed: 7, hero, startHp100: null, enemies, effects: noRules, config: exactConfig }, NULL_SINK);
    expect(canonicalJson({ ...silent, eventCount: 0 })).toBe(canonicalJson({ ...recorded, eventCount: 0 }));
  });

  it("the ward makes a losing fight winnable, and more ward never hurts", () => {
    const enemies = [synthEnemy(0, 3_000, { hit: 10 })];
    const hpLeft = (potencyBp: number) => {
      const s = fight(synthHero([ward({ potencyBp, capBp: 5_000 })], { hp: 600, attack: 40 }), enemies).summary;
      return s.outcome === "victory" ? s.hero.hp100 : -s.enemies[0]!.hp100;
    };
    const values = [0, 1_000, 3_000, 6_000].map(hpLeft);
    for (let i = 1; i < values.length; i += 1) expect(values[i]!).toBeGreaterThanOrEqual(values[i - 1]!);
    expect(values[0]!).toBeLessThan(0);
    expect(values[3]!).toBeGreaterThan(0);
  });
});

describe("Mage ward: shipped Mage", () => {
  it("Arcane Ward is part of the Mage kit from M1", () => {
    expect(resolveClassMechanics(content, "mage", 1).map((m) => m.id)).toEqual(["ignition", "arcane_ward"]);
    expect(resolveClassMechanics(content, "mage", 20).find((m) => m.id === "arcane_ward")).toMatchObject({
      kind: "ward",
      startBp: 0,
      every: 4,
      potencyBp: 700,
      capBp: 2_000,
    });
  });

  it("the Mage is frailer than the Monk in raw HP/armor at every level", () => {
    const mage = content.classDef("mage");
    const monk = content.classDef("monk");
    for (let level = 1; level <= 30; level += 1) {
      const hp = (c: typeof mage) => c.base.hp + c.growth.hp * (level - 1);
      const armor = (c: typeof mage) => c.base.armor + c.growth.armor * (level - 1);
      expect(hp(mage)).toBeLessThanOrEqual(hp(monk));
      expect(armor(mage)).toBeLessThanOrEqual(armor(monk));
    }
  });

  it("a real Darkwood Boss fight: the ward absorbs damage, and the fight replays identically", () => {
    const p = newProfile(3, "mage", "monk");
    setLevel(p, 10);
    setMastery(p, "mage", 7);
    for (const baseId of ["bloodletter", "seers_circlet", "ironbark_mantle", "flowing_wraps", "huntsmans_stride", "ember_seal"]) {
      const item = content.item(baseId);
      p.inventory.instances.push({ id: p.inventory.nextInstanceId, baseId, acquiredSeq: p.inventory.nextInstanceId, isNew: false });
      p.equipment[item.slot as SlotId] = p.inventory.nextInstanceId;
      p.inventory.nextInstanceId += 1;
    }
    const build = currentBuild(p);
    const hero = resolveHeroStats(content, build, equippedInstances(p, build));
    const setup = buildEncounter(content, "darkwood", 9, noRules);
    const input: FightInput = { seed: 11, hero, startHp100: null, enemies: setup.enemies, effects: noRules, config: content.snapshot.config };
    const a = new ArraySink();
    const b = new ArraySink();
    const first = simulateFight(input, a);
    const second = simulateFight(input, b);
    expect(canonicalJson(first)).toBe(canonicalJson(second));
    expect(canonicalJson(a.events)).toBe(canonicalJson(b.events));
    expect(first.counters.absorbed100).toBeGreaterThan(0);
    expect(first.counters.procs["arcane_ward"]).toBeGreaterThan(0);
    // Absorbed + HP lost = the damage enemies dealt to the hero.
    const dealt = enemyHitsOnHero(a.events).reduce((s, e) => s + Number(e.abs) + Number(e.eff), 0);
    const ticks = a.events.filter((e) => e.type === "tick" && e.tgt === "hero").reduce((s, e) => s + Number(e.abs) + Number(e.eff), 0);
    expect(dealt + ticks).toBe(first.counters.absorbed100! + first.counters.damageTaken100);
  });
});

describe("Mage ward: validation", () => {
  const withWard = (patch: Record<string, number>) => () => {
    const snap: ContentSnapshot = JSON.parse(JSON.stringify(CONTENT));
    const track = snap.masteryTracks.find((t) => t.id === "mastery_mage")!;
    const technique = track.techniques.find((t) => t.id === "mage_arcane_ward")!;
    Object.assign(technique.add![0]!, patch);
    return new ContentIndex(snap);
  };

  it("accepts the shipped ward", () => {
    expect(withWard({})).not.toThrow();
  });

  it("rejects a start ward above the cap", () => {
    expect(withWard({ startBp: 3_000, capBp: 2_000 })).toThrow(/startBp 3000 above capBp 2000/);
  });

  it("rejects out-of-range values", () => {
    expect(withWard({ capBp: 0 })).toThrow(/capBp 0 outside/);
    expect(withWard({ capBp: 20_000 })).toThrow(/capBp 20000 outside/);
    expect(withWard({ every: 0 })).toThrow(/every 0 outside/);
  });
});
