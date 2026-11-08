/**
 * Emberbound replay tool (spike). Proves that the same game-core can validate
 * fights on a Node server.
 *
 *   npm run replay -- --demo                     replay a demo fight and print it
 *   npm run replay -- record.json [--events]     replay a saved FightRecord
 *   npm run replay -- record.json --expect=<hash>  exit 1 if the hash differs
 *   npm run replay -- --export=dir               write demo records to a folder
 *
 * A FightRecord can be copied from the app's debug panel ("Copy fight record").
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONTENT } from "@emberbound/game-content";
import {
  ContentIndex,
  RULES_VERSION,
  applyCommand,
  createProfile,
  prepareFight,
  replayFight,
  type ReplayResult,
} from "@emberbound/game-core";
import type { CombatRecord, FightRecord } from "@emberbound/shared-types";

const content = new ContentIndex(CONTENT);
const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : "true";
};

function demoRecords(): FightRecord[] {
  const records: FightRecord[] = [];
  for (const [cls, alt, seed] of [["monk", "mage", 11], ["mage", "monk", 12]] as const) {
    const p = createProfile(content, { name: "Replay", activeClassId: cls, alternateClassId: alt, masterSeed: seed, nowWallMs: 0 });
    applyCommand(p, content, { type: "startPush", zoneId: "greenfields" }, { contentTimeMs: 0 });
    applyCommand(p, content, { type: "advance", ms: 20_000 }, { contentTimeMs: 0 });
    if (p.adventure.run) {
      records.push(prepareFight(p, content, p.adventure.run, { contentTimeMs: 0, recordEvents: false }).record);
    }
  }
  return records;
}

function hp(v: number | string | undefined): string {
  return typeof v === "number" ? (v / 100).toFixed(2) : String(v ?? "");
}

function print(result: ReplayResult<CombatRecord>, showEvents: boolean): void {
  const s = result.summary;
  const r = result.record;
  console.log(`rules     ${r.rulesVersion} (core ${RULES_VERSION})`);
  console.log(`content   ${r.contentVersion} ${r.contentHash.slice(0, 16)}…`);
  console.log(`seed      ${r.seed}`);
  console.log(`build     ${r.build.classId} L${r.build.characterLevel} masteryXp ${r.build.masteryXp} items ${r.itemInstances.map((i) => `${i.id}:${i.baseId}`).join(", ")}`);
  const encounter = r.format === "emberbound-boss-fight-record/1"
    ? `${r.encounter.bossId} tier ${r.encounter.tier}`
    : `${r.encounter.zoneId} stage ${r.encounter.stageIndex + 1}`;
  console.log(`encounter ${encounter}  startHp ${r.startHp100 === null ? "full" : hp(r.startHp100)}  rules [${r.activeRuleIds.join(", ")}]`);
  console.log(`outcome   ${s.outcome} at ${s.durationMs} ms   hero ${hp(s.hero.hp100)}/${hp(s.hero.maxHp100)}   events ${result.events.length}   rng draws ${s.rngDraws}`);
  console.log(`damage    dealt ${hp(s.counters.damageDealt100)} (basic ${hp(s.counters.damageBasic100)}, class ${hp(s.counters.damageClass100)}, item ${hp(s.counters.damageItem100)}; dot ${hp(s.counters.damageDot100)})  taken ${hp(s.counters.damageTaken100)}  healed ${hp(s.counters.healing100)}`);
  console.log(`procs     ${JSON.stringify(s.counters.procs)}`);
  console.log(`hash      ${result.hash}`);
  if (showEvents) {
    console.log("\n    t(ms)  event");
    for (const e of result.events) {
      const { t, type, ...rest } = e;
      const parts = Object.entries(rest).map(([k, v]) => `${k}=${k === "hp" || k === "amt" || k === "eff" || k === "max" ? hp(v) : v}`);
      console.log(`${String(t).padStart(9)}  ${type.padEnd(10)} ${parts.join(" ")}`);
    }
  }
}

const exportDir = flag("export");
if (exportDir) {
  mkdirSync(exportDir, { recursive: true });
  for (const [i, record] of demoRecords().entries()) {
    const file = join(exportDir, `fight-${i + 1}.json`);
    writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
    console.log(`wrote ${file}  hash ${replayFight(content, record).hash}`);
  }
  process.exit(0);
}

const file = args.find((a) => !a.startsWith("--"));
const records: CombatRecord[] = file ? [JSON.parse(readFileSync(file, "utf8")) as CombatRecord] : flag("demo") ? demoRecords() : [];
if (records.length === 0) {
  console.log("Usage: npm run replay -- --demo | <record.json> [--events] [--expect=<hash>] | --export=<dir>");
  process.exit(2);
}
let exit = 0;
for (const record of records) {
  const result = replayFight(content, record);
  print(result, flag("events") !== undefined || flag("demo") !== undefined);
  const expected = flag("expect");
  if (expected && expected !== result.hash) {
    console.error(`MISMATCH: expected ${expected}`);
    exit = 1;
  } else if (expected) {
    console.log("VALID: hash matches the submitted result");
  }
  console.log("");
}
process.exit(exit);
