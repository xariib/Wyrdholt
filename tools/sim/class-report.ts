#!/usr/bin/env bun
/**
 * Class performance report (C1 class targets; four classes from C2 preparation on).
 *
 *   bun tools/sim/class-report.ts [--classes=monk,mage,warrior,ranger] [--reference=monk,mage]
 *        [--budgets=shipped|calibrate] [--runs=60] [--seeds=5] [--patch=path.json] [--out=name]
 *
 * --classes     classes to measure (default: every implemented base class)
 * --reference   the accepted class set for CT1/CT2 and the sanity check
 *               (default: CALIBRATION_CLASSES, i.e. Monk and Mage)
 * --budgets     shipped   = the zone budgets in content (default; what players fight)
 *               calibrate = recalibrate each zone against --reference (the C1 method)
 * --patch       JSON array of { path, value } applied to CONTENT, e.g. to try kit values:
 *               [{ "path": "classes.2.base.hp", "value": 140 }]
 *
 * Per zone, at the zone's expected build (tools/sim/expected-builds.ts), per class:
 * - stats; sustained DPS and fight length per role with enemy damage off
 * - damage sources (basic / class / item, DoT share) and per-mechanic shares; procs per fight
 * - mastery contribution: DPS at the expected mastery vs the same build at M1
 * - survivability: the enemy damage scale at which the class alone clears 50% of Push runs
 * - wall level (build level at which the class clears 50%) and its offset from the reference
 * - Elite and Boss from full HP at the budgets: win rate, HP left, healing / damage taken
 * - full-Push clear rate one level below, at, and above the expected build
 *
 * Targets and sanity limits: tools/sim/class-targets.ts, docs/design/C1_ADVENTURE.md §8.
 * Push runs are nearly deterministic, so parity is measured as the wall level.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { ContentSnapshot } from "@emberbound/shared-types";
import { CONTENT } from "@emberbound/game-content";
import { ContentIndex, heroStatsFor } from "@emberbound/game-core";
import { roleMetrics, type RoleMetrics } from "./class-metrics";
import {
  CALIBRATION_CLASSES,
  TARGET_CLASSES,
  CS1_MAX_SURVIVABILITY_RATIO,
  CS2_MAX_BOSS_RATIO,
  CS3_MAX_CLEAR_BELOW,
  CS3_MIN_CLEAR_ABOVE,
  CT1_MAX_WALL_GAP,
  CT2_MAX_NORMAL_RATIO,
  sanityResult,
} from "./class-targets";
import { ZONE_BUILDS } from "./expected-builds";
import { PLAYABLE_ZONES, clearRate, profileFor, snapshotWith, type Budgets } from "./probe";
import { IMPLEMENTED_CLASSES, calibrate, classFiftyScale } from "./tune-budgets";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

export function applyPatch(base: ContentSnapshot, patch: { path: string; value: unknown }[]): ContentSnapshot {
  const snap: ContentSnapshot = JSON.parse(JSON.stringify(base));
  for (const { path, value } of patch) {
    const keys = path.split(".");
    let obj: Record<string, unknown> = snap as unknown as Record<string, unknown>;
    for (const k of keys.slice(0, -1)) obj = obj[k] as Record<string, unknown>;
    obj[keys[keys.length - 1]!] = value;
  }
  return snap;
}

interface ClassRow {
  classId: string;
  stats: { hp: number; attack: number; armor: number; rate: number; crit: number };
  normal: RoleMetrics;
  elite: RoleMetrics;
  boss: RoleMetrics;
  normalM1: RoleMetrics;
  eliteLive: RoleMetrics;
  bossLive: RoleMetrics;
  scale: number;
  perLevel: number;
  wall: number;
  /** Lowest build level (same gear and mastery) at which the class clears >= 50% of Push runs. */
  clearsFrom: number | null;
  clear: { below: number; at: number; above: number };
}

interface ZoneResult {
  zoneId: string;
  zone: string;
  rows: ClassRow[];
}

