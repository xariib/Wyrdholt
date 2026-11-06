import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  BP,
  Prng,
  canonicalJson,
  deriveSeed,
  geometricCurveTotals,
  mulDivFloor,
  mulDivRound,
  sha256Hex,
} from "@emberbound/game-core";

describe("fixed-point math", () => {
  it("mulDivRound matches a BigInt reference (round half up)", () => {
    const rng = new Prng(7);
    for (let i = 0; i < 20_000; i += 1) {
      const a = rng.nextInt(2_000_000_000);
      const b = rng.nextInt(2_000_000);
      const c = 1 + rng.nextInt(1_000_000_000);
      if (a * b > 2 ** 52) continue;
      const ref = (BigInt(a) * BigInt(b) * 2n + BigInt(c)) / (BigInt(c) * 2n);
      expect(mulDivRound(a, b, c)).toBe(Number(ref));
      expect(mulDivFloor(a, b, c)).toBe(Number((BigInt(a) * BigInt(b)) / BigInt(c)));
    }
  });

  it("is exact near the 2^52 product limit", () => {
    const a = 2 ** 26 - 1;
    const b = 2 ** 26 - 3;
    for (const c of [3, 7, 1_000_003, 2 ** 26 + 5]) {
      const ref = (BigInt(a) * BigInt(b) * 2n + BigInt(c)) / (BigInt(c) * 2n);
      expect(mulDivRound(a, b, c)).toBe(Number(ref));
    }
  });

  it("rejects overflow and negative inputs", () => {
    expect(() => mulDivRound(2 ** 30, 2 ** 30, 3)).toThrow(/overflow/);
    expect(() => mulDivRound(-1, 2, 3)).toThrow();
    expect(() => mulDivRound(1, 2, 0)).toThrow();
  });

  it("reproduces the documented mastery curve (MASTERY_AUDIT)", () => {
    const totals = geometricCurveTotals(65, 12_500, 19);
    expect(totals[0]).toBe(0);
    expect(totals[4]).toBe(375); // M5
    expect(totals[9]).toBe(1_677); // M10
    // Godot rounds its float curve differently; integer milli-XP rounding lands within 2 XP.
    expect(Math.abs((totals[14] ?? 0) - 5_651)).toBeLessThanOrEqual(2); // M15 (report: 5,651)
    expect(Math.abs((totals[19] ?? 0) - 17_780)).toBeLessThanOrEqual(2); // M20 (report: 17,780)
  });

  it("uses integer basis points", () => {
    expect(BP).toBe(10_000);
  });
});

describe("PRNG", () => {
  it("produces a stable, engine-independent sequence", () => {
    const rng = new Prng(12345);
    const seq = Array.from({ length: 6 }, () => rng.nextU32());
    // Pinned values: any change here is a rules-version change.
    expect(seq).toMatchInlineSnapshot(`
      [
        518667457,
        440444462,
        4232892992,
        3757857622,
        3939018813,
        1334683535,
      ]
    `);
  });

  it("chance rolls never consume randomness at 0% or 100%", () => {
    const rng = new Prng(1);
    expect(rng.rollBp(0)).toBe(false);
    expect(rng.rollBp(10_000)).toBe(true);
    expect(rng.draws).toBe(0);
    rng.rollBp(5_000);
    expect(rng.draws).toBe(1);
  });

  it("nextInt stays in range and is roughly uniform", () => {
    const rng = new Prng(99);
    const counts = [0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 70_000; i += 1) {
      const v = rng.nextInt(7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
      counts[v]! += 1;
    }
    for (const c of counts) expect(Math.abs(c - 10_000)).toBeLessThan(500);
  });

  it("derives independent named streams", () => {
    expect(deriveSeed(5, "a")).not.toBe(deriveSeed(5, "b"));
    expect(deriveSeed(5, "a")).toBe(deriveSeed(5, "a"));
    expect(Number.isSafeInteger(deriveSeed(5, "a"))).toBe(true);
  });
});

describe("hashing", () => {
  it("pure SHA-256 matches node:crypto, including Unicode", () => {
    const samples = ["", "abc", "Æble ø å — 🔥 Emberbound", "x".repeat(1_000), "a".repeat(55), "b".repeat(56), "c".repeat(64)];
    for (const s of samples) {
      expect(sha256Hex(s)).toBe(createHash("sha256").update(s, "utf8").digest("hex"));
    }
  });

  it("canonical JSON sorts keys and rejects non-integers", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: true, c: "x" }] })).toBe('{"a":[2,{"c":"x","d":true}],"b":1}');
    expect(() => canonicalJson({ hp: 1.5 })).toThrow(/non-integer/);
    expect(() => canonicalJson({ hp: Number.NaN })).toThrow();
    expect(canonicalJson({ skip: undefined, keep: null })).toBe('{"keep":null}');
  });
});
