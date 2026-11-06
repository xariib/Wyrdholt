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
  techniqueStatuses,
  type EnemyInit,
  type FightInput,
  type HeroStats,
} from "@emberbound/game-core";
import { content, newProfile, setLevel, setMastery } from "./helpers";

// ---------------------------------------------------------------------------
// Helpers: synthetic heroes/enemies for exact mechanic checks, and real builds.
// ---------------------------------------------------------------------------

const exactConfig = { ...content.snapshot.config, damageVarianceBp: 0 };
const noRules = combineRuleEffects(content, []);

function synthHero(
  mechanics: MechanicDef[],
  opts: { attack?: number; hp?: number; rate?: number; crit?: number; armor?: number; sources?: ("class" | "item")[] } = {},
): HeroStats {
  const attack = opts.attack ?? 100;
  const hp = opts.hp ?? 100_000;
  return {
    classId: "synthetic",
    level: 1,
    masteryRank: 1,
    maxHp100: hp * 100,
    attack100: attack * 100,
    armor: opts.armor ?? 0,
    attackRateMilli: opts.rate ?? 1_000,
    critBp: opts.crit ?? 0,
    damageType: "physical",
    mechanics,
    mechanicSources: opts.sources ?? mechanics.map(() => "class"),
    display: { hp, attack, armor: opts.armor ?? 0, attackRateMilli: opts.rate ?? 1_000, critBp: opts.crit ?? 0 },
    activeEffects: [],
  };
}

function synthEnemy(index: number, hp: number, opts: { hit?: number; rate?: number; armor?: number } = {}): EnemyInit {
  return {
    id: `e${index}`,
    index,
    archetypeId: "test",
    name: `Test ${index}`,
    maxHp100: hp * 100,
    hitDamage100: (opts.hit ?? 1) * 100,
    attackRateMilli: opts.rate ?? 1_000,
    armor: opts.armor ?? 0,
    damageType: "physical",
    sprite: "slime",
  };
}

function fight(hero: HeroStats, enemies: EnemyInit[], seed = 7, config = exactConfig) {
  const sink = new ArraySink();
  const summary = simulateFight({ seed, hero, startHp100: null, enemies, effects: noRules, config }, sink);
  return { events: sink.events, summary };
}

function realInput(cls: string, opts: { level: number; rank: number; gear?: string[]; zone?: string; stage: number; seed?: number }): FightInput {
  const other = cls === "monk" ? "mage" : "monk";
  const p = newProfile(1, cls, other);
  setLevel(p, opts.level);
  setMastery(p, cls, opts.rank);
  for (const baseId of opts.gear ?? []) {
    const item = content.item(baseId);
    p.inventory.instances.push({ id: p.inventory.nextInstanceId, baseId, acquiredSeq: p.inventory.nextInstanceId, isNew: false });
    p.equipment[item.slot as SlotId] = p.inventory.nextInstanceId;
    p.inventory.nextInstanceId += 1;
  }
  const build = currentBuild(p);
  const hero = resolveHeroStats(content, build, equippedInstances(p, build));
  const setup = buildEncounter(content, opts.zone ?? "greenfields", opts.stage, noRules);
  return { seed: opts.seed ?? 42, hero, startHp100: null, enemies: setup.enemies, effects: noRules, config: content.snapshot.config };
}

function runReal(i: FightInput) {
  const sink = new ArraySink();
  return { events: sink.events, summary: simulateFight(i, sink) };
}

const hits = (events: CombatEvent[], via?: string) => events.filter((e) => e.type === "hit" && (via === undefined || e.via === via));
const statusEvents = (events: CombatEvent[], status: string) => events.filter((e) => e.type === "status" && e.status === status);

/** Replays the event stream and returns, for every event index, the set of dead actors before it. */
function deadBefore(events: CombatEvent[]): Set<string>[] {
  const dead = new Set<string>();
  return events.map((e) => {
    const snapshot = new Set(dead);
    if (e.type === "death") dead.add(String(e.actor));
    return snapshot;
  });
}

