/**
 * Dev probe: fresh-account route through Greenfields for each class.
 * Strategy: Push; after a defeat, farm the trail for `farmMs`, then Push again.
 * Prints time to first clear. Used to sanity-check PROVISIONAL content values.
 */
import { CONTENT } from "@emberbound/game-content";
import { ContentIndex, applyCommand, createProfile, SELF_TEST_CASES } from "@emberbound/game-core";

const content = new ContentIndex(CONTENT);
const farmMs = Number(process.argv[2] ?? 90_000);

for (const c of SELF_TEST_CASES.filter((x) => x.id.startsWith("fight-"))) {
  const out = c.run(content);
  console.log(c.id.padEnd(34), out.detail);
}

for (const [active, alt] of [["monk", "mage"], ["mage", "monk"]] as const) {
  for (const seed of [1, 2, 3, 4]) {
    const p = createProfile(content, { name: "Probe", activeClassId: active, alternateClassId: alt, masterSeed: seed * 7919, nowWallMs: 0 });
    applyCommand(p, content, { type: "startPush", zoneId: "greenfields" }, { contentTimeMs: 0 });
    let t = 0;
    let pushes = 1;
    let farming = false;
    let farmLeft = 0;
    const best: number[] = [];
    while (t < 60 * 60_000) {
      const step = 1_000;
      applyCommand(p, content, { type: "advance", ms: step }, { contentTimeMs: 0 });
      t += step;
      const zp = p.adventure.zones["greenfields"]!;
      if (zp.cleared) break;
      if (farming) {
        farmLeft -= step;
        if (farmLeft <= 0) {
          farming = false;
          pushes += 1;
          applyCommand(p, content, { type: "startPush", zoneId: "greenfields" }, { contentTimeMs: 0 });
        }
      } else if (p.adventure.activity === "idle") {
        best.push(p.adventure.lastResult?.stage ?? 0);
        farming = true;
        farmLeft = farmMs;
        applyCommand(p, content, { type: "startFarm", zoneId: "greenfields" }, { contentTimeMs: 0 });
      }
    }
    const zp = p.adventure.zones["greenfields"]!;
    console.log(
      `${active} seed${seed}: cleared=${zp.cleared} at ${(t / 60000).toFixed(1)}min, pushes=${pushes}, level=${p.character.level}, M${p.character.masteryXp[active]}, fails@${best.join(",")}, items=${p.inventory.instances.length}`,
    );
  }
}
