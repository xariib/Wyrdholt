import { describe, expect, it } from "vitest";
import {
  ArraySink,
  NULL_SINK,
  buildEncounter,
  canonicalJson,
  combineRuleEffects,
  currentBuild,
  equippedInstances,
  resolveHeroStats,
  simulateFight,
  type FightInput,
} from "@emberbound/game-core";
import type { CombatEvent } from "@emberbound/shared-types";
import { content, newProfile, setLevel, setMastery } from "./helpers";

function input(opts: {
  cls?: string;
  level?: number;
  rank?: number;
  stage?: number;
  seed?: number;
  startHp100?: number | null;
  rules?: string[];
  gear?: string[];
}): FightInput {
  const cls = opts.cls ?? "monk";
  const p = newProfile(1, cls, cls === "monk" ? "mage" : "monk");
  setLevel(p, opts.level ?? 3);
  setMastery(p, cls, opts.rank ?? 1);
  for (const baseId of opts.gear ?? []) {
    const item = content.item(baseId);
    p.inventory.instances.push({ id: p.inventory.nextInstanceId, baseId, acquiredSeq: p.inventory.nextInstanceId, isNew: false });
    p.equipment[item.slot] = p.inventory.nextInstanceId;
    p.inventory.nextInstanceId += 1;
  }
  const build = currentBuild(p);
  const hero = resolveHeroStats(content, build, equippedInstances(p, build));
  const effects = combineRuleEffects(content, opts.rules ?? []);
  const setup = buildEncounter(content, "greenfields", opts.stage ?? 0, effects);
  return {
    seed: opts.seed ?? 42,
    hero,
    startHp100: opts.startHp100 ?? null,
    enemies: setup.enemies,
    effects,
    config: content.snapshot.config,
  };
}

function run(i: FightInput): { events: CombatEvent[]; summary: ReturnType<typeof simulateFight> } {
  const sink = new ArraySink();
  const summary = simulateFight(i, sink);
  return { events: sink.events, summary };
}