const bleedStrikes: MechanicDef = { kind: "on_hit_dot", id: "bleeding_strikes", statusId: "bleed", chanceBp: 10_000, maxStacks: 3, tickMs: 1_000, durationMs: 5_000, potencyBp: 1_000 };
const poisonShots: MechanicDef = { kind: "on_hit_dot", id: "poisoned_shots", statusId: "poison", chanceBp: 10_000, maxStacks: 6, tickMs: 1_000, durationMs: 9_000, potencyBp: 1_000 };

// ---------------------------------------------------------------------------

describe("Warrior and Ranger kits", () => {
  it("unlock exactly at M1 / M5 / M10 / M15 / M20", () => {
    const expected: Record<string, [number, string][]> = {
      warrior: [
        [1, "Bleeding Strikes"],
        [5, "Retaliation"],
        [10, "Execute"],
        [15, "Deep Wounds"],
        [20, "Relentless Finish"],
      ],
      ranger: [
        [1, "Poisoned Shots"],
        [5, "Split Arrow"],
        [10, "Piercing Shot"],
        [15, "Lingering Hunt"],
        [20, "Venom Burst"],
      ],
    };
    for (const [cls, list] of Object.entries(expected)) {
      expect(content.classDef(cls).implemented).toBe(true);
      const statuses = techniqueStatuses(content, cls, 20);
      expect(statuses.map((s) => [s.technique.unlockRank, s.technique.name])).toEqual(list);
      for (const [rank] of list) {
        expect(techniqueStatuses(content, cls, rank - 1).filter((s) => s.unlocked)).toHaveLength(list.filter(([r]) => r < rank).length);
        expect(techniqueStatuses(content, cls, rank).filter((s) => s.unlocked)).toHaveLength(list.filter(([r]) => r <= rank).length);
      }
    }
  });

  it("resolve the documented mechanics per milestone (patches change parameters, not stats)", () => {
    const ids = (cls: string, rank: number) => resolveClassMechanics(content, cls, rank).map((m) => m.id);
    expect(ids("warrior", 1)).toEqual(["bleeding_strikes"]);
    expect(ids("warrior", 9)).toEqual(["bleeding_strikes", "retaliation"]);
    expect(ids("warrior", 14)).toEqual(["bleeding_strikes", "retaliation", "execute"]);
    expect(ids("warrior", 20)).toEqual(["bleeding_strikes", "retaliation", "execute", "relentless_finish"]);
    const w15 = resolveClassMechanics(content, "warrior", 15);
    expect(w15.find((m) => m.id === "bleeding_strikes")).toMatchObject({ maxStacks: 5 });
    expect(w15.find((m) => m.id === "retaliation")).toMatchObject({ appliesDots: 1 });
    expect(resolveClassMechanics(content, "warrior", 20).find((m) => m.id === "execute")).toMatchObject({ thresholdBp: 3_500 });

    expect(ids("ranger", 1)).toEqual(["poisoned_shots"]);
    expect(ids("ranger", 5)).toEqual(["poisoned_shots", "split_arrow"]);
    expect(ids("ranger", 10)).toEqual(["poisoned_shots", "split_arrow", "piercing_shot", "piercing_strike"]);
    expect(ids("ranger", 20)).toEqual(["poisoned_shots", "split_arrow", "piercing_shot", "piercing_strike", "venom_burst"]);
    const r15 = resolveClassMechanics(content, "ranger", 15);
    expect(r15.find((m) => m.id === "poisoned_shots")).toMatchObject({ maxStacks: 6, durationMs: 9_000 });
    expect(r15.find((m) => m.id === "split_arrow")).toMatchObject({ targets: 2 });
    // The catalog is never mutated by patches.
    expect(resolveClassMechanics(content, "ranger", 1)[0]).toMatchObject({ maxStacks: 4 });
  });

  it("are immediately viable solo: M1 at level 1 clears the opening fight for all four classes", () => {
    for (const cls of ["warrior", "monk", "mage", "ranger"]) {
      const { summary } = runReal(realInput(cls, { level: 1, rank: 1, stage: 0 }));
      expect(summary.outcome, cls).toBe("victory");
    }
  });
});

