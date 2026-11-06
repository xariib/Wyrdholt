#!/usr/bin/env bun
/**
 * Fit the Character Level and Class Mastery XP tables to the C1 target timeline
 * (tools/sim/pacing-targets.ts) from a pacing run's earned-XP curves.
 *
 *   bun tools/sim/pacing.ts --days=21 --seeds=6 --jobs=2 --schedules=twice --out=fit-input
 *   bun tools/sim/fit-tables.ts --from=fit-input [--write]
 *
 * For each level L: total XP to reach L = the median earned XP at the target hour of L
 * (mean of the per-class medians, so each class weighs the same). Past the simulated days
 * the curve is extended at the rate of the last 5 simulated days.
 *
 * The earned-XP curve depends on the tables (they move the zone walls), so repeat
 * pacing -> fit until the tables settle, then run the full pacing report.
 * --write rewrites packages/game-content/src/progression.ts.
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { PlayerReport, TimelineSample } from "./model-player";
import { CALIBRATION_SCHEDULE, LEVEL_HOURS, MASTERY_HOURS } from "./pacing-targets";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const from = arg("from") ?? "fit-input";
const write = process.argv.includes("--write");
const raw = JSON.parse(readFileSync(new URL(`./out/${from}.json`, import.meta.url).pathname, "utf8")) as {
  days: number;
  classes: string[];
  reports: PlayerReport[];
};
// Fit on the calibration check-in pattern only.
const input = { ...raw, reports: raw.reports.filter((r) => (r.schedule ?? "model") === CALIBRATION_SCHEDULE) };
if (input.reports.length === 0) throw new Error(`no ${CALIBRATION_SCHEDULE} players in ${from}`);

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Mean over classes of the per-class median curve. All players share the same sample hours. */
function curve(pick: (t: TimelineSample) => number): { hours: number[]; values: number[] } {
  const hours = input.reports[0]!.timeline.map((t) => t.simHours);
  const values = hours.map((_h, k) => {
    const perClass = input.classes.map((c) => median(input.reports.filter((r) => r.classId === c).map((r) => pick(r.timeline[k]!))));
    return perClass.reduce((a, b) => a + b, 0) / perClass.length;
  });
  return { hours, values };
}

function valueAt(c: { hours: number[]; values: number[] }, h: number): number {
  const { hours, values } = c;
  const last = hours.length - 1;
  if (h >= hours[last]!) {
    // Late rate over the last ~5 days of the calibration schedule (two check-ins: ~24 simulated h/day).
    let k = last;
    while (k > 0 && hours[last]! - hours[k]! < 120) k -= 1;
    const rate = (values[last]! - values[k]!) / (hours[last]! - hours[k]!);
    return values[last]! + rate * (h - hours[last]!);
  }
  let k = 0;
  while (hours[k + 1]! < h) k += 1;
  const [h0, h1] = [hours[k]!, hours[k + 1]!];
  const f = h1 > h0 ? (h - h0) / (h1 - h0) : 0;
  return values[k]! + f * (values[k + 1]! - values[k]!);
}

/** Two significant digits (tens below 1,000) so the tables stay readable. */
function nice(x: number): number {
  if (x < 1_000) return Math.max(10, Math.round(x / 10) * 10);
  const mag = 10 ** (Math.floor(Math.log10(x)) - 1);
  return Math.round(x / mag) * mag;
}

/**
 * Pool adjacent violators: the closest non-decreasing sequence. A pooled block keeps its sum,
 * so the hour at the end of the block is unchanged (a level never costs less than the one before).
 */
function nonDecreasing(xs: number[]): number[] {
  const blocks: { sum: number; n: number }[] = [];
  for (const x of xs) {
    blocks.push({ sum: x, n: 1 });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1]!;
      const a = blocks[blocks.length - 2]!;
      if (a.sum / a.n <= b.sum / b.n) break;
      blocks.splice(-2, 2, { sum: a.sum + b.sum, n: a.n + b.n });
    }
  }
  return blocks.flatMap((b) => Array.from({ length: b.n }, () => b.sum / b.n));
}

