/**
 * Offline catch-up benchmark (Node / Bun). The same code runs in the app's
 * "Simulate 8-hour offline return" developer action.
 *
 *   npm run bench:offline            # 8h, level-3 Mage pushing (fallback path)
 *   npx tsx tools/bench-offline.ts 8 monk 12
 */
import { CONTENT } from "@emberbound/game-content";
import { ContentIndex, applyCommand, createProfile, serializeSave, simulateOffline } from "@emberbound/game-core";

const hours = Number(process.argv[2] ?? 8);
const cls = process.argv[3] ?? "mage";
const level = Number(process.argv[4] ?? 3);
const runs = Number(process.argv[5] ?? 5);

const content = new ContentIndex(CONTENT);
const times: number[] = [];
for (let i = 0; i < runs; i += 1) {
  const p = createProfile(content, {
    name: "Bench",
    activeClassId: cls,
    alternateClassId: cls === "mage" ? "monk" : "mage",
    masterSeed: 4242 + i,
    nowWallMs: 0,
  });
  p.character.xp = content.levelTotals[level - 1] ?? 0;
  p.character.level = level;
  applyCommand(p, content, { type: "startPush", zoneId: "greenfields" }, { contentTimeMs: 0 });
  const t0 = performance.now();
  const summary = simulateOffline(p, content, hours * 3_600_000, 0);
  const ms = performance.now() - t0;
  times.push(ms);
  const save = serializeSave(p, 0);
  console.log(
    `run ${i}: ${ms.toFixed(1)} ms | fights ${summary.fights} | push ${summary.push.status} | items ${summary.itemsFound} | level ${summary.levelBefore}->${summary.levelAfter} | save ${(save.length / 1024).toFixed(1)} KB`,
  );
}
times.sort((a, b) => a - b);
console.log(`median ${times[Math.floor(times.length / 2)]!.toFixed(1)} ms over ${runs} runs (${hours}h, ${cls}, start level ${level})`);