describe("status ownership (class vs item DoTs)", () => {
  it("gives an item DoT its own line when the class already owns that status", () => {
    const warrior = realInput("warrior", { level: 8, rank: 1, gear: ["bloodletter"], stage: 4 }).hero;
    expect(warrior.mechanics.map((m) => ("statusId" in m ? m.statusId : null))).toEqual(["bleed", "bleed:rend"]);
    const ranger = realInput("ranger", { level: 8, rank: 1, gear: ["venom_grips"], stage: 4 }).hero;
    expect(ranger.mechanics.map((m) => ("statusId" in m ? m.statusId : null))).toEqual(["poison", "poison:poison_touch"]);
    // No overlap, no rename (C1 content keeps its status ids).
    const monk = realInput("monk", { level: 8, rank: 20, gear: ["bloodletter", "venom_grips"], stage: 4 }).hero;
    expect(monk.mechanics.filter((m) => m.kind === "on_hit_dot").map((m) => ("statusId" in m ? m.statusId : null))).toEqual(["bleed", "poison"]);
  });

  it("keeps Bleed stacks and damage attribution per owner", () => {
    const { events, summary } = runReal(realInput("warrior", { level: 8, rank: 1, gear: ["bloodletter"], stage: 4, seed: 11 }));
    const classStacks = statusEvents(events, "bleed").map((e) => Number(e.stacks));
    const itemStacks = statusEvents(events, "bleed:rend").map((e) => Number(e.stacks));
    expect(Math.max(...classStacks)).toBe(3);
    expect(itemStacks.length).toBeGreaterThan(0);
    expect(Math.max(...itemStacks)).toBe(1);
    const tickSum = (status: string) =>
      events.filter((e) => e.type === "tick" && e.status === status).reduce((s, e) => s + Number(e.eff), 0);
    // Bloodletter's only effect is Rend, so all item damage is Rend ticks.
    expect(summary.counters.damageItem100).toBe(tickSum("bleed:rend"));
    expect(summary.counters.damageDot100).toBe(tickSum("bleed") + tickSum("bleed:rend"));
  });

  it("keeps Poison stacks and attribution per owner, and Venom Burst only consumes the class line", () => {
    const { events, summary } = runReal(
      realInput("ranger", { level: 14, rank: 20, gear: ["venom_grips"], zone: "darkwood", stage: 4, seed: 5 }),
    );
    expect(Math.max(...statusEvents(events, "poison").map((e) => Number(e.stacks)))).toBeLessThanOrEqual(6);
    expect(Math.max(...statusEvents(events, "poison:poison_touch").map((e) => Number(e.stacks)))).toBe(1);
    const ends = events.filter((e) => e.type === "status_end");
    const bursts = hits(events, "venom_burst");
    expect(bursts.length).toBeGreaterThan(0);
    // Every burst is preceded (same ms, same target) by the end of the class Poison line only.
    for (const b of bursts) {
      const sameMoment = ends.filter((e) => e.t === b.t && e.tgt === b.tgt);
      expect(sameMoment.map((e) => e.status)).toContain("poison");
      expect(sameMoment.map((e) => e.status)).not.toContain("poison:poison_touch");
    }
    expect(summary.counters.procs["venom_burst"]).toBe(bursts.length);
  });
});

describe("Bleed and Poison stacking", () => {
  it("stacks Bleed per target, capped, and never on a target that was not hit", () => {
    const { events } = fight(synthHero([bleedStrikes]), [synthEnemy(0, 2_000), synthEnemy(1, 2_000)]);
    const e0 = statusEvents(events, "bleed").filter((e) => e.tgt === "e0").map((e) => Number(e.stacks));
    expect(e0.slice(0, 4)).toEqual([1, 2, 3, 3]);
    const firstE0Death = events.findIndex((e) => e.type === "death" && e.actor === "e0");
    const e1Before = events.slice(0, firstE0Death).filter((e) => e.type === "status" && e.tgt === "e1");
    expect(e1Before).toHaveLength(0);
    for (const e of statusEvents(events, "bleed")) expect(Number(e.stacks)).toBeLessThanOrEqual(3);
  });

  it("ticks deal exactly stacks x per-stack damage and ignore armor", () => {
    const { events } = fight(synthHero([bleedStrikes]), [synthEnemy(0, 5_000, { armor: 200 })]);
    const ticks = events.filter((e) => e.type === "tick");
    expect(ticks.length).toBeGreaterThan(3);
    for (const tk of ticks) expect(Number(tk.amt)).toBe(10 * 100 * Number(tk.stacks));
  });
});

