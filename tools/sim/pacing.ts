#!/usr/bin/env bun
/**
 * C1 pacing simulation: model players (tools/sim/model-player.ts) over N days, for one or more
 * check-in patterns, reported against the targets in docs/design/C1_ADVENTURE.md (C1 retune).
 *
 *   bun tools/sim/pacing.ts [--days=21] [--seeds=12] [--classes=monk,mage]
 *                           [--schedules=once,twice,model] [--out=name] [--jobs=2]
 *
 * "twice" (08:00 10 min, 19:00 20 min) is normal play and the calibration schedule;
 * "once" (19:00, 20 min) is light play; "model" (08:00, 12:30, 19:00) is engaged play.
 * --jobs splits the players over child processes (results are identical to --jobs=1).
 *
 * Tools may use floats; game-core stays integer-only.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { CONTENT } from "@emberbound/game-content";
import { ContentIndex } from "@emberbound/game-core";
import { CS4_MAX_DAY_GAP, sanityResult } from "./class-targets";
import { runModelPlayer, type PlayerReport, type PushAttempt } from "./model-player";
import { CALIBRATION_SCHEDULE } from "./pacing-targets";

const arg = (name: string, fallback: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const days = Number(arg("days", "21"));
const seeds = Number(arg("seeds", "12"));
const classes = arg("classes", "monk,mage").split(",");
const schedules = arg("schedules", "once,twice,model").split(",");
const outName = arg("out", "pacing");

const jobs = Number(arg("jobs", "1"));
const worker = arg("worker", ""); // "i/n": run every n-th player starting at i
const workerOut = arg("worker-out", ""); // JSON file for the worker's reports

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const INSTALL_AT = 19 * HOUR;
const SCHEDULE_TEXT: Record<string, string> = {
  once: "1×/day (19:00, 20 min) — light",
  twice: "2×/day (08:00 10 min, 19:00 20 min) — normal, calibration",
  model: "3×/day (08:00, 12:30, 19:00) — engaged",
};

const content = new ContentIndex(CONTENT);
const zones = CONTENT.zones.filter((z) => z.implemented && !z.hidden).sort((a, b) => a.order - b.order);
const started = performance.now();
const players = schedules.flatMap((schedule) =>
  classes.flatMap((classId) => {
    const alternate = classes.find((c) => c !== classId) ?? (classId === "monk" ? "mage" : "monk");
    return Array.from({ length: seeds }, (_, s) => ({ classId, alternateClassId: alternate, seed: 1000 + s * 7919, days, schedule }));
  }),
);
const keyOf = (p: { schedule: string; classId: string; seed: number }) => `${p.schedule}/${p.classId}/${p.seed}`;
let reports: PlayerReport[] = [];
if (worker) {
  const [i, n] = worker.split("/").map(Number) as [number, number];
  const mine = players.filter((_p, k) => k % n === i).map((p) => runModelPlayer(content, p));
  writeFileSync(workerOut, JSON.stringify(mine));
  process.exit(0);
} else if (jobs > 1) {
  const passThrough = process.argv.slice(2).filter((a) => !a.startsWith("--jobs=") && !a.startsWith("--out="));
  const tmp = mkdtempSync(join(tmpdir(), "ember-pacing-"));
  const parts = await Promise.all(
    Array.from({ length: jobs }, async (_, i) => {
      const file = join(tmp, `part-${i}.json`);
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...passThrough, `--worker=${i}/${jobs}`, `--worker-out=${file}`], { stdio: "inherit" });
      const code = await new Promise<number | null>((resolve) => child.on("exit", resolve));
      if (code !== 0) throw new Error(`pacing worker ${i} failed`);
      return JSON.parse(readFileSync(file, "utf8")) as PlayerReport[];
    }),
  );
  rmSync(tmp, { recursive: true, force: true });
  // Restore the single-process order.
  const byKey = new Map(parts.flat().map((r) => [keyOf(r), r]));
  reports = players.map((p) => byKey.get(keyOf(p))!);
} else {
  reports = players.map((p) => runModelPlayer(content, p));
}
const elapsedS = (performance.now() - started) / 1000;

// ---------------------------------------------------------------------------
const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : "—");
const pct = (x: number) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : "—");
const range = (xs: number[]) => {
  const fin = xs.filter(Number.isFinite);
  const miss = xs.length - fin.length;
  return fin.length ? `${f1(Math.min(...fin))}–${f1(Math.max(...fin))}${miss ? `, ${miss} not` : ""}` : "none";
};
const clearDay = (r: PlayerReport, z: string) => r.clears.find((c) => c.zoneId === z)?.day ?? Infinity;
const firstOn = (r: PlayerReport, d: number) => r.sessionStarts.find((s) => s.wallMs >= d * DAY);
/** Items per day over days 1–7 (session starts), and simulated / real hours over the same span. */
const itemsPerDay = (r: PlayerReport) => {
  const a = firstOn(r, 1)!;
  const b = firstOn(r, Math.min(8, days))!;
  return (b.items - a.items) / (Math.min(8, days) - 1);
};
const simPerReal = (r: PlayerReport) => {
  const b = firstOn(r, Math.min(8, days))!;
  return b.simHours / ((b.wallMs - INSTALL_AT) / HOUR);
};
const earnedByDay = (r: PlayerReport, d: number) => r.timeline.filter((t) => t.wallMs <= (d + 1) * DAY).pop()!;

