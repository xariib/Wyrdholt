/**
 * App-side settlement helpers (C1 playtest investigation, 21 Sep 2026):
 * - a character never stands still after a defeat (safe Farm, like offline catch-up)
 * - the offline telemetry reports Character XP and Mastery XP exactly
 */
import { describe, expect, it } from "vitest";
import type { SlotId } from "@emberbound/shared-types";
import { CONTENT } from "@emberbound/game-content";
import { ContentIndex, advanceAdventure, applyCommand, cloneProfile, createProfile, simulateOffline, type Profile } from "@emberbound/game-core";
import { resumeAfterDefeat, settlementTelemetry } from "../src/game/settlement";

const content = new ContentIndex(CONTENT);
const HOUR = 3_600_000;
const RARE_SET = ["bloodletter", "seers_circlet", "ironbark_mantle", "flowing_wraps", "huntsmans_stride", "ember_seal"];

function hero(level: number, cleared: string[], gear: string[] = RARE_SET): Profile {
  const p = createProfile(content, { name: "Tester", activeClassId: "monk", alternateClassId: "mage", masterSeed: 7, nowWallMs: 0 });
  p.character.xp = content.levelTotals[level - 1]!;
  p.character.level = level;
  p.character.masteryXp.monk = content.masteryTotals("mastery_monk")[6]!;
  applyCommand(p, content, { type: "devGrant", baseIds: gear }, { contentTimeMs: 0 });
  for (const inst of p.inventory.instances) {
    if (gear.includes(inst.baseId)) applyCommand(p, content, { type: "equip", slot: content.item(inst.baseId).slot as SlotId, instanceId: inst.id }, { contentTimeMs: 0 });
  }
  for (const id of cleared) {
    p.adventure.zones[id] = { unlocked: true, cleared: true, bestStage: 10, completions: 1, checkpoint: null };
    for (const next of content.zone(id).unlocks) p.adventure.zones[next] = { unlocked: true, cleared: false, bestStage: 0, completions: 0, checkpoint: null };
  }
  return p;
}

function failForeground(p: Profile, zoneId: string, mode: "push" | "farm", stage: number): void {
  applyCommand(p, content, { type: mode === "push" ? "startPush" : "startFarm", zoneId }, { contentTimeMs: 0 });
  p.adventure.run!.stageIndex = stage;
  p.adventure.run!.hp100 = 100;
  while (p.adventure.activity !== "idle") advanceAdventure(p, content, 1_000, { offline: false, contentTimeMs: 0 });
}

describe("resumeAfterDefeat", () => {
  it("after a failed Darkwood Push, farms Greenfields (the strongest cleared zone)", () => {
    const p = hero(11, ["greenfields"]);
    failForeground(p, "darkwood", "push", 9);
    expect(p.adventure.lastResult?.kind).toBe("defeat");
    expect(resumeAfterDefeat(p, content, 0)).toEqual({ zoneId: "greenfields", mode: "farm" });
    expect(p.adventure).toMatchObject({ activity: "farm", zoneId: "greenfields" });
    expect(p.adventure.run?.mode).toBe("farm");
  });

  it("after a failed Farm, steps down to a weaker cleared zone", () => {
    const p = hero(12, ["greenfields", "darkwood"]);
    failForeground(p, "darkwood", "farm", 9);
    expect(resumeAfterDefeat(p, content, 0)).toEqual({ zoneId: "greenfields", mode: "farm" });
  });

  it("with nothing cleared, farms the first zone's trail", () => {
    const p = hero(1, [], []);
    failForeground(p, "greenfields", "push", 9);
    expect(resumeAfterDefeat(p, content, 0)).toEqual({ zoneId: "greenfields", mode: "trail" });
    expect(p.adventure.run?.mode).toBe("trail");
  });

  it("does nothing while the character is busy, or after a clear", () => {
    const p = hero(11, ["greenfields"]);
    applyCommand(p, content, { type: "startFarm", zoneId: "greenfields" }, { contentTimeMs: 0 });
    const before = JSON.stringify(p);
    expect(resumeAfterDefeat(p, content, 0)).toBeNull();
    expect(JSON.stringify(p)).toBe(before);
  });

  it("closing the app on the result screen no longer loses the night", () => {
    const idle = hero(11, ["greenfields"]);
    failForeground(idle, "darkwood", "push", 9);
    const resumed = cloneProfile(idle);
    resumeAfterDefeat(resumed, content, 0);
    const a = simulateOffline(idle, content, 8 * HOUR, 0);
    const b = simulateOffline(resumed, content, 8 * HOUR, 0);
    expect(a.fights).toBe(0);
    expect(b.fights).toBeGreaterThan(1_000);
    expect(b.mastery).toBeGreaterThan(0);
  });
});

describe("settlementTelemetry", () => {
  it("reports Character XP, Mastery XP per class, rank, targets and the class used", () => {
    const before = hero(11, ["greenfields"]);
    applyCommand(before, content, { type: "startFarm", zoneId: "greenfields" }, { contentTimeMs: 0 });
    const after = cloneProfile(before);
    const summary = simulateOffline(after, content, 3 * HOUR, 0);
    const t = settlementTelemetry(content, before, after, summary, null);
    expect(t.characterXp).toBe(after.character.xp - before.character.xp);
    expect(t.characterXp).toBe(summary.xp);
    expect(t.masteryByClass).toEqual({ monk: after.character.masteryXp.monk! - before.character.masteryXp.monk! });
    expect(t.masteryByClass.monk).toBe(summary.mastery);
    expect(t.masteryRankAfter).toBeGreaterThanOrEqual(t.masteryRankBefore);
    expect(t.classAtStart).toBe("monk");
    expect(t.targets).toEqual([{ mode: "farm", zoneId: "greenfields", ms: 3 * HOUR }]);
    expect(t.fights).toBe(summary.fights);
  });
});