describe("Split Arrow", () => {
  const split = (targets: number): MechanicDef => ({
    kind: "nth_attack_split",
    id: "split_arrow",
    every: 1,
    targets,
    potencyBp: 5_000,
    damageType: "physical",
    appliesDots: 1,
  });

  it("does nothing extra against a single enemy (identical to a kit without it)", () => {
    const withSplit = fight(synthHero([poisonShots, split(2)]), [synthEnemy(0, 3_000, { hit: 5 })], 3);
    const without = fight(synthHero([poisonShots]), [synthEnemy(0, 3_000, { hit: 5 })], 3);
    expect(hits(withSplit.events, "split_arrow")).toHaveLength(0);
    expect(withSplit.summary.counters.procs["split_arrow"]).toBeUndefined();
    expect(canonicalJson(withSplit.events)).toBe(canonicalJson(without.events));
    expect(canonicalJson(withSplit.summary)).toBe(canonicalJson(without.summary));
  });

  it("only ever hits living enemies other than the attack's target", () => {
    for (const count of [2, 3]) {
      for (const targets of [1, 2]) {
        const enemies = Array.from({ length: count }, (_, i) => synthEnemy(i, 400 + i * 150, { hit: 3 }));
        const { events } = fight(synthHero([poisonShots, split(targets)], { attack: 120 }), enemies, 9);
        const dead = deadBefore(events);
        let attackTarget = "";
        let splitsThisAttack = 0;
        events.forEach((e, i) => {
          if (e.type === "attack" && e.src === "hero") {
            attackTarget = String(e.tgt);
            splitsThisAttack = 0;
          }
          if (e.type === "hit" && e.via === "split_arrow") {
            splitsThisAttack += 1;
            expect(e.tgt, `split hit a dead enemy (${count} enemies, ${targets} targets)`).not.toSatisfy((t: string) => dead[i]!.has(t));
            expect(e.tgt).not.toBe(attackTarget);
            expect(splitsThisAttack).toBeLessThanOrEqual(Math.min(targets, count - 1));
          }
        });
        expect(hits(events, "split_arrow").length).toBeGreaterThan(0);
      }
    }
  });

  it("poisons its secondary target (class Poison) before the main target dies", () => {
    const { events } = fight(synthHero([poisonShots, split(1)]), [synthEnemy(0, 3_000), synthEnemy(1, 3_000)]);
    const firstDeath = events.findIndex((e) => e.type === "death");
    const e1Poison = events.slice(0, firstDeath).filter((e) => e.type === "status" && e.tgt === "e1" && e.status === "poison");
    expect(e1Poison.length).toBeGreaterThan(0);
  });

  it("still picks another living enemy when the basic hit killed the main target", () => {
    // e0 dies to the first basic hit; the split on that attack must go to e1, not e0.
    const { events } = fight(synthHero([split(1)], { attack: 100 }), [synthEnemy(0, 50), synthEnemy(1, 5_000)]);
    const firstSplit = hits(events, "split_arrow")[0]!;
    const e0Death = events.find((e) => e.type === "death" && e.actor === "e0")!;
    expect(e0Death.t).toBe(firstSplit.t);
    expect(firstSplit.tgt).toBe("e1");
  });
});

