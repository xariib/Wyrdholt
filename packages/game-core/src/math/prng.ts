/**
 * Project-owned deterministic PRNG: xoshiro128** (32-bit), seeded with splitmix32.
 *
 * Uses only 32-bit integer operations (Math.imul, shifts, xor) which are exactly
 * specified by ECMAScript, so every engine (V8, JavaScriptCore) produces the same
 * sequence. Never use Math.random() in game-core.
 */

function rotl(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k));
}

/** One splitmix32 step. Returns [nextState, output]. */
export function splitmix32(state: number): [number, number] {
  const next = (state + 0x9e3779b9) | 0;
  let z = next;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  z ^= z >>> 16;
  return [next, z >>> 0];
}

/** FNV-1a 32-bit over UTF-16 code units (labels are ASCII). */
export function fnv1a32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Derive an independent 32-bit seed for a named stream. */
export function deriveSeed(seed: number, label: string): number {
  const [, a] = splitmix32((seed ^ fnv1a32(label)) | 0);
  const [, b] = splitmix32((a ^ 0x5bd1e995) | 0);
  return b >>> 0;
}

export class Prng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;
  /** Number of 32-bit draws so far (useful for replay diagnostics). */
  draws = 0;

  constructor(seed: number) {
    let state = seed | 0;
    let out: number;
    [state, out] = splitmix32(state);
    this.s0 = out | 0;
    [state, out] = splitmix32(state);
    this.s1 = out | 0;
    [state, out] = splitmix32(state);
    this.s2 = out | 0;
    [, out] = splitmix32(state);
    this.s3 = out | 0;
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1;
  }

  nextU32(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5), 7), 9) >>> 0;
    const t = this.s1 << 9;
    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = rotl(this.s3, 11);
    this.draws += 1;
    return result;
  }

  /** Unbiased integer in [0, n). n must be a positive integer <= 2^32. */
  nextInt(n: number): number {
    if (!Number.isSafeInteger(n) || n <= 0 || n > 4_294_967_296) {
      throw new Error(`Prng.nextInt: invalid bound ${n}`);
    }
    const limit = 4_294_967_296 - (4_294_967_296 % n);
    for (;;) {
      const x = this.nextU32();
      if (x < limit) return x % n;
    }
  }

  /**
   * Chance roll in basis points.
   * Rolls only when 0 < chance < 10000, so guaranteed/impossible effects
   * never consume randomness.
   */
  rollBp(chanceBp: number): boolean {
    if (chanceBp <= 0) return false;
    if (chanceBp >= 10_000) return true;
    return this.nextInt(10_000) < chanceBp;
  }

  /** Weighted pick. Weights are non-negative integers. Returns -1 if all zero. */
  pickWeighted(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += w;
    if (total <= 0) return -1;
    let roll = this.nextInt(total);
    for (let i = 0; i < weights.length; i += 1) {
      const w = weights[i] ?? 0;
      if (roll < w) return i;
      roll -= w;
    }
    return weights.length - 1;
  }
}
