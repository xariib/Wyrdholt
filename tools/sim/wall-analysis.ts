/**
 * Wall analysis (C1 playtest investigation, 21 Sep 2026): why does a Push go from ~0% to
 * ~100% clears within one level, and what does a player see between those two states?
 *
 * For each zone, around its expected build, it sweeps level, mastery rank and gear and
 * reports per configuration:
 *   - Push clear rate (full runs from stage 1, HP carries over)
 *   - where failures happen, and how much enemy HP is left at a Boss failure
 *   - hero HP entering the Boss stage (the carry-over)
 *   - the Boss fought from full HP (no carry-over)
 *
 *   bun tools/sim/wall-analysis.ts [--runs=40] [--zones=darkwood] [--classes=monk,mage] [--out=c1-wall-analysis]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { CONTENT } from "@emberbound/game-content";
import { ContentIndex, FightCache, advanceAdventure, applyCommand, heroStatsFor, type AdventureEvent } from "@emberbound/game-core";
import { ZONE_BUILDS, type ExpectedBuild } from "./expected-builds";
import { median, probeFight, profileFor } from "./probe";

const arg = (name: string, fallback: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const RUNS = Number(arg("runs", "40"));
const ZONES = arg("zones", "greenfields,darkwood,ashen_mountains").split(",");
const CLASSES = arg("classes", "monk,mage").split(",");
const OUT = arg("out", "c1-wall-analysis");
/** Experiment: override every mastery track's attack foundation (bp per rank). */
const FOUNDATION = arg("foundation", "");
const MASTERY_ONLY = process.argv.includes("--mastery-only");
/** Level for the mastery and gear rows (default: expected level − 1). */
const ROW_LEVEL = arg("level", "");

const snapshot = JSON.parse(JSON.stringify(CONTENT)) as typeof CONTENT;
if (FOUNDATION) for (const t of snapshot.masteryTracks) (t as { foundationAttackBpPerRank: number }).foundationAttackBpPerRank = Number(FOUNDATION);
const content = new ContentIndex(snapshot);

const STARTER = ["wayfarer_blade", "linen_hood", "trail_tunic", "worn_grips", "road_boots", "copper_band"];

interface Row {
  label: string;
  clear: number;
  failStageMedian: number;
  bossFailShare: number;
  bossHpLeftMedian: number;
  bossHpLeftP25: number;
  bossHpLeftP75: number;
  enterBossHpMedian: number;
  bossFromFullWin: number;
  bossFromFullHpLeft: number;
}

function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))]! : NaN;
}

function measure(zoneId: string, classId: string, build: ExpectedBuild, label: string): Row {
  const zone = content.zone(zoneId);
  const last = zone.stages.length - 1;
  let clears = 0;
  const failStages: number[] = [];
  const bossHpLeft: number[] = [];
  const enterBoss: number[] = [];
  for (let r = 0; r < RUNS; r += 1) {
    const p = profileFor(content, classId, build, 1000 + r * 104_729);
    p.masterSeed = 1000 + r * 104_729;
    applyCommand(p, content, { type: "startPush", zoneId }, { contentTimeMs: 0 });
    let result: "cleared" | "failed" | null = null;
    let entered: number | null = null;
    const cache = new FightCache(2);
    const onEvent = (e: AdventureEvent) => {
      if (e.type !== "runEnded" || result !== null) return;
      result = e.result.kind === "cleared" ? "cleared" : "failed";
      if (result === "failed") {
        failStages.push(e.result.stage);
        if (e.result.stage === zone.stages.length) bossHpLeft.push(e.result.enemyHp100 / e.result.enemyMaxHp100);
      }
    };
    for (let t = 0; t < 400 && result === null; t += 1) {
      advanceAdventure(p, content, 5_000, { offline: false, contentTimeMs: 0, cache, onEvent });
      const run = p.adventure.run;
      if (entered === null && run && run.stageIndex === last && result === null) {
        entered = run.hp100;
      }
    }
    if (result === "cleared") clears += 1;
    if (entered !== null) {
      const maxHp = heroMax(p);
      enterBoss.push(Math.min(1, entered / maxHp));
    }
  }
  const bossFull: { win: number; left: number[] } = { win: 0, left: [] };
  for (let s = 1; s <= RUNS; s += 1) {
    const f = probeFight(content, classId, build, zoneId, last, s * 7_919);
    if (f.outcome === "victory") bossFull.win += 1;
    else {
      const alive = f.enemies.filter((e) => e.alive);
      bossFull.left.push(alive.reduce((a, e) => a + e.hp100, 0) / f.enemies.reduce((a, e) => a + e.maxHp100, 0));
    }
  }
  return {
    label,
    clear: clears / RUNS,
    failStageMedian: median(failStages),
    bossFailShare: failStages.length ? bossHpLeft.length / failStages.length : NaN,
    bossHpLeftMedian: median(bossHpLeft),
    bossHpLeftP25: quantile(bossHpLeft, 0.25),
    bossHpLeftP75: quantile(bossHpLeft, 0.75),
    enterBossHpMedian: median(enterBoss),
    bossFromFullWin: bossFull.win / RUNS,
    bossFromFullHpLeft: median(bossFull.left),
  };
}