const lines: string[] = [];
const out = (s = "") => lines.push(s);
out(`# C1 pacing simulation`);
out();
out(`Content \`${CONTENT.contentVersion}\` · hash \`${content.hash.slice(0, 12)}\` · offline storage ${f1(CONTENT.config.offlineCapMs / HOUR)} h · ${days} days · ${seeds} seeds × ${classes.join("/")} × ${schedules.join("/")} · ${elapsedS.toFixed(1)} s`);
out();

const targets: { id: string; text: string; pass: boolean; value: string }[] = [];
const bySchedule = (sch: string) => reports.filter((r) => r.schedule === sch);

// ---------------------------------------------------------------- schedule comparison
if (schedules.length > 1) {
  out(`## Check-in patterns compared (medians over ${classes.join(" + ")})`);
  out();
  out(`| Player | Sim h / real h | Greenfields day | Darkwood day | Ashen day | Level end of day 1 / 2 / 3 / 5 / 7 | Mastery end of day 1 / 2 / 3 / 5 / 7 | Items/day (days 1–7) | Earned XP · Mastery by day 7 vs 3×/day |`);
  out(`|---|---|---|---|---|---|---|---|---|`);
  const marks = [1, 2, 3, 5, 7].filter((d) => d <= days);
  for (const sch of schedules) {
    const rs = bySchedule(sch);
    const ref = schedules.includes("model") ? bySchedule("model") : rs;
    const ratio = (pick: (r: PlayerReport) => number) =>
      classes
        .map((c) => median(rs.filter((r) => r.classId === c).map(pick)) / median(ref.filter((r) => r.classId === c).map(pick)))
        .reduce((a, b) => a + b, 0) / classes.length;
    const lvl = (d: number) => median(rs.map((r) => Math.max(1, ...Object.entries(r.levels).filter(([, at]) => at.day <= d).map(([k]) => Number(k)))));
    const mas = (d: number) => median(rs.map((r) => Math.max(1, ...Object.entries(r.mastery).filter(([, at]) => at.day <= d).map(([k]) => Number(k)))));
    out(
      `| ${SCHEDULE_TEXT[sch] ?? sch} | ${pct(median(rs.map(simPerReal)))} | ${f1(median(rs.map((r) => clearDay(r, "greenfields"))))} | ${f1(median(rs.map((r) => clearDay(r, "darkwood"))))} (${range(rs.map((r) => clearDay(r, "darkwood")))}) | ` +
        `${f1(median(rs.map((r) => clearDay(r, "ashen_mountains"))))} (${range(rs.map((r) => clearDay(r, "ashen_mountains")))}) | ${marks.map(lvl).join(" / ")} | ${marks.map(mas).join(" / ")} | ${f1(median(rs.map(itemsPerDay)))} | ` +
        `${pct(ratio((r) => earnedByDay(r, 7).xp))} · ${pct(ratio((r) => earnedByDay(r, 7).masteryXp))} |`,
    );
  }
  out();
  if (schedules.includes("model")) {
    for (const [sch, min, label] of [
      ["once", 0.75, "R1"],
      ["twice", 0.9, "R2"],
    ] as const) {
      if (!schedules.includes(sch)) continue;
      const rs = bySchedule(sch);
      const ref = bySchedule("model");
      const keep = (pick: (r: PlayerReport) => number) =>
        Math.min(...classes.map((c) => median(rs.filter((r) => r.classId === c).map(pick)) / median(ref.filter((r) => r.classId === c).map(pick))));
      const xp = keep((r) => earnedByDay(r, 7).xp);
      const m = keep((r) => earnedByDay(r, 7).masteryXp);
      targets.push({ id: `${label} ${sch}`, text: `${sch === "once" ? "1×" : "2×"}/day keeps ≥ ${Math.round(min * 100)}% of the 3×/day Character XP and Mastery XP by day 7 (lowest class)`, pass: xp >= min && m >= min, value: `XP ${pct(xp)}, Mastery ${pct(m)}` });
    }
  }
}