const pct = (x: number | undefined) => (x === undefined || Number.isNaN(x) ? "—" : `${Math.round(x * 100)}%`);
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : "—");
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : "—");
const ratio = (xs: number[]) => Math.max(...xs) / Math.min(...xs);
const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function measureZone(zoneIndex: number, classes: string[], reference: string[], base: ContentSnapshot, mode: string, runs: number, seeds: number): ZoneResult {
  const zone = PLAYABLE_ZONES[zoneIndex]!;
  const build = ZONE_BUILDS[zone.id]!;
  const shipped = new ContentIndex(base).zone(zone.id);
  const budget =
    mode === "calibrate"
      ? calibrate(zone, build, reference, runs, {}, base).budget
      : { hp: shipped.stages.map((s) => s.hpBudget), dps: shipped.stages.map((s) => s.dpsBudget100) };
  const budgets: Budgets = { [zone.id]: budget };
  const live = new ContentIndex(snapshotWith(budgets, base));
  const noDamage = new ContentIndex(snapshotWith({ [zone.id]: { hp: budget.hp, dps: budget.hp.map(() => 0) } }, base));
  const rows: ClassRow[] = classes.map((cls) => {
    const h = heroStatsFor(profileFor(noDamage, cls, build, 1), noDamage).display;
    const scale = classFiftyScale(zone, build, cls, budget, runs, {}, base);
    const perLevel = classFiftyScale(zone, { ...build, level: build.level + 1 }, cls, budget, runs, {}, base) / scale;
    const at = (dl: number) => clearRate(live, zone.id, { ...build, level: build.level + dl }, runs, [cls]).rate;
    // Direct scan instead of extrapolating far outside the measured range.
    let clearsFrom: number | null = null;
    for (let level = Math.max(1, build.level - 3); level <= live.snapshot.config.maxCharacterLevel; level += 1) {
      if (clearRate(live, zone.id, { ...build, level }, runs, [cls]).rate >= 0.5) {
        clearsFrom = level;
        break;
      }
    }
    return {
      classId: cls,
      stats: { hp: h.hp, attack: h.attack, armor: h.armor, rate: h.attackRateMilli / 1000, crit: h.critBp / 100 },
      normal: roleMetrics(noDamage, cls, build, zone.id, "normal", seeds, false),
      elite: roleMetrics(noDamage, cls, build, zone.id, "elite", seeds, false),
      boss: roleMetrics(noDamage, cls, build, zone.id, "boss", seeds, false),
      normalM1: roleMetrics(noDamage, cls, { ...build, mastery: 1 }, zone.id, "normal", seeds, false),
      eliteLive: roleMetrics(live, cls, build, zone.id, "elite", seeds * 4, true),
      bossLive: roleMetrics(live, cls, build, zone.id, "boss", seeds * 4, true),
      scale,
      perLevel,
      // Levels this class needs to reach the zone's damage (scale 1.0).
      wall: build.level - Math.log(scale) / Math.log(Math.max(1.001, perLevel)),
      clearsFrom,
      clear: { below: at(-1), at: at(0), above: at(1) },
    };
  });
  return { zoneId: zone.id, zone: zone.name, rows };
}

