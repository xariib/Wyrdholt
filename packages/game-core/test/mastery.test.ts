import { describe, expect, it } from "vitest";
import {
  ArraySink,
  buildEncounter,
  combineRuleEffects,
  currentBuild,
  equippedInstances,
  masteryRank,
  nextMilestone,
  resolveClassMechanics,
  resolveHeroStats,
  simulateFight,
} from "@emberbound/game-core";
import { content, newProfile, setLevel, setMastery } from "./helpers";

describe("Class Mastery gates", () => {
  it("unlocks Monk techniques exactly at M1/M5/M10/M15/M20", () => {
    const ids = (rank: number) => resolveClassMechanics(content, "monk", rank).map((m) => m.id);
    expect(ids(1)).toEqual(["restoring_rhythm"]);
    expect(ids(4)).toEqual(["restoring_rhythm"]);
    expect(ids(5)).toEqual(["restoring_rhythm", "combo_strike"]);
    expect(ids(9)).toEqual(["restoring_rhythm", "combo_strike"]);
    expect(ids(10)).toEqual(["restoring_rhythm", "combo_strike", "flow_state"]);
    expect(ids(20)).toEqual(["restoring_rhythm", "combo_strike", "flow_state", "flowing_combo"]);
  });

  it("patches parameters instead of flattening to stat bonuses", () => {
    const at = (rank: number) => resolveClassMechanics(content, "monk", rank);
    const combo = (rank: number) => at(rank).find((m) => m.id === "combo_strike") as { potencyBp: number };
    const flow = (rank: number) => at(rank).find((m) => m.id === "flow_state") as { hasteBp: number; durationMs: number };
    expect(combo(14).potencyBp).toBe(6_000);
    expect(combo(15).potencyBp).toBe(9_500);
    expect(flow(14).hasteBp).toBe(3_000);
    expect(flow(15).hasteBp).toBe(3_500);
    expect(flow(19).durationMs).toBe(4_000);
    expect(flow(20).durationMs).toBe(5_000);
    const mage = (rank: number) => resolveClassMechanics(content, "mage", rank);
    expect((mage(19).find((m) => m.id === "wildfire") as { every: number }).every).toBe(4);
    expect((mage(20).find((m) => m.id === "wildfire") as { every: number }).every).toBe(3);
    expect((mage(20).find((m) => m.id === "spell_echo") as { chanceBp: number }).chanceBp).toBe(3_000);
  });

  it("never mutates the catalog", () => {
    resolveClassMechanics(content, "monk", 20);
    const again = resolveClassMechanics(content, "monk", 5);
    expect((again.find((m) => m.id === "combo_strike") as { potencyBp: number }).potencyBp).toBe(6_000);
  });

  it("maps XP to ranks with exact boundaries", () => {
    const totals = content.masteryTotals("mastery_monk");
    expect(masteryRank(content, "monk", 0)).toBe(1);
    expect(masteryRank(content, "monk", totals[4]! - 1)).toBe(4);
    expect(masteryRank(content, "monk", totals[4]!)).toBe(5);
    expect(masteryRank(content, "monk", 10_000_000)).toBe(20);
    expect(nextMilestone(content, "monk", 5)?.unlockRank).toBe(10);
    expect(nextMilestone(content, "monk", 20)).toBeNull();
  });

  it("a fresh Alternate Class is immediately viable (M1 clears the opening fight)", () => {
    for (const cls of ["monk", "mage"]) {
      const p = newProfile(3, cls, cls === "monk" ? "mage" : "monk");
      const build = currentBuild(p);
      const hero = resolveHeroStats(content, build, equippedInstances(p, build));
      const effects = combineRuleEffects(content, []);
      const setup = buildEncounter(content, "greenfields", 0, effects);
      const summary = simulateFight(
        { seed: 9, hero, startHp100: null, enemies: setup.enemies, effects, config: content.snapshot.config },
        new ArraySink(),
      );
      expect(summary.outcome).toBe("victory");
    }
  });

  it("specialization adds more damage than the flat foundation alone", () => {
    const dps = (rank: number, flatten: boolean) => {
      const p = newProfile(4, "mage", "monk");
      setLevel(p, 8);
      setMastery(p, "mage", rank);
      const build = currentBuild(p);
      const hero = resolveHeroStats(content, build, equippedInstances(p, build));
      if (flatten) {
        hero.mechanics = resolveClassMechanics(content, "mage", 1);
        hero.mechanicSources = hero.mechanics.map(() => "class");
      }
      const effects = combineRuleEffects(content, ["test_enemy_tough", "test_enemy_soft"]);
      const setup = buildEncounter(content, "greenfields", 6, effects);
      const s = simulateFight(
        { seed: 5, hero, startHp100: null, enemies: setup.enemies, effects, config: content.snapshot.config },
        new ArraySink(),
      );
      return s.counters.damageDealt100 / s.durationMs;
    };
    const m1 = dps(1, false);
    const m20foundation = dps(20, true);
    const m20 = dps(20, false);
    expect(m20foundation).toBeGreaterThan(m1);
    expect(m20 - m20foundation).toBeGreaterThan(m20foundation - m1);
  });
});