// ---------------------------------------------------------------- per schedule and class
for (const sch of schedules) {
  for (const classId of classes) {
    const rs = reports.filter((r) => r.classId === classId && r.schedule === sch);
    out(`## ${classId} · ${SCHEDULE_TEXT[sch] ?? sch}`);
    out();
    out(`| Zone | First clear: day median (range) | Sim hours median | Level at clear | Mastery at clear | Push attempts median | Failed Pushes before the clear (median) | Seeds cleared |`);
    out(`|---|---|---|---|---|---|---|---|`);
    for (const z of zones) {
      const cs = rs.map((r) => r.clears.find((c) => c.zoneId === z.id)).filter((c) => c !== undefined);
      const fails = rs.map((r) => r.pushLog.filter((p) => p.zoneId === z.id && !p.cleared).length);
      out(`| ${z.name} | ${f1(median(cs.map((c) => c.day)))} (${range(rs.map((r) => clearDay(r, z.id)))}) | ${f1(median(cs.map((c) => c.simHours)))} | ${f1(median(cs.map((c) => c.level)))} | ${f1(median(cs.map((c) => c.mastery)))} | ${f1(median(cs.map((c) => c.pushAttempts)))} | ${f1(median(fails))} | ${cs.length}/${rs.length} |`);
    }
    out();
    const levelMarks = [5, 8, 10, 12, 15, 18, 20, 22, 25, 30];
    out(`| Level | ${levelMarks.join(" | ")} |`);
    out(`|---|${levelMarks.map(() => "---").join("|")}|`);
    out(`| median day | ${levelMarks.map((l) => { const d = rs.map((r) => r.levels[l]?.day).filter((x) => x !== undefined) as number[]; return d.length === rs.length ? f1(median(d)) : `${f1(median(d))} (${d.length}/${rs.length})`; }).join(" | ")} |`);
    const masteryMarks = [5, 7, 10, 15, 20];
    out();
    out(`| Mastery | ${masteryMarks.join(" | ")} |`);
    out(`|---|${masteryMarks.map(() => "---").join("|")}|`);
    out(`| median day | ${masteryMarks.map((m) => { const d = rs.map((r) => r.mastery[m]?.day).filter((x) => x !== undefined) as number[]; return d.length === rs.length ? f1(median(d)) : `${f1(median(d))} (${d.length}/${rs.length})`; }).join(" | ")} |`);
    out();
    const fs = rs.map((r) => r.firstSession);
    out(`**First 30-minute session:** level ${f1(median(fs.map((x) => x.level)))}, mastery ${f1(median(fs.map((x) => x.mastery)))}, Greenfields cleared in ${fs.filter((x) => x.clears.includes("greenfields")).length}/${fs.length}, drops ${f1(median(fs.map((x) => x.drops)))}`);
    out();
    const longest = rs.flatMap((r) => r.nights.filter((n) => n.day <= 7));
    out(`**Items per day (days 1–7):** median ${f1(median(rs.map(itemsPerDay)))} (range ${range(rs.map(itemsPerDay))}) · longest absences (≥ 8 h, week 1): ${f1(median(longest.map((n) => n.drops)))} drops, ${f1(median(longest.map((n) => n.fights)))} fights, compute ${f1(median(longest.map((n) => n.computeMs)))} ms`);
    out();
    out(`**Victory length (median s):** ${zones.map((z) => `${z.name} ${["normal", "elite", "boss"].map((role) => f1(median(rs.flatMap((r) => r.durations[z.id]?.[role] ?? [])) / 1000)).join("/")}`).join(" · ")}`);
    out();
    out(`**Push failure stages:** ${zones.map((z) => { const all = rs.flatMap((r) => r.failStages[z.id] ?? []); const hist: Record<number, number> = {}; for (const st of all) hist[st] = (hist[st] ?? 0) + 1; return `${z.name}: ${all.length} (${Object.entries(hist).map(([k, v]) => `s${k}:${v}`).join(" ") || "none"})`; }).join(" · ")}`);
    out();
    const fin = rs.map((r) => r.final);
    out(`**Day ${days} end:** level ${f1(median(fin.map((x) => x.level)))}, mastery ${f1(median(fin.map((x) => x.mastery)))}, items ${f1(median(fin.map((x) => x.items)))}, gold ${f1(median(fin.map((x) => x.gold)))}`);
    out();

    // Targets (docs/design/C1_ADVENTURE.md, C1 retune)
    const ashen = rs.map((r) => clearDay(r, "ashen_mountains"));
    const dark = rs.map((r) => clearDay(r, "darkwood"));
    const tag = `${classId} ${sch}`;
    if (sch === "once") {
      targets.push({ id: `D2 ${tag}`, text: "Darkwood first clear median ≤ day 3", pass: median(dark) <= 3, value: `median ${f1(median(dark))}, range ${range(dark)}` });
      continue;
    }
    targets.push({ id: `D1 ${tag}`, text: "Greenfields cleared in the first session (≥ 80%)", pass: fs.filter((x) => x.clears.includes("greenfields")).length >= 0.8 * fs.length, value: `${fs.filter((x) => x.clears.includes("greenfields")).length}/${fs.length}` });
    targets.push({ id: `D2 ${tag}`, text: "Darkwood first clear median day 1–2", pass: median(dark) >= 1 && median(dark) <= 2, value: `median ${f1(median(dark))}, range ${range(dark)}` });
    if (sch !== CALIBRATION_SCHEDULE) continue;
    const failsBefore = rs.map((r) => r.pushLog.filter((p) => p.zoneId === "darkwood" && !p.cleared).length);
    targets.push({ id: `D2c ${tag}`, text: "at least one failed Darkwood Push before the clear (≥ 80% of seeds)", pass: failsBefore.filter((n) => n >= 1).length >= 0.8 * rs.length, value: `${failsBefore.filter((n) => n >= 1).length}/${rs.length}` });
    targets.push({ id: `T1 ${tag}`, text: "Ashen first clear median day 6–8, all seeds day 5–10", pass: median(ashen) >= 6 && median(ashen) <= 8 && Math.min(...ashen) >= 5 && Math.max(...ashen) <= 10, value: `median ${f1(median(ashen))}, range ${range(ashen)}` });
    const lvlAtAshen = rs.map((r) => r.clears.find((c) => c.zoneId === "ashen_mountains")?.level ?? NaN).filter(Number.isFinite);
    targets.push({ id: `D3 ${tag}`, text: "level at Ashen clear 18–21", pass: median(lvlAtAshen) >= 18 && median(lvlAtAshen) <= 21, value: `median ${f1(median(lvlAtAshen))}` });
    const l30 = rs.filter((r) => r.levels[30] !== undefined).length;
    targets.push({ id: `D4 ${tag}`, text: `level 30 not reached within ${days} days`, pass: l30 === 0, value: `${l30}/${rs.length} reached` });
    const m7 = rs.map((r) => r.mastery[7]?.day ?? Infinity);
    const m15 = rs.map((r) => r.mastery[15]?.day ?? Infinity);
    const m20 = rs.map((r) => r.mastery[20]?.day ?? Infinity);
    targets.push({ id: `D5 ${tag}`, text: "M7 ≈ Darkwood clear (±1 day), M15 day 6–9, M20 not before day 21", pass: Math.abs(median(m7) - median(dark)) <= 1 && median(m15) >= 6 && median(m15) <= 9 && Math.min(...m20) >= 21, value: `M7 ${f1(median(m7))}, M15 ${f1(median(m15))}, M20 earliest ${f1(Math.min(...m20))}` });
  }
}

