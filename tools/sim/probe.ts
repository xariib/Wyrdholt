/**
 * Shared probes for balance tools: expected-build profiles, stage fight length,
 * and Push clear rates. Tools may use floats; game-core stays integer-only.
 */
import type { ContentSnapshot, FightRecord, SlotId } from "@emberbound/shared-types";
import { CONTENT } from "@emberbound/game-content";
import {
  ContentIndex,
  FightCache,
  RULES_VERSION,
  advanceAdventure,
  applyCommand,
  createProfile,
  executeRecord,
  type AdventureEvent,
  type ExecutedFight,
  type FightSummary,
  type Profile,
} from "@emberbound/game-core";
import type { ExpectedBuild } from "./expected-builds";

export const PLAYABLE_ZONES = CONTENT.zones.filter((z) => z.implemented && !z.hidden);

export type Budgets = Record<string, { hp: number[]; dps: number[] }>;

/** CONTENT with some zones' stage budgets replaced (test_grounds mirrors greenfields). */
export function snapshotWith(budgets: Budgets, base: ContentSnapshot = CONTENT): ContentSnapshot {
  const snap: ContentSnapshot = JSON.parse(JSON.stringify(base));
  for (const z of snap.zones) {
    const b = budgets[z.id] ?? (z.id === "test_grounds" ? budgets.greenfields : undefined);
    if (!b) continue;
    z.stages.forEach((s, i) => {
      s.hpBudget = b.hp[i]!;
      s.dpsBudget100 = b.dps[i]!;
    });
  }
  return snap;
}

export function profileFor(content: ContentIndex, classId: string, build: ExpectedBuild, seed: number): Profile {
  const other = classId === "monk" ? "mage" : "monk";
  const p = createProfile(content, { name: "Probe", activeClassId: classId, alternateClassId: other, masterSeed: seed, nowWallMs: 0 });
  p.character.xp = content.levelTotals[build.level - 1]!;
  p.character.level = build.level;
  const track = content.classDef(classId).masteryTrackId;
  p.character.masteryXp[classId] = content.masteryTotals(track)[build.mastery - 1]!;
  applyCommand(p, content, { type: "devGrant", baseIds: build.gear }, { contentTimeMs: 0 });
  for (const inst of p.inventory.instances) {
    if (!build.gear.includes(inst.baseId)) continue;
    const slot = content.item(inst.baseId).slot as SlotId;
    applyCommand(p, content, { type: "equip", slot, instanceId: inst.id }, { contentTimeMs: 0 });
  }
  for (const z of PLAYABLE_ZONES) p.adventure.zones[z.id] = { unlocked: true, cleared: false, bestStage: 0, completions: 0, checkpoint: null };
  return p;
}

/** One fight of the build against a stage from full HP. */
export function probeFight(content: ContentIndex, classId: string, build: ExpectedBuild, zoneId: string, stageIndex: number, seed: number): FightSummary {
  return probeFightDetailed(content, classId, build, zoneId, stageIndex, seed, false).summary;
}

/** Same as probeFight, with the event log and the resolved hero (tools only). */
export function probeFightDetailed(
  content: ContentIndex,
  classId: string,
  build: ExpectedBuild,
  zoneId: string,
  stageIndex: number,
  seed: number,
  recordEvents = true,
): ExecutedFight {
  const p = profileFor(content, classId, build, 7);
  const equippedIds = new Set(Object.values(p.equipment));
  const record: FightRecord = {
    format: "emberbound-fight-record/1",
    rulesVersion: RULES_VERSION,
    contentVersion: content.snapshot.contentVersion,
    contentHash: content.hash,
    seed,
    build: { characterLevel: build.level, classId, masteryXp: p.character.masteryXp[classId]!, equipment: { ...p.equipment }, artifactId: null },
    itemInstances: p.inventory.instances.filter((i) => equippedIds.has(i.id)),
    encounter: { zoneId, stageIndex },
    startHp100: null,
    activeRuleIds: [],
  };
  return executeRecord(content, record, { recordEvents });
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? NaN;
}

/** Median fight seconds for one stage (use with enemy damage off: hero cannot die). */
export function stageSeconds(content: ContentIndex, zoneId: string, stageIndex: number, build: ExpectedBuild, classes: string[]): number {
  const durations: number[] = [];
  for (const classId of classes) {
    for (let seed = 1; seed <= 9; seed += 1) {
      durations.push(probeFight(content, classId, build, zoneId, stageIndex, seed * 7919).durationMs / 1000);
    }
  }
  return median(durations);
}

/** Share of full Push runs cleared at the build (mean over classes). */
export function clearRate(
  content: ContentIndex,
  zoneId: string,
  build: ExpectedBuild,
  runs: number,
  classes: string[],
): { rate: number; perClass: Record<string, number>; failStages: number[] } {
  const perClass: Record<string, number> = {};
  const failStages: number[] = [];
  for (const classId of classes) {
    let cleared = 0;
    for (let r = 0; r < runs; r += 1) {
      const p = profileFor(content, classId, build, 1000 + r * 104729);
      applyCommand(p, content, { type: "startPush", zoneId }, { contentTimeMs: 0 });
      let result: "cleared" | "failed" | null = null;
      const cache = new FightCache(2);
      const onEvent = (e: AdventureEvent) => {
        if (e.type === "runEnded" && result === null) {
          result = e.result.kind === "cleared" ? "cleared" : "failed";
          if (result === "failed") failStages.push(e.result.stage);
        }
      };
      // Advance in short steps and stop at the first result (a clear would start Farm).
      for (let t = 0; t < 60 && result === null; t += 1) {
        advanceAdventure(p, content, 20_000, { offline: false, contentTimeMs: 0, cache, onEvent });
      }
      if (result === "cleared") cleared += 1;
    }
    perClass[classId] = cleared / runs;
  }
  const rate = classes.reduce((s, c) => s + perClass[c]!, 0) / classes.length;
  return { rate, perClass, failStages };
}
