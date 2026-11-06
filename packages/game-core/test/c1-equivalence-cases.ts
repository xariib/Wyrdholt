import type { ContentSnapshot, SlotId } from "@emberbound/shared-types";
import {
  ContentIndex,
  applyCommand,
  canonicalJson,
  createProfile,
  encodeProfile,
  fightHash,
  heroStatsFor,
  prepareFight,
  sha256Hex,
  simulateOffline,
  type Profile,
} from "@emberbound/game-core";

/**
 * C1 equivalence cases (C2 branch guard). They run the frozen C1 content snapshot
 * (fixtures/c1-content.json) through the current engine. The expected hashes in
 * fixtures/c1-equivalence.json were captured with the C1 retune engine (tag
 * c1-retune-candidate-20260921.1244, rules 0.3.0, content 0.2.1-c1), so any engine
 * change that alters a C1 result fails.
 * Covers all three zones for Monk and Mage: an 8-hour offline Push/Farm and the Boss fight,
 * plus the approved C1 retune behavior: the 24-hour offline cap, the safe-Farm fallback
 * after a failed Push, and the fixed-point Mastery foundation (2.5% per rank).
 */
const BUILDS: Record<string, { level: number; mastery: number; gear: string[]; cleared: string[] }> = {
  greenfields: { level: 6, mastery: 3, gear: [], cleared: [] },
  darkwood: {
    level: 12,
    mastery: 9,
    gear: ["bloodletter", "seers_circlet", "ironbark_mantle", "flowing_wraps", "huntsmans_stride", "ember_seal"],
    cleared: ["greenfields"],
  },
  ashen_mountains: {
    level: 19,
    mastery: 14,
    gear: ["stormcaller", "crown_of_thorns", "cinderweave", "venom_grips", "pilgrims_pace", "moonlit_loop"],
    cleared: ["greenfields", "darkwood"],
  },
};

function profileAt(content: ContentIndex, classId: string, zoneId: string, seed: number): Profile {
  const b = BUILDS[zoneId]!;
  const p = createProfile(content, {
    name: "Equivalence",
    activeClassId: classId,
    alternateClassId: classId === "monk" ? "mage" : "monk",
    masterSeed: seed,
    nowWallMs: 0,
  });
  p.character.xp = content.levelTotals[b.level - 1]!;
  p.character.level = b.level;
  p.character.masteryXp[classId] = content.masteryTotals(content.classDef(classId).masteryTrackId)[b.mastery - 1]!;
  applyCommand(p, content, { type: "devGrant", baseIds: b.gear }, { contentTimeMs: 0 });
  for (const inst of p.inventory.instances) {
    if (!b.gear.includes(inst.baseId)) continue;
    applyCommand(p, content, { type: "equip", slot: content.item(inst.baseId).slot as SlotId, instanceId: inst.id }, { contentTimeMs: 0 });
  }
  for (const id of b.cleared) {
    p.adventure.zones[id] = { unlocked: true, cleared: true, bestStage: 10, completions: 1, checkpoint: null };
    for (const next of content.zone(id).unlocks) p.adventure.zones[next] = { ...p.adventure.zones[next]!, unlocked: true };
  }
  return p;
}

export interface EquivalenceCase {
  id: string;
  run(content: ContentIndex): string;
}

export const C1_EQUIVALENCE_CASES: EquivalenceCase[] = [];
for (const zoneId of Object.keys(BUILDS)) {
  for (const classId of ["monk", "mage"]) {
    C1_EQUIVALENCE_CASES.push({
      id: `offline-8h-${zoneId}-${classId}`,
      run(content) {
        const p = profileAt(content, classId, zoneId, 9_001);
        applyCommand(p, content, { type: "startPush", zoneId }, { contentTimeMs: 0 });
        const summary = simulateOffline(p, content, 8 * 3_600_000, 0);
        return sha256Hex(canonicalJson({ profile: encodeProfile(p), summary }));
      },
    });
    C1_EQUIVALENCE_CASES.push({
      id: `boss-fight-${zoneId}-${classId}`,
      run(content) {
        const p = profileAt(content, classId, zoneId, 9_002);
        const zone = content.zone(zoneId);
        const fight = prepareFight(
          p,
          content,
          {
            zoneId,
            mode: "push",
            runIndex: 3,
            stageIndex: zone.stages.length - 1,
            hp100: null,
            phase: "fight",
            elapsedMs: 0,
            restMs: 0,
            runElapsedMs: 0,
            bestAtStart: 0,
            totals: { xp: 0, gold: 0, mastery: 0, items: 0 },
          },
          { contentTimeMs: 0, recordEvents: true },
        );
        return fightHash(fight.record, fight.events!, fight.summary);
      },
    });
  }
}

// Approved C1 retune behavior (22 Sep 2026 rebase of C2 onto c1-retune).
C1_EQUIVALENCE_CASES.push({
  // 30 h away is capped at 24 h of simulated time.
  id: "offline-30h-cap-greenfields-monk",
  run(content) {
    const p = profileAt(content, "monk", "greenfields", 9_003);
    applyCommand(p, content, { type: "startFarm", zoneId: "greenfields" }, { contentTimeMs: 0 });
    const summary = simulateOffline(p, content, 30 * 3_600_000, 0);
    return sha256Hex(canonicalJson({ profile: encodeProfile(p), summary }));
  },
});
C1_EQUIVALENCE_CASES.push({
  // A L9 M7 Mage fails the Darkwood Push, then safe-farms Greenfields for the rest of a day.
  id: "offline-24h-darkwood-fail-then-safe-farm-mage",
  run(content) {
    const p = profileAt(content, "mage", "greenfields", 9_004);
    p.character.xp = content.levelTotals[8]!;
    p.character.level = 9;
    p.character.masteryXp.mage = content.masteryTotals(content.classDef("mage").masteryTrackId)[6]!;
    p.adventure.zones.greenfields = { unlocked: true, cleared: true, bestStage: 10, completions: 1, checkpoint: null };
    p.adventure.zones.darkwood = { unlocked: true, cleared: false, bestStage: 0, completions: 0, checkpoint: null };
    applyCommand(p, content, { type: "startPush", zoneId: "darkwood" }, { contentTimeMs: 0 });
    const summary = simulateOffline(p, content, 24 * 3_600_000, 0);
    return sha256Hex(canonicalJson({ profile: encodeProfile(p), summary }));
  },
});
C1_EQUIVALENCE_CASES.push({
  // Attack (hundredths) for Monk and Mage at L11, every Mastery rank M1-M20.
  id: "mastery-foundation-l11-m1-m20",
  run(content) {
    const rows: Record<string, number[]> = {};
    for (const classId of ["monk", "mage"]) {
      rows[classId] = [];
      for (let rank = 1; rank <= 20; rank += 1) {
        const p = profileAt(content, classId, "greenfields", 9_005);
        p.character.xp = content.levelTotals[10]!;
        p.character.level = 11;
        p.character.masteryXp[classId] = content.masteryTotals(content.classDef(classId).masteryTrackId)[rank - 1]!;
        rows[classId]!.push(heroStatsFor(p, content).attack100);
      }
    }
    return sha256Hex(canonicalJson(rows));
  },
});

export function c1Content(snapshot: ContentSnapshot): ContentIndex {
  return new ContentIndex(snapshot);
}