// ---------------------------------------------------------------- Darkwood progress trace
{
  const sch = schedules.includes(CALIBRATION_SCHEDULE) ? CALIBRATION_SCHEDULE : schedules[0]!;
  out(`## Darkwood Push attempts (${SCHEDULE_TEXT[sch] ?? sch})`);
  out();
  out("Every Darkwood Push until the first clear. \"Changed\" = the level, Mastery rank or equipped gear differs from the previous attempt.");
  out();
  const pairs: { changed: boolean; closer: boolean; delta: number }[] = [];
  const cell = (p: PushAttempt) => (p.cleared ? "**clear**" : `${content.zone("darkwood").stages[p.stage - 1]?.role === "boss" ? "Boss" : `s${p.stage}`} ${Math.round(p.enemyLeft * 100)}%`);
  const score = (p: PushAttempt) => (p.cleared ? -1 : p.stage === 10 ? p.enemyLeft : 1 + (10 - p.stage));
  for (const classId of classes) {
    for (const r of reports.filter((x) => x.schedule === sch && x.classId === classId)) {
      const log = r.pushLog.filter((p) => p.zoneId === "darkwood");
      const until = log.findIndex((p) => p.cleared);
      const trail = until >= 0 ? log.slice(0, until + 1) : log;
      for (let i = 1; i < trail.length; i += 1) {
        const a = trail[i - 1]!;
        const b = trail[i]!;
        const changed = a.level !== b.level || a.rank !== b.rank || a.gear !== b.gear;
        pairs.push({ changed, closer: score(b) < score(a), delta: score(a) - score(b) });
      }
      if (r.seed === 1000 || r.seed === 1000 + 7919) {
        out(`- ${classId} seed ${r.seed}: ${trail.map((p) => `d${f1(p.wallMs / DAY - 0)} L${p.level} M${p.rank} ${cell(p)}`).join(" → ") || "no attempts"}`);
      }
    }
  }
  out();
  const changed = pairs.filter((p) => p.changed);
  const same = pairs.filter((p) => !p.changed);
  out(`Consecutive attempts after a build change: ${changed.length}, of which ${pct(changed.filter((p) => p.closer).length / Math.max(1, changed.length))} ended closer (or cleared). Without a change: ${same.length}.`);
  out();
  if (sch === CALIBRATION_SCHEDULE) {
    targets.push({ id: `P1 ${sch}`, text: "after a level, Mastery or gear change, the next Darkwood attempt ends closer (≥ 80% of such pairs)", pass: changed.length > 0 && changed.filter((p) => p.closer).length >= 0.8 * changed.length, value: `${changed.filter((p) => p.closer).length}/${changed.length}` });
  }
}

