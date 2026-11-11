import { mkdirSync, writeFileSync } from "node:fs";
import { CONTENT } from "@emberbound/game-content";
import { ContentIndex, advanceGame, createInstance, createProfile, discoverHunts, prepareHuntFight, startHunt } from "@emberbound/game-core";
import type { HuntRoute } from "@emberbound/shared-types";
import { ZONE_BUILDS } from "./expected-builds";

const content = new ContentIndex(CONTENT);
const rows = [];
for (const hunt of CONTENT.hunts!.definitions) for (const classId of ["monk", "mage", "warrior", "ranger"]) {
  for (const route of ["direct", "raid", "weakness"] as HuntRoute[]) {
    let wins = 0, seconds = 0, encounters = 0;
    for (let seed = 1; seed <= 48; seed++) {
      const p = createProfile(content, { name: "Hunt tuning", masterSeed: seed, activeClassId: classId, alternateClassId: classId === "mage" ? "monk" : "mage", nowWallMs: 0 });
      const build = ZONE_BUILDS[hunt.zoneId]!;
      p.character.level = build.level; p.character.xp = content.levelTotals[build.level - 1]!;
      p.character.masteryXp[classId] = content.masteryTotals(content.classDef(classId).masteryTrackId)[build.mastery - 1]!;
      for (const id of build.gear) p.equipment[content.item(id).slot] = createInstance(p, id, { isNew: false }).id;
      Object.assign(p.adventure.zones[hunt.zoneId]!, { cleared: true, unlocked: true, bestStage: 10, completions: 1 });
      discoverHunts(p, content, hunt.zoneId, 1);
      let error = startHunt(p, content, 1, "weapon");
      while (!error && p.hunts!.active) {
        const fight = prepareHuntFight(content, p.hunts!.active!, false)!;
        seconds += fight.summary.durationMs / 1000; encounters++;
        advanceGame(p, content, fight.summary.durationMs, { offline: true, contentTimeMs: 0 });
        if (p.hunts!.lastResult!.outcome !== "victory") break;
        if (!p.hunts!.queue.length) { wins++; break; }
        error = startHunt(p, content, 1, undefined, p.hunts!.queue[0]!.route === null ? route : undefined);
      }
      if (error) throw new Error(error);
    }
    rows.push({ hunt: hunt.id, classId, route, wins, attempts: 48, meanEncounterSeconds: Math.round(seconds / encounters) });
  }
}
mkdirSync("tools/sim/out", { recursive: true });
writeFileSync("tools/sim/out/hunts-entry.json", JSON.stringify(rows, null, 2));
console.table(rows);