describe("Execute and Relentless Finish", () => {
  const execute: MechanicDef = { kind: "execute", id: "execute", thresholdBp: 3_000, bonusBp: 5_000 };

  it("adds the bonus exactly at or below the threshold of the struck target", () => {
    // 1,000 HP, 100 per hit: 1000..400 are above 30%, 300 is exactly 30%, then below.
    const { events } = fight(synthHero([execute]), [synthEnemy(0, 1_000)]);
    const amounts = hits(events, "basic")
      .filter((e) => e.src === "hero")
      .map((e) => Number(e.amt) / 100);
    expect(amounts).toEqual([100, 100, 100, 100, 100, 100, 100, 150, 150]);
  });

  it("evaluates each hit's own target (split hit on a low enemy, basic hit on a healthy one)", () => {
    const split: MechanicDef = { kind: "nth_attack_split", id: "split", every: 1, targets: 1, potencyBp: 10_000, damageType: "physical", appliesDots: 0 };
    const { events } = fight(synthHero([execute, split]), [synthEnemy(0, 100_000), synthEnemy(1, 1_000)]);
    const onE0 = hits(events).filter((e) => e.src === "hero" && e.tgt === "e0").map((e) => Number(e.amt) / 100);
    const onE1 = hits(events).filter((e) => e.src === "hero" && e.tgt === "e1").map((e) => Number(e.amt) / 100);
    expect(new Set(onE0.slice(0, 10))).toEqual(new Set([100]));
    expect(onE1).toEqual([100, 100, 100, 100, 100, 100, 100, 150, 150]);
  });

  it("Relentless Finish only strikes targets inside its HP condition", () => {
    const finish: MechanicDef = { kind: "nth_hit_extra_damage", id: "relentless_finish", every: 1, potencyBp: 4_000, damageType: "physical", requiresTargetHpBelowBp: 3_000 };
    const { events } = fight(synthHero([finish]), [synthEnemy(0, 1_000)]);
    const dead = new Set<string>();
    let hpAfterBasic = 1_000 * 100;
    for (const e of events) {
      if (e.type === "hit" && e.via === "basic" && e.src === "hero") hpAfterBasic = Number(e.hp);
      if (e.type === "hit" && e.via === "relentless_finish") {
        expect(hpAfterBasic * 10_000).toBeLessThanOrEqual(3_000 * 1_000 * 100);
      }
      if (e.type === "death") dead.add(String(e.actor));
    }
    expect(hits(events, "relentless_finish").length).toBeGreaterThan(0);
  });
});

describe("Retaliation", () => {
  const retaliate = (over: Partial<Extract<MechanicDef, { kind: "on_damaged_retaliate" }>> = {}): MechanicDef => ({
    kind: "on_damaged_retaliate",
    id: "retaliation",
    chanceBp: 10_000,
    potencyBp: 5_000,
    damageType: "physical",
    cooldownMs: 0,
    appliesDots: 0,
    ...over,
  });

  it("strikes back at most once per enemy attack and never triggers itself", () => {
    const enemies = [synthEnemy(0, 3_000, { rate: 2_500 }), synthEnemy(1, 3_000, { rate: 3_000 }), synthEnemy(2, 3_000, { rate: 2_000 })];
    const { events, summary } = fight(synthHero([retaliate()], { attack: 10, rate: 500 }), enemies);
    let pending = 0;
    let attacker = "";
    for (const e of events) {
      if (e.type === "attack" && e.src !== "hero") {
        pending = 1;
        attacker = String(e.src);
      } else if (e.type === "attack") {
        pending = 0;
      }
      if (e.type === "hit" && e.via === "retaliation") {
        expect(pending).toBe(1);
        expect(e.tgt).toBe(attacker);
        pending = 0;
      }
    }
    expect(summary.counters.procs["retaliation"]).toBe(hits(events, "retaliation").length);
    expect(summary.counters.procs["retaliation"]!).toBeLessThanOrEqual(summary.counters.enemyAttacks);
    expect(summary.counters.procs["retaliation"]!).toBeGreaterThan(10);
  });

  it("respects its cooldown", () => {
    const enemies = [synthEnemy(0, 50_000, { rate: 4_000 }), synthEnemy(1, 50_000, { rate: 4_000 })];
    const { events } = fight(synthHero([retaliate({ cooldownMs: 1_000 })], { attack: 10 }), enemies);
    const times = hits(events, "retaliation").map((e) => e.t);
    for (let i = 1; i < times.length; i += 1) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(1_000);
    expect(times.length).toBeGreaterThan(5);
  });

  it("an enemy killed by retaliation never attacks again", () => {
    const enemies = [synthEnemy(0, 100_000, { rate: 500 }), synthEnemy(1, 30, { rate: 3_000 })];
    const { events } = fight(synthHero([retaliate({ potencyBp: 10_000 })], { attack: 100, rate: 200 }), enemies);
    const death = events.findIndex((e) => e.type === "death" && e.actor === "e1");
    expect(death).toBeGreaterThan(-1);
    expect(events[death - 1]).toMatchObject({ type: "hit", via: "retaliation", tgt: "e1" });
    expect(events.slice(death).filter((e) => e.type === "attack" && e.src === "e1")).toHaveLength(0);
  });

  it("does not trigger on a killing blow against the hero, nor from DoT ticks", () => {
    const { events } = fight(synthHero([retaliate()], { hp: 1 }), [synthEnemy(0, 1_000, { hit: 500 })]);
    expect(hits(events, "retaliation")).toHaveLength(0);
    expect(events.at(-1)).toMatchObject({ type: "end", outcome: "defeat" });
  });

  it("with Deep Wounds applies the class Bleed to the attacker", () => {
    const enemies = [synthEnemy(0, 100_000, { rate: 200 }), synthEnemy(1, 100_000, { rate: 1_500 })];
    const { events } = fight(synthHero([bleedStrikes, retaliate({ appliesDots: 1 })], { attack: 10, rate: 200 }), enemies);
    // The hero only attacks e0, so any Bleed on e1 comes from retaliation.
    expect(statusEvents(events, "bleed").filter((e) => e.tgt === "e1").length).toBeGreaterThan(0);
  });
});