describe("combat engine", () => {
  it("is deterministic for identical inputs", () => {
    const a = run(input({ stage: 6, rank: 20, level: 6 }));
    const b = run(input({ stage: 6, rank: 20, level: 6 }));
    expect(canonicalJson(a.events)).toBe(canonicalJson(b.events));
    expect(canonicalJson(a.summary)).toBe(canonicalJson(b.summary));
  });

  it("gives identical results with and without event recording (rendering cannot change outcomes)", () => {
    const i = input({ stage: 8, cls: "mage", rank: 20, level: 6, gear: ["ember_seal", "stormcaller"] });
    const recorded = run(i).summary;
    const silent = simulateFight(i, NULL_SINK);
    expect(canonicalJson({ ...silent, eventCount: 0 })).toBe(canonicalJson({ ...recorded, eventCount: 0 }));
  });

  it("different seeds produce different fights", () => {
    const a = run(input({ stage: 9, seed: 1 }));
    const b = run(input({ stage: 9, seed: 2 }));
    expect(canonicalJson(a.events)).not.toBe(canonicalJson(b.events));
  });

  it("uses integer time and values only", () => {
    const { events } = run(input({ stage: 9, cls: "mage", rank: 20, level: 5 }));
    for (const e of events) {
      for (const v of Object.values(e)) if (typeof v === "number") expect(Number.isSafeInteger(v)).toBe(true);
    }
    for (let k = 1; k < events.length; k += 1) expect(events[k]!.t).toBeGreaterThanOrEqual(events[k - 1]!.t);
  });

  it("produces critical hits with the crit multiplier", () => {
    const { events, summary } = run(input({ stage: 9, level: 6, gear: ["seers_circlet", "scout_hood"], seed: 3 }));
    const crits = events.filter((e) => e.type === "hit" && e.crit === 1 && e.src === "hero");
    expect(crits.length).toBeGreaterThan(0);
    expect(summary.counters.crits).toBe(crits.length);
  });

  it("applies and ticks DoTs, and DoT ticks come before attacks at the same moment", () => {
    const { events, summary } = run(input({ cls: "mage", stage: 9, level: 4 }));
    const ticks = events.filter((e) => e.type === "tick");
    expect(ticks.length).toBeGreaterThan(0);
    expect(summary.counters.damageDot100).toBeGreaterThan(0);
    for (let k = 1; k < events.length; k += 1) {
      const prev = events[k - 1]!;
      const cur = events[k]!;
      if (prev.t === cur.t && prev.type === "attack") expect(cur.type).not.toBe("tick");
    }
  });

  it("Kindled Flame raises class Burn to 2 stacks at M15 only", () => {
    const low = run(input({ cls: "mage", stage: 9, level: 4, rank: 14 }));
    const high = run(input({ cls: "mage", stage: 9, level: 4, rank: 15 }));
    const maxStacks = (ev: CombatEvent[]) =>
      Math.max(...ev.filter((e) => e.type === "status" && e.status === "burn").map((e) => Number(e.stacks)));
    expect(maxStacks(low.events)).toBe(1);
    expect(maxStacks(high.events)).toBe(2);
  });

  it("Restoring Rhythm heals every third hit, capped at max HP, at most once per 4s", () => {
    const { events } = run(input({ stage: 9, level: 3, startHp100: 3_000 }));
    const heals = events.filter((e) => e.type === "heal" && e.via === "restoring_rhythm");
    expect(heals.length).toBeGreaterThan(0);
    for (let k = 1; k < heals.length; k += 1) expect(heals[k]!.t - heals[k - 1]!.t).toBeGreaterThanOrEqual(4_000);
    const max = Number(events.find((e) => e.type === "spawn" && e.actor === "hero")!.max);
    for (const h of heals) expect(Number(h.hp)).toBeLessThanOrEqual(max);
  });

  it("records death and defeat when the hero falls", () => {
    const { events, summary } = run(input({ stage: 9, level: 1, startHp100: 200 }));
    expect(summary.outcome).toBe("defeat");
    expect(events.some((e) => e.type === "death" && e.actor === "hero")).toBe(true);
    expect(events[events.length - 1]!.type).toBe("end");
  });

  it("handles 1, 2 and 3 enemies; splash hits every living enemy", () => {
    for (const stage of [0, 1, 6]) {
      const i = input({ stage, cls: "mage", rank: 5, level: 5, rules: stage === 6 ? ["test_enemy_tough", "test_enemy_soft"] : [] });
      const expected = stage === 0 ? 1 : stage === 1 ? 2 : 3;
      expect(i.enemies.length).toBe(expected);
      const { events, summary } = run(i);
      expect(summary.enemies.length).toBe(expected);
      if (expected === 3) {
        const firstSplash = events.filter((e) => e.type === "hit" && e.via === "wildfire");
        const t0 = firstSplash[0]!.t;
        expect(firstSplash.filter((e) => e.t === t0).length).toBe(3);
      }
    }
  });

  it("times out at the configured cap", () => {
    const fixture = input({ stage: 9, level: 1, rules: ["test_enemy_tough", "test_enemy_soft"] });
    fixture.hero.maxHp100 = 100_000; // Controlled survival: this test exercises the time cap.
    const { summary } = run(fixture);
    expect(summary.outcome).toBe("timeout");
    expect(summary.durationMs).toBe(content.snapshot.config.maxFightMs);
  });

  it("Flow State haste shortens attack intervals", () => {
    const { events } = run(input({ stage: 9, level: 6, rank: 10, rules: ["test_enemy_tough", "test_enemy_soft"] }));
    const flow = events.find((e) => e.type === "status" && e.status === "flow");
    expect(flow).toBeDefined();
    const heroAttacks = events.filter((e) => e.type === "attack" && e.src === "hero").map((e) => e.t);
    const gaps = heroAttacks.slice(1).map((t, k) => t - heroAttacks[k]!);
    expect(Math.min(...gaps)).toBeLessThan(Math.max(...gaps));
  });
});

describe("encounter budgets", () => {
  it("members share the stage budget instead of multiplying it", () => {
    const effects = combineRuleEffects(content, []);
    for (const stage of content.zone("greenfields").stages) {
      const setup = buildEncounter(content, "greenfields", stage.index, effects);
      const totalHp = setup.enemies.reduce((s, e) => s + e.maxHp100, 0);
      expect(Math.abs(totalHp - stage.hpBudget * 100)).toBeLessThanOrEqual(setup.enemies.length);
      const dps = setup.enemies.reduce((s, e) => s + Math.round((e.hitDamage100 * e.attackRateMilli) / 1000), 0);
      expect(Math.abs(dps - stage.dpsBudget100) / stage.dpsBudget100).toBeLessThan(0.02);
    }
  });

  it("rules modify budgets through data", () => {
    const base = buildEncounter(content, "greenfields", 5, combineRuleEffects(content, []));
    const hardy = buildEncounter(content, "greenfields", 5, combineRuleEffects(content, ["test_enemy_hp_150"]));
    const sum = (s: typeof base) => s.enemies.reduce((a, e) => a + e.maxHp100, 0);
    expect(sum(hardy)).toBeGreaterThan(sum(base) * 1.49);
  });
});
