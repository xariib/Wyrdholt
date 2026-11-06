// Small paired natural-acquisition probe using the existing model-player policy.
// node --import tsx tools/item-effects/pacing.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { CONTENT } from "@emberbound/game-content";
import { ContentIndex } from "@emberbound/game-core";
import { runModelPlayer } from "../sim/model-player.ts";
const before = new ContentIndex(JSON.parse(readFileSync(new URL("../../packages/game-core/test/fixtures/c2-content.json", import.meta.url))));
const after = new ContentIndex(CONTENT), rows = [];
for (const cls of ["monk", "mage", "warrior", "ranger"]) for (const schedule of ["once", "twice", "model"]) {
  for (const seed of [1000, 8919]) {
    const options = { classId: cls, alternateClassId: cls === "monk" ? "mage" : "monk", seed, days: 9, schedule };
    const compact = r => ({ clears: r.clears, final: r.final, firstSession: r.firstSession });
    rows.push({ cls, schedule, seed, before: compact(runModelPlayer(before, options)), after: compact(runModelPlayer(after, options)) });
    console.log(`${cls}/${schedule}/${seed}: ${rows.at(-1).before.clears.map(c => `${c.zoneId}:${c.day}`).join(" ")} → ${rows.at(-1).after.clears.map(c => `${c.zoneId}:${c.day}`).join(" ")}`);
  }
}
writeFileSync(process.argv[2] ?? "docs/project/tasks/evidence/ITEM-EFFECTS-006/pacing.json", JSON.stringify({
  scope: "24 paired nine-day model players, natural drops and existing gear heuristic, no DEV grants/Forge. Limited two-seed probe, not the full calibration or human acceptance.",
  beforeContentVersion: before.snapshot.contentVersion, afterContentVersion: after.snapshot.contentVersion, rows,
}, null, 2) + "\n");