describe("Venom Burst", () => {
  const burst: MechanicDef = { kind: "stack_burst", id: "venom_burst", statusId: "poison", minStacks: 6, potencyBp: 40_000 };

  it("bursts on the hit that reaches the stack cap, for exactly 4 ticks of 6 stacks, then resets", () => {
    const { events } = fight(synthHero([poisonShots, burst], { attack: 10 }), [synthEnemy(0, 50_000)]);
    const bursts = hits(events, "venom_burst");
    expect(bursts.length).toBeGreaterThan(2);
    for (const b of bursts) expect(Number(b.amt)).toBe(6 * 1 * 100 * 4);
    // Stacks climb 1..6 between bursts; the burst consumes the line.
    const stacks = statusEvents(events, "poison").map((e) => Number(e.stacks));
    expect(stacks.slice(0, 12)).toEqual([1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6]);
    const firstBurst = events.indexOf(bursts[0]!);
    expect(events[firstBurst - 1]).toMatchObject({ type: "status_end", status: "poison", tgt: "e0" });
  });

  it("is deterministic and draws no randomness of its own", () => {
    const a = fight(synthHero([poisonShots, burst], { attack: 10, crit: 2_500 }), [synthEnemy(0, 50_000)], 21);
    const b = fight(synthHero([poisonShots, burst], { attack: 10, crit: 2_500 }), [synthEnemy(0, 50_000)], 21);
    const c = fight(synthHero([poisonShots], { attack: 10, crit: 2_500 }), [synthEnemy(0, 50_000)], 21);
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    // Same number of hero attacks drawn in the same order: the burst adds no draws per attack.
    const drawsPerAttack = (x: typeof a) => x.summary.rngDraws / x.summary.counters.heroAttacks;
    expect(drawsPerAttack(a)).toBeCloseTo(drawsPerAttack(c), 1);
  });
});

