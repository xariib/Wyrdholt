#!/usr/bin/env bun
/**
 * Stage budget calibration (C1). Writes packages/game-content/src/budgets.generated.ts.
 *
 * For each zone, an "expected build at the first clear" (tools/sim/expected-builds.ts):
 *  1. HP budgets: fights against that build last the role's target seconds
 *     (median over the classes, measured with enemy damage switched off).
 *  2. Damage budgets: the role's HP-loss shape, scaled per zone to the geometric mean of
 *     each class's 50%-clear damage scale (so the zone sits at the average class's wall).
 *
 * Re-run after changing classes, items, enemies or stage compositions:
 *   bun tools/sim/tune-budgets.ts [--runs=60]
 * Then run the class report and the pacing simulation.
 */
import { writeFileSync } from "node:fs";
import type { ContentSnapshot, StageRole, ZoneDef } from "@emberbound/shared-types";
import { CONTENT } from "@emberbound/game-content";
import { ContentIndex, heroStatsFor } from "@emberbound/game-core";
import { STAGE_SHAPES, ZONE_BUILDS, type ExpectedBuild } from "./expected-builds";
import { CALIBRATION_CLASSES } from "./class-targets";
import { PLAYABLE_ZONES, clearRate, profileFor, snapshotWith, stageSeconds, type Budgets } from "./probe";

/** Every playable base class (reports). Calibration uses CALIBRATION_CLASSES only. */
export const IMPLEMENTED_CLASSES = CONTENT.classes.filter((c) => c.implemented && c.tier === 1).map((c) => c.id);
const CALIBRATION = [...CALIBRATION_CLASSES];
const CLEAR_TARGET = 0.5;

export function calibrate(
  zone: ZoneDef,
  build: ExpectedBuild,
  classes: string[],
  runs: number,
  known: Budgets = {},
  base: ContentSnapshot = CONTENT,
): { scale: number; classScales: Record<string, number>; budget: { hp: number[]; dps: number[] } } {
  const roles = zone.stages.map((s) => s.role as StageRole);
  const hp = zone.stages.map(() => 1000);
  const noDamage = zone.stages.map(() => 0);
  for (let iter = 0; iter < 4; iter += 1) {
    const content = new ContentIndex(snapshotWith({ ...known, [zone.id]: { hp, dps: noDamage } }, base));
    zone.stages.forEach((_s, i) => {
      const target = STAGE_SHAPES[roles[i]!].seconds * (1 + build.rampPerStage * i);
      const got = stageSeconds(content, zone.id, i, build, classes);
      hp[i] = Math.max(10, Math.round((hp[i]! * target) / Math.max(0.5, got)));
    });
  }
  // Damage shape from the expected build's max HP and armor (mean over classes).
  const probeContent = new ContentIndex(snapshotWith({ ...known, [zone.id]: { hp, dps: noDamage } }, base));
  const stats = classes.map((c) => heroStatsFor(profileFor(probeContent, c, build, 1), probeContent));
  const refHp = stats.reduce((s, h) => s + h.maxHp100 / 100, 0) / stats.length;
  const refArmor = stats.reduce((s, h) => s + h.armor, 0) / stats.length;
  const baseDps = zone.stages.map((_s, i) => {
    const shape = STAGE_SHAPES[roles[i]!];
    const ramp = 1 + build.rampPerStage * i;
    return ((refHp * shape.hpShare) / shape.seconds) * ((100 + refArmor) / 100) * 100 * ramp;
  });
  // Zone damage scale: geometric mean of each class's own 50%-clear scale. Averaging the
  // class clear rates instead is bimodal: runs are low-variance, so a class ~10% tankier
  // than another clears ~100% where the other clears ~0% (C1 class report).
  const classScales: Record<string, number> = {};
  for (const cls of classes) {
    classScales[cls] = classFiftyScale(zone, build, cls, { hp, dps: baseDps }, Math.max(20, Math.round(runs / 2)), known, base);
  }
  const scale = Math.exp(classes.reduce((s, c) => s + Math.log(classScales[c]!), 0) / classes.length);
  return { scale, classScales, budget: { hp, dps: baseDps.map((d) => Math.round(d * scale)) } };
}