function heroMax(p: Parameters<typeof heroStatsFor>[0]): number {
  return heroStatsFor(p, content).maxHp100;
}

const pct = (x: number) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : "—");
const lines: string[] = [];
const out = (s = "") => lines.push(s);
out("# C1 wall analysis");
out("");
out(`Content \`${CONTENT.contentVersion}\` · hash \`${content.hash.slice(0, 12)}\`${FOUNDATION ? ` · **experiment: mastery foundation ${FOUNDATION} bp/rank**` : ""} · ${RUNS} Push runs and ${RUNS} single Boss fights per row`);
out("");
out("\"Boss HP left\" = enemy HP left when a run fails at the Boss (P25–median–P75). \"Enter Boss\" = hero HP entering the Boss stage (HP carries over from stage 1).");
out("\"Boss from full HP\" = the same Boss fight started at full HP (no carry-over).");

for (const zoneId of ZONES) {
  const b = ZONE_BUILDS[zoneId]!;
  const zone = content.zone(zoneId);
  for (const classId of CLASSES) {
    out("");
    out(`## ${zone.name} · ${classId} (expected build L${b.level} M${b.mastery})`);
    out("");
    out("| Change | Push clear | Median fail stage | Fails at Boss | Boss HP left (P25 · median · P75) | Enter Boss HP | Boss from full HP: win · HP left |");
    out("|---|---|---|---|---|---|---|");
    const rows: Row[] = [];
    if (!MASTERY_ONLY) for (let l = b.level - 2; l <= b.level + 1; l += 1) rows.push(measure(zoneId, classId, { ...b, level: l }, `Level ${l} (M${b.mastery})`));
    const rowLevel = ROW_LEVEL ? Number(ROW_LEVEL) : b.level - 1;
    for (let m = Math.max(1, b.mastery - 4); m <= b.mastery + 3; m += 1) {
      if (m === b.mastery && !MASTERY_ONLY) continue;
      rows.push(measure(zoneId, classId, { ...b, level: rowLevel, mastery: m }, `L${rowLevel}, mastery M${m}`));
    }
    if (zoneId !== "greenfields" && !MASTERY_ONLY) {
      // Gear: n pieces of the expected set, the rest starter gear (slot order), at L-1.
      for (let n = 0; n <= 6; n += 2) {
        const gear = b.gear.map((g, i) => (i < n ? g : STARTER[i]!));
        rows.push(measure(zoneId, classId, { ...b, level: b.level - 1, gear }, `L${b.level - 1} M${b.mastery}, ${n}/6 expected gear`));
      }
    }
    for (const r of rows) {
      out(
        `| ${r.label} | ${pct(r.clear)} | ${Number.isFinite(r.failStageMedian) ? r.failStageMedian : "—"} | ${pct(r.bossFailShare)} | ` +
          `${pct(r.bossHpLeftP25)} · ${pct(r.bossHpLeftMedian)} · ${pct(r.bossHpLeftP75)} | ${pct(r.enterBossHpMedian)} | ${pct(r.bossFromFullWin)} · ${pct(r.bossFromFullHpLeft)} |`,
      );
    }
  }
}

mkdirSync("tools/sim/out", { recursive: true });
writeFileSync(`tools/sim/out/${OUT}.md`, lines.join("\n") + "\n");
console.log(lines.join("\n"));
