/**
 * Mastery value study (C1 retune, 21 Sep 2026): how much of the M1→M20 gain comes from the
 * flat per-rank foundation, and how much from the class techniques unlocked at M1/M5/M10/M15/M20?
 *
 * Kill speed is measured with enemy damage off (normal stages, fixed seeds), as the ratio of
 * fight length at M1 to fight length at the rank. Configurations per class:
 *   flat only  — the rank's foundation, techniques frozen at M1
 *   techniques — every technique up to the rank, no foundation
 *   both       — the real kit at the rank
 * "Technique share" = ln(techniques) / (ln(techniques) + ln(flat)): the share of the
 * specialization gain (in log terms) that the mechanics provide.
 *
 *   bun tools/sim/mastery-study.ts [--candidates=120,200,250,300,350,400] [--out=c1-mastery-study]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import type { ContentSnapshot } from "@emberbound/shared-types";
import { CONTENT } from "@emberbound/game-content";
import { ContentIndex } from "@emberbound/game-core";
import { ZONE_BUILDS, type ExpectedBuild } from "./expected-builds";
import { probeFight, snapshotWith } from "./probe";

const arg = (name: string, fallback: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const CANDIDATES = arg("candidates", "120,200,250,300,350,400").split(",").map(Number);
const CLASSES = arg("classes", "monk,mage").split(",");
const OUT = arg("out", "c1-mastery-study");
const SEEDS = 5;

const CONTEXTS: { id: string; label: string; zoneId: string; build: ExpectedBuild }[] = [
  { id: "darkwood", label: "Darkwood (L10, Greenfields Rare set)", zoneId: "darkwood", build: { ...ZONE_BUILDS.darkwood!, level: 10 } },
  { id: "ashen", label: "Ashen Mountains (L19, Darkwood Epic set)", zoneId: "ashen_mountains", build: { ...ZONE_BUILDS.ashen_mountains!, level: 19 } },
];

function variant(foundationBp: number, freezeTechniques: boolean, zoneId: string): ContentIndex {
  const snap = JSON.parse(JSON.stringify(CONTENT)) as ContentSnapshot;
  for (const t of snap.masteryTracks) {
    (t as { foundationAttackBpPerRank: number }).foundationAttackBpPerRank = foundationBp;
    if (freezeTechniques) t.techniques = t.techniques.filter((x) => x.unlockRank <= 1);
  }
  // Enemy damage off in the measured zone: fight length is pure kill speed.
  const hp = snap.zones.find((z) => z.id === zoneId)!.stages.map((st) => st.hpBudget);
  return new ContentIndex(snapshotWith({ [zoneId]: { hp, dps: hp.map(() => 0) } }, snap));
}

function fightSeconds(content: ContentIndex, classId: string, build: ExpectedBuild, zoneId: string): number {
  const zone = content.zone(zoneId);
  let total = 0;
  let n = 0;
  zone.stages.forEach((stage, i) => {
    if (stage.role !== "normal") return;
    for (let s = 1; s <= SEEDS; s += 1) {
      total += probeFight(content, classId, build, zoneId, i, s * 7919).durationMs;
      n += 1;
    }
  });
  return total / n / 1000;
}

const lines: string[] = [];
const out = (s = "") => lines.push(s);
const x2 = (v: number) => `×${v.toFixed(2)}`;
const pct = (v: number) => `${Math.round(v * 100)}%`;
out("# Mastery value: flat foundation vs techniques");
out("");
out(`Content \`${CONTENT.contentVersion}\` · kill speed on normal stages with enemy damage off, ${SEEDS} seeds per stage · foundation = % of the class's base attack per rank above M1`);

for (const ctx of CONTEXTS) {
  out("");
  out(`## ${ctx.label}`);
  out("");
  out("| Foundation per rank | Class | Flat only M10 · M20 | Techniques only M10 · M20 | Both M10 · M20 | Technique share of the M20 gain |");
  out("|---|---|---|---|---|---|");
  for (const f of CANDIDATES) {
    const flatC = variant(f, true, ctx.zoneId);
    const techC = variant(0, false, ctx.zoneId);
    const bothC = variant(f, false, ctx.zoneId);
    for (const cls of CLASSES) {
      const at = (c: ContentIndex, rank: number) => fightSeconds(c, cls, { ...ctx.build, mastery: rank }, ctx.zoneId);
      const base = at(techC, 1);
      const gain = (c: ContentIndex, r: number) => base / at(c, r);
      const flat = [gain(flatC, 10), gain(flatC, 20)];
      const tech = [gain(techC, 10), gain(techC, 20)];
      const both = [gain(bothC, 10), gain(bothC, 20)];
      const share = Math.log(tech[1]!) / (Math.log(tech[1]!) + Math.log(flat[1]!));
      out(`| ${f / 100}% | ${cls} | ${x2(flat[0]!)} · ${x2(flat[1]!)} | ${x2(tech[0]!)} · ${x2(tech[1]!)} | ${x2(both[0]!)} · ${x2(both[1]!)} | ${pct(share)} |`);
    }
  }
}

mkdirSync("tools/sim/out", { recursive: true });
writeFileSync(`tools/sim/out/${OUT}.md`, lines.join("\n") + "\n");
console.log(lines.join("\n"));