function fit(targets: Record<number, number>, maxRank: number, c: { hours: number[]; values: number[] }): number[] {
  const totals = [0];
  for (let r = 2; r <= maxRank; r += 1) totals.push(valueAt(c, targets[r]!));
  const raw: number[] = [];
  for (let i = 1; i < totals.length; i += 1) raw.push(Math.max(1, totals[i]! - totals[i - 1]!));
  // Rounding can reorder equal pooled steps only upwards, never below the previous one.
  const steps = nonDecreasing(raw).map(nice);
  for (let i = 1; i < steps.length; i += 1) steps[i] = Math.max(steps[i]!, steps[i - 1]!);
  return steps;
}

const xpCurve = curve((t) => t.xp);
const masteryCurve = curve((t) => t.masteryXp);
const levelSteps = fit(LEVEL_HOURS, 30, xpCurve);
const masterySteps = fit(MASTERY_HOURS, 20, masteryCurve);
const lastH = xpCurve.hours[xpCurve.hours.length - 1]!;
const fmt = (xs: number[]) => xs.map((x) => x.toLocaleString("en-US").replace(/,/g, "_")).join(", ");

console.log(`from ${from}: ${input.reports.length} players, ${input.days} days (${lastH.toFixed(0)} simulated hours)`);
console.log(`earned XP at 36 h ${Math.round(valueAt(xpCurve, 36))}, 128 h ${Math.round(valueAt(xpCurve, 128))}, late rate ${Math.round((valueAt(xpCurve, lastH + 100) - valueAt(xpCurve, lastH)) / 100)}/h`);
console.log(`LEVEL_XP_STEPS   = [${fmt(levelSteps)}]`);
console.log(`MASTERY_XP_STEPS = [${fmt(masterySteps)}]`);

if (write) {
  const row = (xs: number[]) => `  ${fmt(xs)},`;
  const text = `/**
 * GENERATED by tools/sim/fit-tables.ts from the pacing run "${from}" — prefer re-fitting to hand edits.
 *
 * Character Level and Class Mastery XP tables (C1). Each entry is the XP needed to go from one
 * level (or rank) to the next. They are fitted so the model player (tools/sim/model-player.ts)
 * reaches each level and rank at the hours in tools/sim/pacing-targets.ts (two check-ins a day):
 * - L5–L6 and M2 in the first session (Greenfields wall)
 * - L10 and M7 around day 1 evening (Darkwood wall, cleared day 1–2)
 * - L19 and M14 around day 6–7 (Ashen wall, cleared day 6–8)
 * - M20 after day 21; level 30 after about 12 weeks
 * Entries past day 21 are extrapolated at the Ashen farming rate; refit when content changes.
 * Results: docs/reports/C1_PACING.md.
 */

/** XP from level L to L + 1, for L = 1..29 (29 entries, max level 30). */
export const LEVEL_XP_STEPS: number[] = [
  // 1->2 .. 5->6: first session
${row(levelSteps.slice(0, 5))}
  // 6->7 .. 9->10: Greenfields, up to the Darkwood wall
${row(levelSteps.slice(5, 9))}
  // 10->11 .. 18->19: Darkwood, up to the Ashen wall
${row(levelSteps.slice(9, 18))}
  // 19->20 .. 29->30: long tail
${row(levelSteps.slice(18))}
];

/** Mastery XP from rank R to R + 1, for R = 1..19 (19 entries, max rank 20). */
export const MASTERY_XP_STEPS: number[] = [
  // M1->M5: day 1
${row(masterySteps.slice(0, 4))}
  // M5->M7: until about the Darkwood clear
${row(masterySteps.slice(4, 6))}
  // M7->M15: until about the Ashen clear
${row(masterySteps.slice(6, 14))}
  // M15->M20: after day 21
${row(masterySteps.slice(14))}
];
`;
  const target = new URL("../../packages/game-content/src/progression.ts", import.meta.url).pathname;
  writeFileSync(target, text);
  console.log(`wrote ${target}`);
}
