#!/usr/bin/env bun
/**
 * Class tuning harness (C2 four-class calibration, 22 Sep 2026). A lighter class-report for
 * trying kit values: per variant, class and zone it measures only what the class targets use.
 *
 *   bun tools/sim/class-tune.ts --variants=path.json [--classes=warrior,ranger] [--zones=darkwood] [--runs=40] [--seeds=4]
 *
 * variants.json: { "name": [{ "path": "classes.2.base.attack", "value": 13 }, ...], ... }
 * (the same patch format as class-report --patch; "baseline" = [] is the current content).
 *
 * Columns: wall level (50%-clear damage scale converted to levels, as in class-report),
 * the 50% scale itself, normal-stage and Boss fight seconds with enemy damage off, and the
 * Push clear rate at L-1 / L / L+1. Budgets are always the shipped ones.
 */
import { readFileSync } from "node:fs";
import type { ContentSnapshot } from "@emberbound/shared-types";
import { CONTENT } from "@emberbound/game-content";
import { ContentIndex } from "@emberbound/game-core";
import { applyPatch } from "./class-report";
import { roleMetrics } from "./class-metrics";
import { ZONE_BUILDS } from "./expected-builds";
import { PLAYABLE_ZONES, clearRate, snapshotWith } from "./probe";
import { classFiftyScale } from "./tune-budgets";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const runs = Number(arg("runs") ?? 40);
const seeds = Number(arg("seeds") ?? 4);
const classes = (arg("classes") ?? "monk,mage,warrior,ranger").split(",");
const zoneIds = (arg("zones") ?? PLAYABLE_ZONES.map((z) => z.id).join(",")).split(",");
const variants = JSON.parse(readFileSync(arg("variants") ?? "", "utf8")) as Record<string, { path: string; value: unknown }[]>;

function measure(base: ContentSnapshot, classId: string, zoneId: string) {
  const zone = PLAYABLE_ZONES.find((z) => z.id === zoneId)!;
  const build = ZONE_BUILDS[zoneId]!;
  const shipped = new ContentIndex(base).zone(zoneId);
  const budget = { hp: shipped.stages.map((s) => s.hpBudget), dps: shipped.stages.map((s) => s.dpsBudget100) };
  const live = new ContentIndex(base);
  const noDamage = new ContentIndex(snapshotWith({ [zoneId]: { hp: budget.hp, dps: budget.hp.map(() => 0) } }, base));
  const scale = classFiftyScale(zone, build, classId, budget, runs, {}, base);
  const perLevel = classFiftyScale(zone, { ...build, level: build.level + 1 }, classId, budget, runs, {}, base) / scale;
  const wall = build.level - Math.log(scale) / Math.log(Math.max(1.001, perLevel));
  const normal = roleMetrics(noDamage, classId, build, zoneId, "normal", seeds, false).seconds;
  const boss = roleMetrics(noDamage, classId, build, zoneId, "boss", seeds, false).seconds;
  const at = (dl: number) => clearRate(live, zoneId, { ...build, level: build.level + dl }, runs, [classId]).rate;
  return { scale, wall, normal, boss, clear: [at(-1), at(0), at(1)] };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
console.log(`| Variant | Class | Zone | Wall | 50% scale | Normal s | Boss s | Clear L-1/L/L+1 |`);
console.log(`|---|---|---|---|---|---|---|---|`);
for (const [name, patch] of Object.entries(variants)) {
  const base = applyPatch(CONTENT, patch);
  for (const classId of classes) {
    for (const zoneId of zoneIds) {
      const m = measure(base, classId, zoneId);
      console.log(
        `| ${name} | ${classId} | ${zoneId} | ${m.wall.toFixed(2)} | ${m.scale.toFixed(3)} | ${m.normal.toFixed(1)} | ${m.boss.toFixed(1)} | ${m.clear.map(pct).join(" / ")} |`,
      );
    }
  }
}
