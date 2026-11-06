import type { CombatEvent, FightRecord, ItemInstance } from "@emberbound/shared-types";
import type { ContentIndex } from "../content";
import { resolveHeroStats, type HeroStats } from "../character/stats";
import { ArraySink, NULL_SINK, simulateFight, type FightSummary } from "../combat/engine";
import { buildEncounter, type EncounterSetup } from "../encounter/budget";
import { canonicalJson } from "../hash/canonical";
import { sha256Hex } from "../hash/sha256";
import { combineRuleEffects } from "../rules/modifiers";
import { RULES_VERSION } from "../rules/version";

export class ReplayMismatchError extends Error {}

export interface ExecutedFight {
  hero: HeroStats;
  setup: EncounterSetup;
  summary: FightSummary;
  events: CombatEvent[] | null;
}

/**
 * Execute a fight from its record. This is the ONLY path that turns a
 * FightRecord into a result — the live game, offline catch-up, the Node
 * replay tool and the in-app self-test all use it.
 */
export function executeRecord(
  content: ContentIndex,
  record: FightRecord,
  options: { recordEvents: boolean; hero?: HeroStats },
): ExecutedFight {
  const instances = new Map<number, ItemInstance>();
  for (const i of record.itemInstances) instances.set(i.id, i);
  const hero = options.hero ?? resolveHeroStats(content, record.build, instances);
  const effects = combineRuleEffects(content, record.activeRuleIds);
  const setup = buildEncounter(content, record.encounter.zoneId, record.encounter.stageIndex, effects);
  const sink = options.recordEvents ? new ArraySink() : NULL_SINK;
  const summary = simulateFight(
    {
      seed: record.seed,
      hero,
      startHp100: record.startHp100,
      enemies: setup.enemies,
      effects,
      config: content.snapshot.config,
    },
    sink,
  );
  return { hero, setup, summary, events: sink instanceof ArraySink ? sink.events : null };
}

/** Hash of the complete authoritative fight: inputs, full event stream and final state. */
export function fightHash(record: FightRecord, events: readonly CombatEvent[], summary: FightSummary): string {
  return sha256Hex(canonicalJson({ record, events, final: summary }));
}

export interface ReplayResult {
  record: FightRecord;
  summary: FightSummary;
  events: CombatEvent[];
  hash: string;
}

export function checkRecordCompatibility(content: ContentIndex, record: FightRecord): void {
  if (record.format !== "emberbound-fight-record/1") {
    throw new ReplayMismatchError(`Unsupported record format ${String(record.format)}`);
  }
  if (record.rulesVersion !== RULES_VERSION) {
    throw new ReplayMismatchError(`Rules version mismatch: record ${record.rulesVersion}, core ${RULES_VERSION}`);
  }
  if (record.contentVersion !== content.snapshot.contentVersion || record.contentHash !== content.hash) {
    throw new ReplayMismatchError(
      `Content mismatch: record ${record.contentVersion}/${record.contentHash.slice(0, 12)}, ` +
        `loaded ${content.snapshot.contentVersion}/${content.hash.slice(0, 12)}`,
    );
  }
}

/** Replay a fight exactly and return its full event stream and hash. */
export function replayFight(content: ContentIndex, record: FightRecord): ReplayResult {
  checkRecordCompatibility(content, record);
  const executed = executeRecord(content, record, { recordEvents: true });
  const events = executed.events ?? [];
  return { record, summary: executed.summary, events, hash: fightHash(record, events, executed.summary) };
}
