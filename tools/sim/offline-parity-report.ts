/**
 * Foreground vs offline settlement, as numbers (C1 playtest investigation, 21 Sep 2026).
 * The same checks as packages/game-core/test/offline-parity.test.ts, printed as a table.
 *
 *   bun tools/sim/offline-parity-report.ts [--out=c1-offline-parity]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import type { SlotId } from "@emberbound/shared-types";
import { CONTENT } from "@emberbound/game-content";
import {
  ContentIndex,
  FightCache,
  advanceAdventure,
  applyCommand,
  cloneProfile,
  createProfile,
  simulateOffline,
  startRun,
  type Profile,
} from "@emberbound/game-core";

const OUT = process.argv.find((a) => a.startsWith("--out="))?.slice(6) ?? "c1-offline-parity";
const content = new ContentIndex(CONTENT);
const HOUR = 3_600_000;
const GREEN = ["wayfarer_blade", "linen_hood", "trail_tunic", "worn_grips", "road_boots", "copper_band"];
const RARE = ["bloodletter", "seers_circlet", "ironbark_mantle", "flowing_wraps", "huntsmans_stride", "ember_seal"];
const EPIC = ["stormcaller", "crown_of_thorns", "cinderweave", "venom_grips", "pilgrims_pace", "moonlit_loop"];

function hero(seed: number, cls: string, alt: string, level: number, mastery: number, gear: string[], cleared: string[]): Profile {
  const p = createProfile(content, { name: "Tester", activeClassId: cls, alternateClassId: alt, masterSeed: seed, nowWallMs: 0 });
  p.character.xp = content.levelTotals[level - 1]!;
  p.character.level = level;
  p.character.masteryXp[cls] = content.masteryTotals(content.classDef(cls).masteryTrackId)[mastery - 1]!;
  applyCommand(p, content, { type: "devGrant", baseIds: gear }, { contentTimeMs: 0 });
  for (const inst of p.inventory.instances) {
    if (gear.includes(inst.baseId)) applyCommand(p, content, { type: "equip", slot: content.item(inst.baseId).slot as SlotId, instanceId: inst.id }, { contentTimeMs: 0 });
  }
  for (const id of cleared) {
    p.adventure.zones[id] = { unlocked: true, cleared: true, bestStage: 10, completions: 1, checkpoint: null };
    for (const next of content.zone(id).unlocks) p.adventure.zones[next] = { unlocked: true, cleared: false, bestStage: 0, completions: 0, checkpoint: null };
  }
  return p;
}

function foreground(p: Profile, ms: number, step = 250): void {
  const cache = new FightCache(4);
  for (let left = ms; left > 0; left -= step) {
    advanceAdventure(p, content, Math.min(step, left), { offline: false, contentTimeMs: 0, recordEvents: true, cache });
  }
}

const pairs: [string, string][] = [];
const values = (base: Profile, p: Profile) => row("", base, p).split("|").slice(2).join("|");
const row = (label: string, base: Profile, p: Profile) => {
  const cls = base.character.activeClassId;
  const alt = base.character.alternateClassId;
  const completions = Object.values(p.adventure.zones).reduce((a, z) => a + z.completions, 0) - Object.values(base.adventure.zones).reduce((a, z) => a + z.completions, 0);
  return `| ${label} | ${p.character.xp - base.character.xp} | ${(p.character.masteryXp[cls] ?? 0) - (base.character.masteryXp[cls] ?? 0)} | ${(p.character.masteryXp[alt] ?? 0) - (base.character.masteryXp[alt] ?? 0)} | ${p.gold - base.gold} | ${p.inventory.instances.length - base.inventory.instances.length} | ${p.stats.fights - base.stats.fights} | ${completions} |`;
};

const lines: string[] = [];
const out = (s = "") => lines.push(s);
out("# Foreground vs offline settlement");
out("");
out(`Content \`${CONTENT.contentVersion}\` · hash \`${content.hash.slice(0, 12)}\``);
out("");
out("Foreground = the app's path (250 ms steps, event logs, fight cache). Offline = `simulateOffline` in one call. Same profile, same simulated time.");
out("");
out("| Case · path | Character XP | Active Mastery XP | Alternate Mastery XP | Gold | Items | Fights | Zone completions (caches) |");
out("|---|---|---|---|---|---|---|---|");
const cases: [string, Profile, string, number][] = [
  ["Monk L8 M4, starter gear, Farm Greenfields 2 h", hero(11, "monk", "mage", 8, 4, GREEN, ["greenfields"]), "greenfields", 2],
  ["Mage L10 M6, Rare set, Farm Greenfields 2 h", hero(12, "mage", "monk", 10, 6, RARE, ["greenfields"]), "greenfields", 2],
  ["Monk L14 M10, Rare set, Farm Darkwood 2 h", hero(13, "monk", "mage", 14, 10, RARE, ["greenfields", "darkwood"]), "darkwood", 2],
  ["Mage L22 M16, Epic set, Farm Ashen 1 h", hero(14, "mage", "monk", 22, 16, EPIC, ["greenfields", "darkwood", "ashen_mountains"]), "ashen_mountains", 1],
];
for (const [label, base, zone, hours] of cases) {
  applyCommand(base, content, { type: "startFarm", zoneId: zone }, { contentTimeMs: 0 });
  const off = cloneProfile(base);
  simulateOffline(off, content, hours * HOUR, 0);
  const fg = cloneProfile(base);
  foreground(fg, hours * HOUR);
  out(row(`${label} · foreground`, base, fg));
  out(row(`${label} · **offline**`, base, off));
  pairs.push([values(base, fg), values(base, off)]);
}
{
  const base = hero(21, "monk", "mage", 11, 7, RARE, ["greenfields"]);
  applyCommand(base, content, { type: "startPush", zoneId: "darkwood" }, { contentTimeMs: 0 });
  base.adventure.run!.stageIndex = 9;
  base.adventure.run!.hp100 = 100; // 1 HP entering the Boss: the Push fails
  const off = cloneProfile(base);
  const s = simulateOffline(off, content, 2 * HOUR, 0);
  const fg = cloneProfile(base);
  while (fg.adventure.activity !== "idle") advanceAdventure(fg, content, 1_000, { offline: false, contentTimeMs: 0 });
  fg.clock.simulatedMs = s.segments[0]!.ms;
  startRun(fg, content, "greenfields", "farm", content.snapshot.config.defeatRestMs);
  foreground(fg, 2 * HOUR - s.segments[0]!.ms);
  const label = "Monk L11 M7 fails the Darkwood Boss (1 HP left), then Farm Greenfields (2 h in total)";
  out(row(`${label} · foreground, Farm started by hand`, base, fg));
  out(row(`${label} · **offline fallback**`, base, off));
  pairs.push([values(base, fg), values(base, off)]);
}
{
  const base = hero(31, "monk", "mage", 10, 6, RARE, ["greenfields"]);
  base.character.masteryXp.mage = content.masteryTotals("mastery_mage")[2]!;
  applyCommand(base, content, { type: "startFarm", zoneId: "greenfields" }, { contentTimeMs: 0 });
  advanceAdventure(base, content, 3_000, { offline: false, contentTimeMs: 0 });
  applyCommand(base, content, { type: "setActiveClass", classId: "mage" }, { contentTimeMs: 0 });
  const off = cloneProfile(base);
  simulateOffline(off, content, HOUR, 0);
  const fg = cloneProfile(base);
  foreground(fg, HOUR);
  const label = "Switch Monk → Mage queued mid-fight, Farm Greenfields 1 h (Active column = Monk, Alternate = Mage)";
  out(row(`${label} · foreground`, base, fg));
  out(row(`${label} · **offline**`, base, off));
  pairs.push([values(base, fg), values(base, off)]);
}
out("");
const same = pairs.filter(([a, b]) => a === b).length;
out(`**${same} of ${pairs.length} pairs identical.**`);
out("");
out("The only policy difference is after a defeat: offline starts the safe Farm itself; the foreground used to wait for the player (fixed on c1-hotfix: the app now starts the same safe Farm).");

mkdirSync("tools/sim/out", { recursive: true });
writeFileSync(`tools/sim/out/${OUT}.md`, lines.join("\n") + "\n");
console.log(lines.join("\n"));
