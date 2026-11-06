/**
 * Multi-target mechanic report (C2 preparation, tools only).
 *
 * Runs real Warrior/Ranger builds against 1-, 2- and 3-enemy stages with the shipped
 * budgets and checks, from the event stream, the multi-target rules:
 *   - no hero hit ever lands on a dead enemy
 *   - Split Arrow never hits the attack's own target, and never a dead enemy
 *   - class DoT stacks stay per target and within the cap
 *   - Retaliation strikes at most once per enemy attack
 *   - every fight replays to the same hash
 *
 *   bun tools/sim/multi-target-report.ts [--seeds=20] [--out=tools/sim/out/c2-multi-target]
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { CONTENT } from "@emberbound/game-content";
import { ContentIndex, canonicalJson, resolveClassMechanics, sha256Hex, type ExecutedFight } from "@emberbound/game-core";
import { ZONE_BUILDS, type ExpectedBuild } from "./expected-builds";
import { probeFightDetailed } from "./probe";

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k!, v ?? "true"] as const;
  }),
);
const SEEDS = Number(args.get("seeds") ?? 20);
const OUT = args.get("out") ?? "tools/sim/out/c2-multi-target";

const content = new ContentIndex(CONTENT);
const CLASSES = ["warrior", "ranger"] as const;
const RANKS = [1, 5, 10, 15, 20];
const LEVEL = 16;
const STAGES: { zone: string; stage: number; label: string }[] = [
  { zone: "darkwood", stage: 1, label: "Darkwood s2 (normal, 1 enemy)" },
  { zone: "darkwood", stage: 2, label: "Darkwood s3 (normal, 2 enemies)" },
  { zone: "darkwood", stage: 3, label: "Darkwood s4 (normal, 3 enemies)" },
  { zone: "darkwood", stage: 4, label: "Darkwood s5 (elite, 1 enemy)" },
  { zone: "darkwood", stage: 9, label: "Darkwood s10 (boss, 3 enemies)" },
  { zone: "ashen_mountains", stage: 9, label: "Ashen s10 (boss, 1 enemy)" },
];

interface Row {
  cls: string;
  rank: number;
  label: string;
  enemies: number;
  fights: number;
  wins: number;
  heroAttacks: number;
  hitsOnDead: number;
  splitHits: number;
  splitOnOwnTarget: number;
  splitFights: number;
  classDotTargets: number;
  classDotMaxStacks: number;
  classDotCap: number;
  itemDotLines: number;
  executeProcs: number;
  retaliations: number;
  maxRetaliationPerEnemyAttack: number;
  bursts: number;
  replayMismatches: number;
}

function hashOf(f: ExecutedFight): string {
  return sha256Hex(canonicalJson({ events: f.events, final: f.summary }));
}

function analyse(row: Row, f: ExecutedFight, classDot: string | null): void {
  const events = f.events ?? [];
  const dead = new Set<string>();
  const dotTargets = new Set<string>();
  let lastHeroTarget = "";
  let retaliationsSinceEnemyAttack = 0;
  let splitThisFight = false;
  for (const e of events) {
    if (e.type === "attack" && e.src === "hero") {
      row.heroAttacks += 1;
      lastHeroTarget = String(e.tgt);
    }
    if (e.type === "attack" && e.src !== "hero") retaliationsSinceEnemyAttack = 0;
    if (e.type === "hit" && e.src === "hero") {
      const tgt = String(e.tgt);
      if (dead.has(tgt)) row.hitsOnDead += 1;
      if (e.via === "split_arrow") {
        row.splitHits += 1;
        splitThisFight = true;
        if (tgt === lastHeroTarget) row.splitOnOwnTarget += 1;
      }
      if (e.via === "retaliation") {
        row.retaliations += 1;
        retaliationsSinceEnemyAttack += 1;
        row.maxRetaliationPerEnemyAttack = Math.max(row.maxRetaliationPerEnemyAttack, retaliationsSinceEnemyAttack);
      }
      if (e.via === "venom_burst") row.bursts += 1;
    }
    if (e.type === "status" && e.tgt !== "hero") {
      const status = String(e.status);
      if (status === classDot) {
        dotTargets.add(String(e.tgt));
        row.classDotMaxStacks = Math.max(row.classDotMaxStacks, Number(e.stacks));
      } else if (status.includes(":")) {
        row.itemDotLines += 1;
      }
    }
    if (e.type === "death") dead.add(String(e.actor));
  }
  row.classDotTargets += dotTargets.size;
  if (splitThisFight) row.splitFights += 1;
  row.executeProcs += f.summary.counters.procs.execute ?? 0;
}

const rows: Row[] = [];
for (const cls of CLASSES) {
  for (const rank of RANKS) {
    const kit = resolveClassMechanics(content, cls, rank);
    const dot = kit.find((m) => m.kind === "on_hit_dot");
    const classDot = dot && dot.kind === "on_hit_dot" ? dot.statusId : null;
    const cap = dot && dot.kind === "on_hit_dot" ? dot.maxStacks : 0;
    const build: ExpectedBuild = { ...ZONE_BUILDS.darkwood!, level: LEVEL, mastery: rank };
    for (const s of STAGES) {
      const enemies = content.zone(s.zone).stages[s.stage]!.enemies.length;
      const row: Row = {
        cls, rank, label: s.label, enemies, fights: 0, wins: 0, heroAttacks: 0, hitsOnDead: 0,
        splitHits: 0, splitOnOwnTarget: 0, splitFights: 0, classDotTargets: 0, classDotMaxStacks: 0,
        classDotCap: cap, itemDotLines: 0, executeProcs: 0, retaliations: 0, maxRetaliationPerEnemyAttack: 0,
        bursts: 0, replayMismatches: 0,
      };
      for (let seed = 1; seed <= SEEDS; seed += 1) {
        const a = probeFightDetailed(content, cls, build, s.zone, s.stage, seed * 104_729);
        const b = probeFightDetailed(content, cls, build, s.zone, s.stage, seed * 104_729);
        if (hashOf(a) !== hashOf(b)) row.replayMismatches += 1;
        row.fights += 1;
        if (a.summary.outcome === "victory") row.wins += 1;
        analyse(row, a, classDot);
      }
      rows.push(row);
    }
  }
}

const per = (x: number, n: number) => (n > 0 ? (x / n).toFixed(1) : "0");
const lines: string[] = [];
lines.push("# Multi-target mechanic report");
lines.push("");
lines.push(
  `Content \`${content.snapshot.contentVersion}\` · hash \`${content.hash.slice(0, 12)}\` · shipped budgets, enemy damage on · ` +
    `Darkwood expected gear (Greenfields Rare set) at level ${LEVEL} · ${SEEDS} seeds per row, each run twice`,
);
lines.push("");
lines.push("Invariant columns must be 0 (Split on own target, hits on dead, replay mismatches) or ≤ 1 (max retaliations per enemy attack).");
for (const cls of CLASSES) {
  lines.push("");
  lines.push(`## ${cls}`);
  lines.push("");
  lines.push(
    "| Rank | Stage | Wins | Attacks/fight | Split hits/fight | Split on own target | Hits on dead | Class DoT targets/fight | Max class stacks (cap) | Item DoT on a class-owned status (`status:item`) per fight | Execute procs/fight | Retaliations/fight | Max retaliations per enemy attack | Venom Bursts/fight | Replay mismatches |",
  );
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of rows.filter((x) => x.cls === cls)) {
    lines.push(
      `| M${r.rank} | ${r.label} | ${r.wins}/${r.fights} | ${per(r.heroAttacks, r.fights)} | ${per(r.splitHits, r.fights)} | ${r.splitOnOwnTarget} | ${r.hitsOnDead} | ` +
        `${per(r.classDotTargets, r.fights)} | ${r.classDotMaxStacks} (${r.classDotCap}) | ${per(r.itemDotLines, r.fights)} | ${per(r.executeProcs, r.fights)} | ` +
        `${per(r.retaliations, r.fights)} | ${r.maxRetaliationPerEnemyAttack} | ${per(r.bursts, r.fights)} | ${r.replayMismatches} |`,
    );
  }
}
const violations = rows.filter(
  (r) => r.splitOnOwnTarget > 0 || r.hitsOnDead > 0 || r.replayMismatches > 0 || r.maxRetaliationPerEnemyAttack > 1 || r.classDotMaxStacks > r.classDotCap,
);
lines.push("");
lines.push(`**Invariant violations: ${violations.length}**`);
lines.push("");

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(`${OUT}.md`, lines.join("\n"));
writeFileSync(`${OUT}.json`, JSON.stringify({ contentHash: content.hash, seeds: SEEDS, level: LEVEL, rows }, null, 2));
console.log(lines.join("\n"));
if (violations.length > 0) process.exitCode = 1;