function main(): void {
  const runs = Number(arg("runs") ?? 60);
  const seeds = Number(arg("seeds") ?? 5);
  const outName = arg("out") ?? "class-report";
  const mode = arg("budgets") ?? "shipped";
  if (mode !== "shipped" && mode !== "calibrate") throw new Error(`--budgets must be shipped or calibrate`);
  const classes = (arg("classes") ?? IMPLEMENTED_CLASSES.join(",")).split(",");
  const reference = (arg("reference") ?? CALIBRATION_CLASSES.join(",")).split(",").filter((c) => classes.includes(c));
  const patchFile = arg("patch");
  const base = patchFile ? applyPatch(CONTENT, JSON.parse(readFileSync(patchFile, "utf8"))) : CONTENT;

  const lines: string[] = [];
  const out = (s = "") => {
    lines.push(s);
    console.log(s);
  };
  out(`# Class performance report`);
  out();
  out(`Content \`${base.contentVersion}\` · budgets **${mode}** · patch ${patchFile ?? "none"} · ${runs} Push runs per point · ${seeds} fights per stage (×4 with enemy damage)`);
  out();
  out(`Classes: ${classes.join(", ")} · reference (accepted set for CT1/CT2 and the sanity check): ${reference.join(", ")}`);
  out();

  const results = PLAYABLE_ZONES.map((_z, i) => measureZone(i, classes, reference, base, mode, runs, seeds));

  for (const z of results) {
    const build = ZONE_BUILDS[z.zoneId]!;
    const refRows = z.rows.filter((r) => reference.includes(r.classId));
    const refWall = mean(refRows.map((r) => r.wall));
    const refNormal = mean(refRows.map((r) => r.normal.seconds));
    out(`## ${z.zone} — expected build L${build.level} M${build.mastery}`);
    out();
    out(`**Stats and output** (enemy damage off; DPS = effective damage per second)`);
    out();
    out(`| Class | HP | Attack | Armor | Attacks/s | Crit | Normal s | Normal DPS | Elite s | Boss s | Boss DPS | Kill speed vs ref | Mastery ×DPS (vs M1) |`);
    out(`|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
    for (const r of z.rows) {
      out(`| ${r.classId} | ${r.stats.hp} | ${r.stats.attack} | ${r.stats.armor} | ${r.stats.rate.toFixed(2)} | ${r.stats.crit.toFixed(1)}% | ${f1(r.normal.seconds)} | ${f1(r.normal.dps)} | ${f1(r.elite.seconds)} | ${f1(r.boss.seconds)} | ${f1(r.boss.dps)} | ${f2(refNormal / r.normal.seconds)} | ${f2(r.normal.dps / r.normalM1.dps)} |`);
    }
    out();
    out(`**Damage sources** (Boss fights, share of hero damage)`);
    out();
    out(`| Class | Basic | Class | Item | of which DoT | Top mechanics | Procs per Boss fight |`);
    out(`|---|---|---|---|---|---|---|`);
    for (const r of z.rows) {
      const top = Object.entries(r.boss.byMechanic)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([k, v]) => `${k} ${pct(v)}`)
        .join(", ");
      const procs = Object.entries(r.boss.procs)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} ${v.toFixed(1)}`)
        .join(", ");
      out(`| ${r.classId} | ${pct(r.boss.sources.basic)} | ${pct(r.boss.sources.class)} | ${pct(r.boss.sources.item)} | ${pct(r.boss.dotShare)} | ${top} | ${procs || "—"} |`);
    }
    out();
    out(`**Survival and walls** (${mode} budgets; Elite/Boss from full HP)`);
    out();
    out(`| Class | 50% damage scale | per level | Wall level | vs reference | Clears Push from level | Push clear L-1 / L / L+1 | Elite win · HP left | Boss win · HP left | Boss heal / taken |`);
    out(`|---|---|---|---|---|---|---|---|---|---|`);
    for (const r of z.rows) {
      const offset = r.wall - refWall;
      const offsetText = `${offset >= 0 ? "+" : "−"}${Math.abs(offset).toFixed(1)}`;
      out(`| ${r.classId} | ${f2(r.scale)} | +${((r.perLevel - 1) * 100).toFixed(1)}% | ${f1(r.wall)} | ${offsetText} | ${r.clearsFrom ?? "not by 30"} | ${pct(r.clear.below)} / ${pct(r.clear.at)} / ${pct(r.clear.above)} | ${pct(r.eliteLive.winRate)} · ${pct(r.eliteLive.hpLeft)} | ${pct(r.bossLive.winRate)} · ${pct(r.bossLive.hpLeft)} | ${f2(r.bossLive.healPerTaken ?? Number.NaN)} |`);
    }
    out();
    out(`"Wall level" is interpolated from the 50% damage scale at L and L+1; "vs reference" is its offset from the reference classes' mean (negative = stronger). Offsets beyond about ±2 levels are extrapolated, so "Clears Push from level" (a direct scan, same gear and mastery) is the reliable number there.`);
    out();
  }

  const setChecks = (set: string[]) =>
    results.map((z) => {
      const rows = z.rows.filter((r) => set.includes(r.classId));
      return {
        zoneId: z.zoneId,
        zone: z.zone,
        ct1: spread(rows.map((r) => r.wall)),
        ct2: ratio(rows.map((r) => r.normal.seconds)),
        cs1: ratio(rows.map((r) => r.scale)),
        cs2: ratio(rows.map((r) => r.boss.seconds)),
        cs3Above: Math.min(...rows.map((r) => r.clear.above)),
        cs3Below: Math.max(...rows.map((r) => r.clear.below)),
      };
    });
  const printChecks = (title: string, set: string[], binding: boolean) => {
    out(`## ${title}`);
    out();
    out(`Classes: ${set.join(", ")}${binding ? "" : " — **preview only, not a target yet**"}`);
    out();
    out(`| Zone | CT1 wall gap (≤ ${CT1_MAX_WALL_GAP}) | CT2 kill speed ratio (≤ ${CT2_MAX_NORMAL_RATIO}) | CS1 survivability (≤ ${CS1_MAX_SURVIVABILITY_RATIO}) | CS2 Boss length (≤ ${CS2_MAX_BOSS_RATIO}) | CS3 L+1 lowest (≥ ${pct(CS3_MIN_CLEAR_ABOVE)}) · L-1 highest (≤ ${pct(CS3_MAX_CLEAR_BELOW)}) | Result |`);
    out(`|---|---|---|---|---|---|---|`);
    for (const c of setChecks(set)) {
      const targets = c.ct1 <= CT1_MAX_WALL_GAP && c.ct2 <= CT2_MAX_NORMAL_RATIO;
      const sanity = [
        sanityResult(c.zoneId, "CS1", c.cs1 <= CS1_MAX_SURVIVABILITY_RATIO),
        sanityResult(c.zoneId, "CS2", c.cs2 <= CS2_MAX_BOSS_RATIO),
        sanityResult(c.zoneId, "CS3", c.cs3Above >= CS3_MIN_CLEAR_ABOVE && c.cs3Below <= CS3_MAX_CLEAR_BELOW),
      ];
      const ok = targets && sanity.every((s) => s !== "**FAIL**");
      out(`| ${c.zone} | ${f2(c.ct1)} | ${f2(c.ct2)} | ${f2(c.cs1)} | ${f2(c.cs2)} | ${pct(c.cs3Above)} · ${pct(c.cs3Below)} | ${ok ? "PASS" : binding ? "**FAIL**" : "outside"} |`);
    }
    out();
  };
  // Mastery milestones: output at the Ashen build (enemy damage off) per milestone.
  const ashen = PLAYABLE_ZONES.find((z) => z.id === "ashen_mountains");
  if (ashen) {
    const build = ZONE_BUILDS[ashen.id]!;
    const shipped = new ContentIndex(base).zone(ashen.id);
    const noDamage = new ContentIndex(
      snapshotWith({ [ashen.id]: { hp: shipped.stages.map((st) => st.hpBudget), dps: shipped.stages.map(() => 0) } }, base),
    );
    out(`## Mastery milestones (Ashen Mountains, L${build.level}, Ashen gear, enemy damage off)`);
    out();
    out(`Normal-stage DPS by mastery rank, and the change from the previous milestone.`);
    out();
    out(`| Class | M1 | M5 | M10 | M15 | M20 |`);
    out(`|---|---|---|---|---|---|`);
    for (const cls of classes) {
      const values = [1, 5, 10, 15, 20].map((m) => roleMetrics(noDamage, cls, { ...build, mastery: m }, ashen.id, "normal", seeds, false).dps);
      out(`| ${cls} | ${values.map((v, i) => (i === 0 ? f1(v) : `${f1(v)} (${v >= values[i - 1]! ? "+" : "−"}${Math.abs((v / values[i - 1]! - 1) * 100).toFixed(0)}%)`)).join(" | ")} |`);
    }
    out();
  }

  if (reference.length > 1) printChecks("Budget calibration set (reference)", reference, true);
  if (classes.length > reference.length && classes.length > 1) {
    const binding = TARGET_CLASSES.every((c) => classes.includes(c)) && classes.every((c) => TARGET_CLASSES.includes(c));
    printChecks(binding ? "Four-class targets" : "Class-set preview", classes, binding);
  }
  out(`CS4 (first-clear day split between classes) is checked by tools/sim/pacing.ts.`);

  const dir = new URL("./out/", import.meta.url).pathname;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}${outName}.md`, lines.join("\n") + "\n");
  writeFileSync(`${dir}${outName}.json`, JSON.stringify({ mode, classes, reference, runs, seeds, results }, null, 1));
}

if (import.meta.main) main();
