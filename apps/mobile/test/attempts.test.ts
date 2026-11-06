/** Push attempt history (C1 retune): stored beside the save, shown on the result screens. */
import { beforeEach, describe, expect, it } from "vitest";
import { CONTENT } from "@emberbound/game-content";
import { ContentIndex, createProfile } from "@emberbound/game-core";
import { attemptHistory, attemptLabel, buildChanges, buildState, recordAttempt } from "../src/game/attempts";

const content = new ContentIndex(CONTENT);

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
}

beforeEach(() => {
  (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
});

describe("attempt history", () => {
  const p = createProfile(content, { name: "Tester", activeClassId: "monk", alternateClassId: "mage", masterSeed: 5, nowWallMs: 1_000 });
  const boss = { zoneId: "darkwood", cleared: false, stage: 10, stagesTotal: 10, enemyHp100: 4_100, enemyMaxHp100: 10_000 };

  it("records attempts per character and zone, newest last, at most 8", () => {
    for (let i = 0; i < 10; i += 1) recordAttempt(p, content, { ...boss, enemyHp100: 5_000 - i * 100 }, "online", i);
    const h = attemptHistory(p, "darkwood");
    expect(h).toHaveLength(8);
    expect(h[h.length - 1]!.enemyLeftBp).toBe(4_100);
    const other = createProfile(content, { name: "Other", activeClassId: "mage", alternateClassId: "monk", masterSeed: 6, nowWallMs: 1_000 });
    expect(attemptHistory(other, "darkwood")).toHaveLength(0);
  });

  it("labels Boss, Elite and plain stages, and clears", () => {
    recordAttempt(p, content, boss, "offline", 1);
    recordAttempt(p, content, { ...boss, stage: 5, enemyHp100: 2_500 }, "online", 2);
    recordAttempt(p, content, { ...boss, stage: 3, enemyHp100: 1_000 }, "online", 3);
    recordAttempt(p, content, { ...boss, cleared: true }, "online", 4);
    expect(attemptHistory(p, "darkwood").map((a) => attemptLabel(a, content))).toEqual(["Boss 41%", "Elite (stage 5) 25%", "stage 3 10%", "cleared"]);
  });

  it("describes what changed between two attempts in player terms", () => {
    const before = { ...buildState(p, content), level: 9, rank: 5 };
    recordAttempt(p, content, boss, "online", 1, before);
    const prev = attemptHistory(p, "darkwood")[0]!;
    expect(buildChanges(prev, before, content)).toEqual([]);
    const after = { ...before, level: 10, rank: 7, gear: { ...before.gear, weapon: "bloodletter" } };
    expect(buildChanges(prev, after, content)).toEqual(["level 9 → 10", "Mastery M5 → M7", "1 new item equipped"]);
  });

  it("works without storage (history is only a convenience)", () => {
    (globalThis as { localStorage?: unknown }).localStorage = undefined;
    expect(() => recordAttempt(p, content, boss, "online", 1)).not.toThrow();
    expect(attemptHistory(p, "darkwood")).toEqual([]);
  });
});
