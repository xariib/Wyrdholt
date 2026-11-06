import { describe, expect, it } from "vitest";
import type { ContentSnapshot } from "@emberbound/shared-types";
import { ContentIndex, RULES_VERSION, runSelfTest, type GoldenFile } from "@emberbound/game-core";
import c1Snapshot from "./fixtures/c1-content.json";
import c1Golden from "./fixtures/c1-golden.json";
import c1Equivalence from "./fixtures/c1-equivalence.json";
import { C1_EQUIVALENCE_CASES } from "./c1-equivalence-cases";

/**
 * C2 branch guard: the frozen C1 content (the C1 retune build's data, EMB-0.1.0-c1-20260921.1244)
 * must produce byte-identical results on this engine. Expected hashes were captured on the
 * C1 retune engine (tag c1-retune-candidate-20260921.1244).
 */
describe("C1 equivalence (C1 content on the current engine)", () => {
  const content = new ContentIndex(c1Snapshot as unknown as ContentSnapshot);

  it("loads the frozen C1 content unchanged", () => {
    expect(content.snapshot.contentVersion).toBe("emberbound-content/0.2.1-c1");
    expect(content.hash).toBe(c1Equivalence.contentHash);
    expect(content.hash).toBe((c1Golden as GoldenFile).contentHash);
    expect(RULES_VERSION).toBe(c1Equivalence.rulesVersion);
  });

  it("reproduces all 12 C1 golden self-test hashes", () => {
    const golden = c1Golden as GoldenFile;
    const results = runSelfTest(content, golden, () => 0, Object.keys(golden.cases));
    expect(results).toHaveLength(12);
    for (const r of results) {
      expect(r.error, r.id).toBeUndefined();
      expect(r.actual, r.id).toBe(r.expected);
    }
  });

  it.each(C1_EQUIVALENCE_CASES.map((c) => [c.id, c] as const))("reproduces %s", (id, c) => {
    expect(c.run(content)).toBe((c1Equivalence.cases as Record<string, string>)[id]);
  });
});