// ---------------------------------------------------------------- CS4
// Class-split sanity check (tools/sim/class-targets.ts): per zone, the classes' median
// first-clear days differ by at most CS4_MAX_DAY_GAP and their seed ranges overlap (calibration schedule).
const splitRows: string[] = [];
const calib = schedules.includes(CALIBRATION_SCHEDULE) ? CALIBRATION_SCHEDULE : schedules[0]!;
if (classes.length > 1) {
  for (const z of zones) {
    const perClass = classes.map((classId) => {
      const ds = reports.filter((r) => r.classId === classId && r.schedule === calib).map((r) => clearDay(r, z.id));
      return { classId, median: median(ds), min: Math.min(...ds), max: Math.max(...ds) };
    });
    const medians = perClass.map((p) => p.median);
    const gap = Math.max(...medians) - Math.min(...medians);
    const overlap = Math.max(...perClass.map((p) => p.min)) <= Math.min(...perClass.map((p) => p.max));
    const pass = Number.isFinite(gap) && gap <= CS4_MAX_DAY_GAP && overlap;
    splitRows.push(`| ${z.name} | ${perClass.map((p) => `${p.classId} ${f1(p.median)} (${f1(p.min)}–${f1(p.max)})`).join(" · ")} | ${f1(gap)} | ${overlap ? "yes" : "no"} | ${sanityResult(z.id, "CS4", pass)} |`);
    if (!pass) targets.push({ id: `CS4 ${z.name}`, text: `class split: median first-clear days differ by ≤ ${CS4_MAX_DAY_GAP}, ranges overlap`, pass: sanityResult(z.id, "CS4", pass) !== "**FAIL**", value: `gap ${f1(gap)} days, overlap ${overlap ? "yes" : "no"}` });
  }
}

if (splitRows.length) {
  out(`## Class-split sanity check (CS4, ${calib})`);
  out();
  out(`| Zone | First-clear day median (range) per class | Median gap (≤ ${CS4_MAX_DAY_GAP}) | Ranges overlap | Result |`);
  out(`|---|---|---|---|---|`);
  for (const row of splitRows) out(row);
  out();
}
out(`## Targets`);
out();
out(`| Target | Check | Value | Result |`);
out(`|---|---|---|---|`);
for (const t of targets) out(`| ${t.id} | ${t.text} | ${t.value} | ${t.pass ? "PASS" : "**FAIL**"} |`);

const text = lines.join("\n");
console.log(text);
const dir = fileURLToPath(new URL("./out/", import.meta.url));
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}${outName}.md`, text + "\n");
writeFileSync(`${dir}${outName}.json`, JSON.stringify({ days, seeds, classes, schedules, contentHash: content.hash, targets, reports }, null, 1));
