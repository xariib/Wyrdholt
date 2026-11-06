// Controlled same-stats/seeds before/after study, not a natural-pacing playtest.
// node --import tsx tools/item-effects/report.mjs [output.json]
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CONTENT } from "@emberbound/game-content";
import { ContentIndex, createProfile, createInstance, startRun, prepareFight, canonicalJson } from "@emberbound/game-core";

const beforeSnapshot = JSON.parse(readFileSync(new URL("../../packages/game-core/test/fixtures/c2-content.json", import.meta.url)));
const before = new ContentIndex(beforeSnapshot), after = new ContentIndex(CONTENT);
const classes = ["monk", "mage", "warrior", "ranger"];
const seeds = Array.from({ length: 32 }, (_, n) => 6006 + n);
const scenarios = [
  { zone: "darkwood", level: 10, rank: 7, rarity: "epic" },
  { zone: "ashen_mountains", level: 18, rank: 14, rarity: "epic" },
  { zone: "ashen_mountains", level: 18, rank: 14, rarity: "legendary" },
];
function sample(content, cls, s, seed) {
  const p = createProfile(content, { name: "Controlled", activeClassId: cls, alternateClassId: cls === "monk" ? "mage" : "monk", masterSeed: seed, nowWallMs: 0 });
  p.character.level = s.level; p.character.xp = content.levelTotals[s.level - 1];
  p.character.masteryXp[cls] = content.masteryTotals(content.classDef(cls).masteryTrackId)[s.rank - 1];
  for (const item of content.snapshot.items.filter(i => i.rarity === s.rarity)) {
    p.equipment[item.slot] = createInstance(p, item.id, { isNew: false }).id;
  }
  startRun(p, content, s.zone, "push", 0); p.adventure.run.stageIndex = 9;
  return prepareFight(p, content, p.adventure.run, { contentTimeMs: 0, recordEvents: false }).summary;
}
function aggregate(results) {
  const mean = values => Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  return {
    wins: results.filter(s => s.outcome === "victory").length, runs: results.length,
    meanDurationMs: mean(results.map(s => s.durationMs)),
    meanHeroHpBp: mean(results.map(s => s.hero.hp100 * 10000 / s.hero.maxHp100)),
    meanDamageDealt100: mean(results.map(s => s.counters.damageDealt100)),
    meanDamageTaken100: mean(results.map(s => s.counters.damageTaken100)),
    meanHealing100: mean(results.map(s => s.counters.healing100)),
    meanAbsorbed100: mean(results.map(s => s.counters.absorbed100 ?? 0)),
  };
}
const rows = [];
for (const s of scenarios) for (const cls of classes) {
  const a = seeds.map(seed => sample(before, cls, s, seed)), b = seeds.map(seed => sample(after, cls, s, seed));
  rows.push({ cls, ...s, before: aggregate(a), after: aggregate(b) });
}
const added = CONTENT.items.filter(i => i.effect && !before.item(i.id).effect);
const individual = [];
for (const item of added) {
  const isolated = new ContentIndex({ ...beforeSnapshot, items: beforeSnapshot.items.map(i => i.id === item.id ? item : i) });
  for (const cls of classes) {
    const s = { zone: "ashen_mountains", level: 18, rank: 14, rarity: item.rarity };
    individual.push({ item: item.id, cls, ...s,
      before: aggregate(seeds.map(seed => sample(before, cls, s, seed))),
      after: aggregate(seeds.map(seed => sample(isolated, cls, s, seed))),
    });
  }
}
// Below Epic, the content header changes but every authoritative fight fact stays.
for (const cls of classes) for (const seed of seeds) {
  const s = { zone: "darkwood", level: 10, rank: 7, rarity: "rare" };
  assert.equal(canonicalJson(sample(before, cls, s, seed)), canonicalJson(sample(after, cls, s, seed)));
}
const report = { beforeContentVersion: before.snapshot.contentVersion, beforeContentHash: before.hash,
  afterContentVersion: after.snapshot.contentVersion, afterContentHash: after.hash, seeds,
  scope: "Controlled full-HP boss fights with identical class/level/mastery/item stats and seed; full sets granted explicitly. Not natural acquisition/pacing or human economy acceptance.",
  classZoneLootForgeTuningChanged: false, unchangedRareComparisons: classes.length * seeds.length,
  pairedFullSetFights: rows.length * seeds.length, pairedSingleEffectFights: individual.length * seeds.length,
  rows, individual };
writeFileSync(resolve(process.argv[2] ?? "docs/project/tasks/evidence/ITEM-EFFECTS-006/balance.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ before: report.beforeContentVersion, after: report.afterContentVersion, rows, unchangedRareComparisons: report.unchangedRareComparisons }));