describe("proc and speed bounds", () => {
  it("one hero attack creates a bounded number of hits (no proc loops)", () => {
    for (const [cls, gear] of [
      ["ranger", ["venom_grips", "stormcaller", "ember_seal"]],
      ["warrior", ["bloodletter", "venom_grips", "ember_seal"]],
    ] as const) {
      for (const stage of [0, 1, 6]) {
        const { events } = runReal(realInput(cls, { level: 20, rank: 20, gear: [...gear], stage }));
        let perAttack = 0;
        for (const e of events) {
          if (e.type === "attack") perAttack = 0;
          if (e.type === "hit" && e.src === "hero" && e.via !== "retaliation") {
            perAttack += 1;
            expect(perAttack, `${cls} stage ${stage}`).toBeLessThanOrEqual(6);
          }
        }
      }
    }
  });

  it("haste never pushes attacks below the minimum interval", () => {
    const haste: MechanicDef = { kind: "nth_hit_haste", id: "frenzy", every: 1, statusId: "frenzy", hasteBp: 50_000, durationMs: 60_000 };
    const other: MechanicDef = { kind: "nth_hit_haste", id: "frenzy2", every: 1, statusId: "frenzy2", hasteBp: 50_000, durationMs: 60_000 };
    const { events, summary } = fight(synthHero([haste, other], { attack: 1, rate: 20_000 }), [synthEnemy(0, 1_000_000)]);
    const times = events.filter((e) => e.type === "attack" && e.src === "hero").map((e) => e.t);
    for (let i = 1; i < times.length; i += 1) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(exactConfig.minAttackIntervalMs);
    expect(summary.outcome).toBe("timeout");
    expect(summary.counters.heroAttacks).toBeLessThanOrEqual(Math.ceil(exactConfig.maxFightMs / exactConfig.minAttackIntervalMs) + 1);
  });
});

describe("multi-target determinism (1, 2 and 3 enemies)", () => {
  const cases: { zone: string; stage: number; enemies: number }[] = [
    { zone: "greenfields", stage: 0, enemies: 1 },
    { zone: "greenfields", stage: 1, enemies: 2 },
    { zone: "greenfields", stage: 6, enemies: 3 },
    { zone: "darkwood", stage: 9, enemies: 3 },
    { zone: "ashen_mountains", stage: 9, enemies: 1 },
  ];
  it.each(["warrior", "ranger"])("%s: same input, same complete result; recording never changes it", (cls) => {
    for (const c of cases) {
      expect(content.zone(c.zone).stages[c.stage]!.enemies).toHaveLength(c.enemies);
      for (const rank of [1, 5, 10, 15, 20]) {
        for (const seed of [1, 99]) {
          const i = realInput(cls, { level: 16, rank, zone: c.zone, stage: c.stage, seed, gear: ["venom_grips", "bloodletter"] });
          const a = runReal(i);
          const b = runReal(structuredClone(i));
          expect(canonicalJson(a)).toBe(canonicalJson(b));
          const silent = simulateFight(i, NULL_SINK);
          expect(canonicalJson({ ...silent, eventCount: 0 })).toBe(canonicalJson({ ...a.summary, eventCount: 0 }));
          for (const e of a.events) for (const v of Object.values(e)) if (typeof v === "number") expect(Number.isSafeInteger(v)).toBe(true);
        }
      }
    }
  });
});

describe("class-kit validation", () => {
  const withTrack = (trackId: string, edit: (techniques: ContentSnapshot["masteryTracks"][number]["techniques"]) => void) => () => {
    const snap = JSON.parse(JSON.stringify(CONTENT)) as ContentSnapshot;
    edit(snap.masteryTracks.find((t) => t.id === trackId)!.techniques);
    return new ContentIndex(snap);
  };

  it("accepts the shipped content", () => {
    expect(() => new ContentIndex(CONTENT)).not.toThrow();
  });

  it("rejects a Venom Burst that can never reach its stack count", () => {
    expect(
      withTrack("mastery_ranger", (t) => {
        (t[4]!.add![0] as { minStacks: number }).minStacks = 7;
      }),
    ).toThrow(/needs 7 poison stacks/);
  });

  it("rejects Split Arrow with more than two extra targets", () => {
    expect(
      withTrack("mastery_ranger", (t) => {
        t[3]!.patch![1]!.set.targets = 3;
      }),
    ).toThrow(/targets 3/);
  });

  it("rejects a patch of a locked or unknown mechanic", () => {
    expect(
      withTrack("mastery_warrior", (t) => {
        t[0]!.unlockRank = 10;
        t[1]!.unlockRank = 1;
      }),
    ).toThrow();
  });

  it("rejects a class mechanic id that an item effect already uses", () => {
    expect(
      withTrack("mastery_warrior", (t) => {
        (t[0]!.add![0] as { id: string }).id = "rend";
      }),
    ).toThrow(/also an item effect id/);
  });
});