/**
 * The enemy damage multiplier (applied to `budget.dps`, HP fixed) at which one class alone
 * clears 50% of full Push runs at the build. Higher = the class survives more.
 */
export function classFiftyScale(
  zone: ZoneDef,
  build: ExpectedBuild,
  classId: string,
  budget: { hp: number[]; dps: number[] },
  runs: number,
  known: Budgets = {},
  base: ContentSnapshot = CONTENT,
): number {
  let lo = 0.05;
  let hi = 20;
  for (let iter = 0; iter < 12; iter += 1) {
    const mid = Math.sqrt(lo * hi);
    const dps = budget.dps.map((d) => Math.round(d * mid));
    const content = new ContentIndex(snapshotWith({ ...known, [zone.id]: { hp: budget.hp, dps } }, base));
    if (clearRate(content, zone.id, build, runs, [classId]).rate > CLEAR_TARGET) lo = mid;
    else hi = mid;
  }
  return Math.sqrt(lo * hi);
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

if (import.meta.main) {
  const runs = Number(process.argv.find((a) => a.startsWith("--runs="))?.slice(7) ?? 60);
  const budgets: Budgets = {};
  const report: string[] = [];
  for (const zone of PLAYABLE_ZONES) {
    const build = ZONE_BUILDS[zone.id];
    if (!build) throw new Error(`No expected build for ${zone.id}`);
    const { scale, classScales, budget } = calibrate(zone, build, CALIBRATION, runs, budgets);
    budgets[zone.id] = budget;
    const content = new ContentIndex(snapshotWith(budgets));
    const at = clearRate(content, zone.id, build, runs, CALIBRATION);
    const shifted = (dl: number) => clearRate(content, zone.id, { ...build, level: build.level + dl }, runs, CALIBRATION);
    const byClass = (r: ReturnType<typeof clearRate>) => CALIBRATION.map((c) => pct(r.perClass[c]!)).join("/");
    const hist: Record<number, number> = {};
    for (const st of at.failStages) hist[st] = (hist[st] ?? 0) + 1;
    report.push(
      `${zone.id}: build L${build.level} M${build.mastery} · damage scale ${scale.toFixed(3)} (${CALIBRATION.map((c) => `${c} ${classScales[c]!.toFixed(3)}`).join(", ")}) · clear ${CALIBRATION.join("/")} at L-2 ${byClass(shifted(-2))} · L-1 ${byClass(shifted(-1))} · L ${byClass(at)} · L+1 ${byClass(shifted(1))} · L+2 ${byClass(shifted(2))} · fail stages ${Object.entries(hist).map(([k, v]) => `s${k}:${v}`).join(" ")}`,
    );
    console.log(report[report.length - 1]);
  }
  const lines = [
    "/**",
    " * GENERATED by tools/sim/tune-budgets.ts — do not edit by hand.",
    " * Stage HP (whole HP) and damage-per-second (x100) budgets per zone, calibrated",
    " * against the expected build at each zone's first clear (tools/sim/expected-builds.ts).",
    " *",
    ...report.map((r) => ` * ${r}`),
    " */",
    "export const STAGE_BUDGETS: Record<string, { hp: number[]; dps: number[] }> = {",
    ...Object.entries(budgets).map(([id, b]) => `  ${id}: { hp: [${b.hp.join(", ")}], dps: [${b.dps.join(", ")}] },`),
    "};",
    "",
  ];
  const target = new URL("../../packages/game-content/src/budgets.generated.ts", import.meta.url).pathname;
  writeFileSync(target, lines.join("\n"));
  console.log(`wrote ${target}`);
}
