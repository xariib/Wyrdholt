/**
 * Offline storage study (C1 retune, 21 Sep 2026): how much of the three-check-in progression
 * does a once- or twice-a-day player keep, for different offline caps and a soft cap?
 * Same content, seeds and player policy; only the check-in pattern and the offline storage change.
 *
 *   bun tools/sim/offline-cap-study.ts --variants=cap8,cap24 --part=a      (writes out/cap-study-a.json)
 *   bun tools/sim/offline-cap-study.ts --merge=a,b [--out=c1-offline-cap-study]
 *
 * Options: --days=14 --seeds=6 --classes=monk,mage
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { ContentSnapshot } from "@emberbound/shared-types";
import { CONTENT } from "@emberbound/game-content";
import { ContentIndex } from "@emberbound/game-core";
import { runModelPlayer, type PlayerReport } from "./model-player";

const arg = (name: string, fallback: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const INSTALL_AT = 19 * HOUR;

export interface Variant {
  id: string;
  text: string;
  capMs: number;
  curve?: (awayMs: number) => number;
}

/** Soft cap: full rate for `fullH`, then `rate` of real time until `maxH` of absence. */
const soft = (fullH: number, rate: number, maxH: number) => (away: number) =>
  Math.min(away, fullH * HOUR) + Math.round(rate * Math.max(0, Math.min(away, maxH * HOUR) - fullH * HOUR));

export const VARIANTS: Variant[] = [
  { id: "cap8", text: "8 h cap (C1)", capMs: 8 * HOUR },
  { id: "cap12", text: "12 h cap", capMs: 12 * HOUR },
  { id: "cap16", text: "16 h cap", capMs: 16 * HOUR },
  { id: "cap18", text: "18 h cap", capMs: 18 * HOUR },
  { id: "cap24", text: "24 h cap", capMs: 24 * HOUR },
  { id: "soft12", text: "Soft cap: full 12 h, then 50% up to 24 h away (max 18 h)", capMs: 24 * HOUR, curve: soft(12, 0.5, 24) },
];
const SCHEDULES = [
  { id: "once", text: "1×/day (19:00, 20 min)" },
  { id: "twice", text: "2×/day (08:00 10 min, 19:00 20 min)" },
  { id: "model", text: "3×/day (08:00, 12:30, 19:00)" },
];

export function contentWithCap(capMs: number): ContentIndex {
  const snap = JSON.parse(JSON.stringify(CONTENT)) as ContentSnapshot;
  snap.config.offlineCapMs = capMs;
  return new ContentIndex(snap);
}

interface Row {
  variant: string;
  schedule: string;
  classId: string;
  clears: Record<string, number[]>;
  levelByDay: Record<number, number[]>;
  masteryByDay: Record<number, number[]>;
  itemsPerDay: number[];
  simPerReal: number[];
  earnedXpDay7: number[];
  earnedMasteryDay7: number[];
}

const DAYS_SHOWN = [1, 2, 3, 5, 7, 10, 14];

function summarize(variant: string, schedule: string, classId: string, rs: PlayerReport[], days: number): Row {
  const clears: Record<string, number[]> = {};
  for (const z of ["greenfields", "darkwood", "ashen_mountains"]) clears[z] = rs.map((r) => r.clears.find((c) => c.zoneId === z)?.day ?? Infinity);
  const levelByDay: Record<number, number[]> = {};
  const masteryByDay: Record<number, number[]> = {};
  for (const d of DAYS_SHOWN.filter((x) => x <= days)) {
    levelByDay[d] = rs.map((r) => Math.max(1, ...Object.entries(r.levels).filter(([, at]) => at.day <= d).map(([k]) => Number(k))));
    masteryByDay[d] = rs.map((r) => Math.max(1, ...Object.entries(r.mastery).filter(([, at]) => at.day <= d).map(([k]) => Number(k))));
  }
  const firstOn = (r: PlayerReport, d: number) => r.sessionStarts.find((s) => s.wallMs >= d * DAY);
  const lastDay = Math.min(8, days);
  const itemsPerDay = rs.map((r) => {
    const a = firstOn(r, 1)!;
    const b = firstOn(r, lastDay)!;
    return (b.items - a.items) / (lastDay - 1);
  });
  const simPerReal = rs.map((r) => {
    const b = firstOn(r, lastDay)!;
    return b.simHours / ((b.wallMs - INSTALL_AT) / HOUR);
  });
  const endDay7 = 8 * DAY;
  const at7 = (r: PlayerReport) => r.timeline.filter((t) => t.wallMs <= endDay7).pop()!;
  return {
    variant,
    schedule,
    classId,
    clears,
    levelByDay,
    masteryByDay,
    itemsPerDay,
    simPerReal,
    earnedXpDay7: rs.map((r) => at7(r).xp),
    earnedMasteryDay7: rs.map((r) => at7(r).masteryXp),
  };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : "—");
const pct = (x: number) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : "—");
const dayCell = (xs: number[]) => {
  const fin = xs.filter(Number.isFinite);
  const miss = xs.length - fin.length;
  if (!fin.length) return "not cleared";
  return `${f1(median(xs))} (${Math.min(...fin)}–${Math.max(...fin)}${miss ? `, ${miss}✗` : ""})`;
};

