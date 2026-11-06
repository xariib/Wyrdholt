/**
 * Integer / fixed-point helpers for authoritative simulation.
 *
 * Rules (see docs/technical/DETERMINISM.md):
 * - Only safe integers enter and leave these helpers.
 * - Products must stay within +/- 2^52 so the exact remainder check below is valid.
 * - ONE rounding rule everywhere: round half up (values are non-negative).
 * - No Math.pow / exp / log / sin / cos in simulation code.
 */

/** 10000 basis points = 100%. */
export const BP = 10_000;
/** HP and damage are stored x100. */
export const HP_SCALE = 100;
/** 2^52, written as a literal to avoid the implementation-approximated `**` operator. */
export const MAX_EXACT = 4_503_599_627_370_496;

export function assertInt(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Non-integer authoritative value for ${label}: ${String(value)}`);
  }
  return value;
}

/**
 * floor-free exact integer division with round-half-up: round(a * b / c).
 * Requires a >= 0, b >= 0, c > 0.
 */
export function mulDivRound(a: number, b: number, c: number): number {
  if (a < 0 || b < 0 || c <= 0) {
    throw new Error(`mulDivRound expects a>=0, b>=0, c>0 (got ${a}, ${b}, ${c})`);
  }
  const p = a * b;
  if (p > MAX_EXACT) {
    throw new Error(`mulDivRound overflow: ${a} * ${b}`);
  }
  let q = Math.floor(p / c);
  let r = p - q * c;
  // Correct a possible off-by-one from the floating-point quotient.
  while (r < 0) {
    q -= 1;
    r += c;
  }
  while (r >= c) {
    q += 1;
    r -= c;
  }
  if (r * 2 >= c) q += 1;
  return q;
}

/** Exact floor(a * b / c) for non-negative safe integers. */
export function mulDivFloor(a: number, b: number, c: number): number {
  if (a < 0 || b < 0 || c <= 0) {
    throw new Error(`mulDivFloor expects a>=0, b>=0, c>0 (got ${a}, ${b}, ${c})`);
  }
  const p = a * b;
  if (p > MAX_EXACT) {
    throw new Error(`mulDivFloor overflow: ${a} * ${b}`);
  }
  let q = Math.floor(p / c);
  let r = p - q * c;
  while (r < 0) {
    q -= 1;
    r += c;
  }
  while (r >= c) {
    q += 1;
    r -= c;
  }
  return q;
}

export function applyBp(value: number, bp: number): number {
  return mulDivRound(value, bp, BP);
}

export function clampInt(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Cumulative totals for a geometric curve (first step, +growthBp per step),
 * computed in milli-units with round-half-up and returned in whole units.
 * totals[0] = 0 (rank/level 1), totals[n] = cost to reach rank/level n+1.
 */
/** Cumulative totals from explicit steps: totals[0] = 0, totals[i] = sum(steps[0..i-1]). */
export function stepTotals(steps: readonly number[]): number[] {
  const totals = [0];
  let sum = 0;
  for (const step of steps) {
    if (!Number.isSafeInteger(step) || step <= 0) throw new Error(`Invalid progression step ${step}`);
    sum += step;
    if (!Number.isSafeInteger(sum)) throw new Error("Progression total exceeds safe integers");
    totals.push(sum);
  }
  return totals;
}

export function geometricCurveTotals(firstStep: number, growthBp: number, steps: number): number[] {
  const totals: number[] = [0];
  let stepMilli = firstStep * 1000;
  let cumulativeMilli = 0;
  for (let i = 0; i < steps; i += 1) {
    cumulativeMilli += stepMilli;
    totals.push(mulDivRound(cumulativeMilli, 1, 1000));
    stepMilli = mulDivRound(stepMilli, growthBp, BP);
  }
  return totals;
}
