import type { BossFightRecord, CombatEvent, CombatRecord, FightRecord, ItemInstance } from "@emberbound/shared-types";
import type { ContentIndex } from "../content";
import { resolveHeroStats, type HeroStats } from "../character/stats";
import { ArraySink, NULL_SINK, simulateFight, type FightSummary } from "../combat/engine";
import { buildBossEncounter, buildEncounter, type BossEncounterSetup, type EncounterSetup } from "../encounter/budget";
import { canonicalJson } from "../hash/canonical";
import { sha256Hex } from "../hash/sha256";
import { combineRuleEffects } from "../rules/modifiers";
import { ASHEN_KING_ID } from "../boss/progress";
import { LONG_TERM_RULES_VERSION, RULES_VERSION } from "../rules/version";

export class ReplayMismatchError extends Error {}

export interface ExecutedFight<Setup = EncounterSetup> {
  hero: HeroStats;
  setup: Setup;
  summary: FightSummary;
  events: CombatEvent[] | null;
}

interface ExecuteOptions {
  recordEvents: boolean;
  hero?: HeroStats;
}

/**
 * Execute a fight from its record. This is the ONLY path that turns a
 * CombatRecord into a result — the live game, offline catch-up, the Node
 * replay tool and the in-app self-test all use it.
 */
export function executeRecord(content: ContentIndex, record: FightRecord, options: ExecuteOptions): ExecutedFight;
export function executeRecord(content: ContentIndex, record: BossFightRecord, options: ExecuteOptions): ExecutedFight<BossEncounterSetup>;
export function executeRecord(content: ContentIndex, record: CombatRecord, options: ExecuteOptions): ExecutedFight<EncounterSetup | BossEncounterSetup>;
export function executeRecord(
  content: ContentIndex,
  record: CombatRecord,
  options: ExecuteOptions,
): ExecutedFight<EncounterSetup | BossEncounterSetup> {
  const instances = new Map<number, ItemInstance>();
  for (const i of record.itemInstances) instances.set(i.id, i);
  const hero = options.hero ?? resolveHeroStats(content, record.build, instances);
  const effects = combineRuleEffects(content, record.activeRuleIds);
  const setup = record.format === "emberbound-boss-fight-record/1"
    ? buildBossEncounter(content, record.encounter, effects)
    : buildEncounter(content, record.encounter.zoneId, record.encounter.stageIndex, effects);
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
export function fightHash(record: CombatRecord, events: readonly CombatEvent[], summary: FightSummary): string {
  return sha256Hex(canonicalJson({ record, events, final: summary }));
}

export interface ReplayResult<RecordType extends CombatRecord = FightRecord> {
  record: RecordType;
  summary: FightSummary;
  events: CombatEvent[];
  hash: string;
}

export function checkRecordCompatibility(content: ContentIndex, record: CombatRecord): void {
  const format = record.format;
  if (format !== "emberbound-fight-record/1" && format !== "emberbound-fight-record/2" && format !== "emberbound-fight-record/3" && format !== "emberbound-boss-fight-record/1") {
    throw new ReplayMismatchError(`Unsupported record format ${String(format)}`);
  }
  const attackBp = record.build?.artifactAttackBp;
  if (format === "emberbound-fight-record/1" && attackBp !== undefined
    || format === "emberbound-fight-record/2" && attackBp === undefined
    || attackBp !== undefined && (!Number.isSafeInteger(attackBp) || attackBp <= 0 || attackBp > 10_000)) {
    throw new ReplayMismatchError("Invalid Artifact bonus for this fight record");
  }
  const boss = record.format === "emberbound-boss-fight-record/1";
  const bossId = boss ? record.encounter.bossId : undefined;
  const season = bossId ? content.seasons.get(bossId) : undefined;
  const promoted = record.build.promoted;
  if ((promoted !== undefined && (promoted !== true || !content.promotions.has(record.build.classId)))
    || (!boss && (format === "emberbound-fight-record/3") !== (promoted === true))) {
    throw new ReplayMismatchError("Invalid promotion for this fight record");
  }
  if (season && boss) {
    const tier = record.encounter.tier;
    if (record.activeRuleIds.length !== 1 || record.activeRuleIds[0] !== season.rule.id
      || record.build.seasonRelicAttackBp !== season.relicAttackBp[tier - 2]) {
      throw new ReplayMismatchError("Invalid seasonal rule or Relic");
    }
  } else if (record.build.seasonRelicAttackBp !== undefined || (boss && record.activeRuleIds.length !== 0)) {
    throw new ReplayMismatchError("Unexpected seasonal rule or Relic");
  }
  const longTerm = promoted === true || (boss && bossId !== ASHEN_KING_ID);
  const rulesVersion = longTerm ? LONG_TERM_RULES_VERSION : RULES_VERSION;
  if (record.rulesVersion !== rulesVersion) {
    throw new ReplayMismatchError(`Rules version mismatch: record ${record.rulesVersion}, core ${rulesVersion}`);
  }
  if (boss && !content.soloBosses.get(record.encounter.bossId)?.tiers[record.encounter.tier - 1]) {
    throw new ReplayMismatchError("Unknown boss or tier");
  }
  const contentHash = (bossId ? content.seasonHashes.get(bossId) : undefined)
    ?? (longTerm ? content.promotionHash : boss ? content.bossHash : content.hash);
  if (record.contentVersion !== content.snapshot.contentVersion || record.contentHash !== contentHash) {
    throw new ReplayMismatchError(
      `Content mismatch: record ${record.contentVersion}/${record.contentHash.slice(0, 12)}, ` +
        `loaded ${content.snapshot.contentVersion}/${contentHash.slice(0, 12)}`,
    );
  }
}

/** Replay a fight exactly and return its full event stream and hash. */
export function replayFight<RecordType extends CombatRecord>(content: ContentIndex, record: RecordType): ReplayResult<RecordType> {
  checkRecordCompatibility(content, record);
  const executed = executeRecord(content, record, { recordEvents: true });
  const events = executed.events ?? [];
  return { record, summary: executed.summary, events, hash: fightHash(record, events, executed.summary) };
}