const merge = arg("merge", "");
if (!merge) {
  const days = Number(arg("days", "14"));
  const seeds = Number(arg("seeds", "6"));
  const classes = arg("classes", "monk,mage").split(",");
  const want = arg("variants", VARIANTS.map((v) => v.id).join(",")).split(",");
  const part = arg("part", "a");
  const rows: Row[] = [];
  for (const v of VARIANTS.filter((x) => want.includes(x.id))) {
    const content = contentWithCap(v.capMs);
    for (const sch of SCHEDULES) {
      for (const classId of classes) {
        const rs: PlayerReport[] = [];
        for (let s = 0; s < seeds; s += 1) {
          rs.push(
            runModelPlayer(content, {
              classId,
              alternateClassId: classId === "monk" ? "mage" : "monk",
              seed: 1000 + s * 7919,
              days,
              schedule: sch.id,
              ...(v.curve ? { offlineCurve: v.curve } : {}),
            }),
          );
        }
        rows.push(summarize(v.id, sch.id, classId, rs, days));
        console.error(`${v.id} ${sch.id} ${classId} done`);
      }
    }
  }
  mkdirSync("tools/sim/out", { recursive: true });
  writeFileSync(`tools/sim/out/cap-study-${part}.json`, JSON.stringify({ days, seeds, classes, rows }));
} else {
  // JSON has no Infinity: "never cleared" comes back as null.
  const parts = merge
    .split(",")
    .map((p) => JSON.parse(readFileSync(`tools/sim/out/cap-study-${p}.json`, "utf8"), (_k, v) => (v === null ? Infinity : v)) as { days: number; seeds: number; classes: string[]; rows: Row[] });
  const rows = parts.flatMap((p) => p.rows);
  const { days, seeds, classes } = parts[0]!;
  const lines: string[] = [];
  const out = (s = "") => lines.push(s);
  out("# Offline storage study");
  out("");
  out(`Content \`${CONTENT.contentVersion}\` (C1 tables and budgets, fitted for the 8 h cap) · ${days} days · ${seeds} seeds × ${classes.join("/")} per row · model-player policy, only the check-in pattern and offline storage change`);
  out("");
  out("**Retention** compares a player with the same class and seeds on the 3×/day schedule under the same storage rule: earned Character XP and Mastery XP by the end of day 7, and first-clear days.");
  out("");
  out("## Summary: once and twice a day vs three times a day (medians, both classes)");
  out("");
  out("| Storage | Sim h / real h (1× · 2× · 3×) | 1×/day keeps XP · Mastery | 2×/day keeps XP · Mastery | Darkwood day (1× · 2× · 3×) | Ashen day (1× · 2× · 3×) | Items per day (1× · 2× · 3×) |");
  out("|---|---|---|---|---|---|---|");
  const pick = (v: string, s: string) => rows.filter((r) => r.variant === v && r.schedule === s);
  const all = (rs: Row[], f: (r: Row) => number[]) => rs.flatMap(f);
  for (const v of VARIANTS) {
    const [o, t, m] = ["once", "twice", "model"].map((s) => pick(v.id, s));
    if (!o!.length) continue;
    const keep = (a: Row[], f: (r: Row) => number[]) => {
      // per class: median ratio vs model, then mean over classes
      const ratios = classes.map((c) => median(f(a.find((r) => r.classId === c)!)) / median(f(m!.find((r) => r.classId === c)!)));
      return ratios.reduce((x, y) => x + y, 0) / ratios.length;
    };
    const d = (rs: Row[], z: string) => f1(median(all(rs, (r) => r.clears[z]!)));
    out(
      `| ${v.text} | ${[o, t, m].map((rs) => pct(median(all(rs!, (r) => r.simPerReal)))).join(" · ")} | ${pct(keep(o!, (r) => r.earnedXpDay7))} · ${pct(keep(o!, (r) => r.earnedMasteryDay7))} | ${pct(keep(t!, (r) => r.earnedXpDay7))} · ${pct(keep(t!, (r) => r.earnedMasteryDay7))} | ` +
        `${d(o!, "darkwood")} · ${d(t!, "darkwood")} · ${d(m!, "darkwood")} | ${d(o!, "ashen_mountains")} · ${d(t!, "ashen_mountains")} · ${d(m!, "ashen_mountains")} | ` +
        `${[o, t, m].map((rs) => f1(median(all(rs!, (r) => r.itemsPerDay)))).join(" · ")} |`,
    );
  }
  for (const v of VARIANTS) {
    const vr = rows.filter((r) => r.variant === v.id);
    if (!vr.length) continue;
    out("");
    out(`## ${v.text}`);
    out("");
    const shown = DAYS_SHOWN.filter((d) => d <= days);
    out(`| Schedule | Class | Greenfields day | Darkwood day | Ashen day | Level by end of day ${shown.join(" / ")} | Mastery by end of day ${shown.join(" / ")} | Items/day | Sim h / real h |`);
    out("|---|---|---|---|---|---|---|---|---|");
    for (const sch of SCHEDULES) {
      for (const c of classes) {
        const r = vr.find((x) => x.schedule === sch.id && x.classId === c);
        if (!r) continue;
        out(
          `| ${sch.text} | ${c} | ${dayCell(r.clears.greenfields!)} | ${dayCell(r.clears.darkwood!)} | ${dayCell(r.clears.ashen_mountains!)} | ` +
            `${shown.map((d) => median(r.levelByDay[d]!)).join(" / ")} | ${shown.map((d) => median(r.masteryByDay[d]!)).join(" / ")} | ${f1(median(r.itemsPerDay))} | ${pct(median(r.simPerReal))} |`,
        );
      }
    }
  }
  const outName = arg("out", "c1-offline-cap-study");
  writeFileSync(`tools/sim/out/${outName}.md`, lines.join("\n") + "\n");
  console.log(lines.join("\n"));
}
