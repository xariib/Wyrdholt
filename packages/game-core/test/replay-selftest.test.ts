import { describe, expect, it } from "vitest";
import {
  GOLDEN,
  RULES_VERSION,
  ReplayMismatchError,
  SELF_TEST_CASES,
  fightHash,
  goldenMatches,
  prepareFight,
  replayFight,
  runSelfTest,
  type GoldenFile,
} from "@emberbound/game-core";
import { content, newProfile, run } from "./helpers";

describe("authoritative replay", () => {
  it("a live fight and its replay produce the same hash", () => {
    const p = newProfile(60, "mage", "monk");
    run(p, { type: "startPush", zoneId: "greenfields" });
    run(p, { type: "advance", ms: 5_000 });
    const live = prepareFight(p, content, p.adventure.run!, { contentTimeMs: 0, recordEvents: true });
    const replayed = replayFight(content, JSON.parse(JSON.stringify(live.record)));
    expect(replayed.hash).toBe(fightHash(live.record, live.events!, live.summary));
  });

  it("refuses records from another rules or content version", () => {
    const p = newProfile(61);
    run(p, { type: "startPush", zoneId: "greenfields" });
    run(p, { type: "advance", ms: 2_000 });
    const record = prepareFight(p, content, p.adventure.run!, { contentTimeMs: 0, recordEvents: false }).record;
    expect(() => replayFight(content, { ...record, rulesVersion: "old" })).toThrow(ReplayMismatchError);
    expect(() => replayFight(content, { ...record, contentHash: "0".repeat(64) })).toThrow(ReplayMismatchError);
  });

  it("a changed input changes the hash (complete result, not only win/loss)", () => {
    const p = newProfile(62);
    run(p, { type: "startPush", zoneId: "greenfields" });
    run(p, { type: "advance", ms: 2_000 });
    const record = prepareFight(p, content, p.adventure.run!, { contentTimeMs: 0, recordEvents: false }).record;
    const a = replayFight(content, record);
    const b = replayFight(content, { ...record, seed: record.seed + 1 });
    expect(a.summary.outcome).toBe(b.summary.outcome);
    expect(a.hash).not.toBe(b.hash);
  });
});

describe("determinism self-test (golden hashes)", () => {
  it("golden file matches the loaded rules and content", () => {
    expect(goldenMatches(GOLDEN as GoldenFile, content, RULES_VERSION)).toBeNull();
  });

  it("every self-test case matches its golden hash in Node", () => {
    const results = runSelfTest(content, GOLDEN as GoldenFile, () => performance.now());
    expect(results).toHaveLength(SELF_TEST_CASES.length);
    for (const r of results) {
      expect(r.error, r.id).toBeUndefined();
      expect(r.actual, r.id).toBe(r.expected);
    }
  });
});
