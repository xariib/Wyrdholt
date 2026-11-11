import { SLOT_ORDER, type ItemInstance } from "@emberbound/shared-types";
import { ASHEN_KING_ID, bossFightSeed } from "../boss/attempt";
import { canonicalJson } from "../hash/canonical";
import { sha256Hex } from "../hash/sha256";
import type { Profile } from "../profile/types";
import { BOSS_SAVE_SCHEMA_VERSION, LONG_TERM_SAVE_SCHEMA_VERSION, HUNT_SAVE_SCHEMA_VERSION, RULES_VERSION, SAVE_SCHEMA_VERSION } from "../rules/version";
import { huntSeed } from "../hunts/hunts";
import { ITEM_LOCK_SAVE_SCHEMA_VERSION } from "../items/locks";

/**
 * Versioned save envelope with a SHA-256 checksum of the payload.
 *
 * The payload encodes the inventory compactly: plain instances (no per-instance
 * data) are grouped by catalog item as id lists; instances carrying rolled
 * stats, modifiers, provenance, upgrades or seasonal state are stored in full.
 * Adding per-instance data later needs no ownership rewrite.
 */

export const SAVE_FORMAT = "emberbound-save";
/** Schema 1 is the default, schema 2 adds Forge, and schema 3 adds item locks. */
export const FORGE_SAVE_SCHEMA_VERSION = 2;

export interface SaveEnvelope {
  format: typeof SAVE_FORMAT;
  schema: number;
  rulesVersion: string;
  contentVersion: string;
  savedAtWallMs: number;
  checksum: string;
  payload: string;
}

interface CompactInventory {
  nextInstanceId: number;
  /** baseId -> [ids, newIds] */
  groups: Record<string, [number[], number[]]>;
  full: ItemInstance[];
}

type EncodedProfile = Omit<Profile, "inventory"> & { inventory: CompactInventory };

function isPlain(instance: ItemInstance): boolean {
  return (
    instance.acquiredSeq === instance.id &&
    instance.rolls === undefined &&
    instance.modifiers === undefined &&
    instance.upgrade === undefined &&
    instance.seasonal === undefined
  );
}

/** Provenance is informational; the compact form keeps only non-plain instances in full. */
export function encodeProfile(profile: Profile): EncodedProfile {
  const groups: Record<string, [number[], number[]]> = {};
  const full: ItemInstance[] = [];
  for (const instance of profile.inventory.instances) {
    if (isPlain(instance)) {
      const group = (groups[instance.baseId] ??= [[], []]);
      group[0].push(instance.id);
      if (instance.isNew) group[1].push(instance.id);
    } else {
      full.push(instance);
    }
  }
  return { ...profile, inventory: { nextInstanceId: profile.inventory.nextInstanceId, groups, full } };
}

export function decodeProfile(encoded: EncodedProfile): Profile {
  const instances: ItemInstance[] = [...encoded.inventory.full];
  for (const [baseId, [ids, newIds]] of Object.entries(encoded.inventory.groups)) {
    const fresh = new Set(newIds);
    for (const id of ids) instances.push({ id, baseId, acquiredSeq: id, isNew: fresh.has(id) });
  }
  instances.sort((a, b) => a.id - b.id);
  return { ...encoded, inventory: { nextInstanceId: encoded.inventory.nextInstanceId, instances } };
}

export function serializeSave(profile: Profile, savedAtWallMs: number): string {
  // Drop provenance from plain instances to keep saves compact (informational only).
  const payload = canonicalJson(encodeProfile(stripPlainProvenance(profile)));
  const envelope: SaveEnvelope = {
    format: SAVE_FORMAT,
    schema: profile.hunts ? HUNT_SAVE_SCHEMA_VERSION : profile.longTerm ? LONG_TERM_SAVE_SCHEMA_VERSION
      : profile.ashenKing ? BOSS_SAVE_SCHEMA_VERSION
      : profile.itemLocks ? ITEM_LOCK_SAVE_SCHEMA_VERSION
      : profile.forge ? FORGE_SAVE_SCHEMA_VERSION : SAVE_SCHEMA_VERSION,
    rulesVersion: RULES_VERSION,
    contentVersion: profile.contentVersion,
    savedAtWallMs,
    checksum: sha256Hex(payload),
    payload,
  };
  return JSON.stringify(envelope);
}

function stripPlainProvenance(profile: Profile): Profile {
  return {
    ...profile,
    inventory: {
      nextInstanceId: profile.inventory.nextInstanceId,
      instances: profile.inventory.instances.map((i) => {
        if (i.provenance === undefined) return i;
        const { provenance: _drop, ...rest } = i;
        return rest;
      }),
    },
  };
}

export type ParseResult =
  | { ok: true; profile: Profile; envelope: SaveEnvelope }
  | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Check only the encoded structure read by decoding and existing validation.
 * Unknown profile/item fields remain intact; this is not a full Profile validator.
 */
function encodedProfileProblem(value: unknown): string | null {
  if (!isRecord(value)) return "profile";
  const inventory = value.inventory;
  if (!isRecord(inventory)) return "inventory";
  if (!Array.isArray(inventory.full)) return "inventory-full";
  for (const item of inventory.full) {
    if (
      !isRecord(item) ||
      !Number.isSafeInteger(item.id) ||
      typeof item.baseId !== "string" ||
      !Number.isSafeInteger(item.acquiredSeq) ||
      typeof item.isNew !== "boolean"
    ) return "inventory-item";
  }
  if (!isRecord(inventory.groups)) return "inventory-groups";
  for (const group of Object.values(inventory.groups)) {
    if (!Array.isArray(group) || group.length !== 2) return "inventory-group";
    const [ids, newIds] = group;
    if (!Array.isArray(ids) || !Array.isArray(newIds)) return "inventory-group";
    if (!ids.every(Number.isSafeInteger) || !newIds.every(Number.isSafeInteger)) return "inventory-group-ids";
  }
  return null;
}

type StateFieldKind = "integer" | "counter" | "positive" | "hp" | "string" | "boolean" | "strings";

function stateFieldsProblem(
  value: Record<string, unknown>,
  path: string,
  fields: ReadonlyArray<readonly [string, StateFieldKind | readonly string[]]>,
): string | null {
  for (const [key, kind] of fields) {
    const field = value[key];
    let valid: boolean;
    switch (kind) {
      case "integer": valid = Number.isSafeInteger(field); break;
      case "counter": valid = Number.isSafeInteger(field) && (field as number) >= 0; break;
      case "positive": valid = Number.isSafeInteger(field) && (field as number) > 0; break;
      case "hp": valid = field === null || Number.isSafeInteger(field) && (field as number) > 0; break;
      case "string": valid = typeof field === "string"; break;
      case "boolean": valid = typeof field === "boolean"; break;
      case "strings": valid = Array.isArray(field) && field.every(entry => typeof entry === "string"); break;
      default: valid = typeof field === "string" && kind.includes(field);
    }
    if (!valid) return `${path}.${key}`;
  }
  return null;
}

function totalsProblem(value: unknown, path: string): string | null {
  if (!isRecord(value)) return path;
  return stateFieldsProblem(value, path, [
    ["xp", "counter"], ["gold", "counter"], ["mastery", "counter"], ["items", "counter"],
  ]);
}

/** Structural gate for the three persisted state domains, not full Profile or
 * content validation. Sparse zones and unknown extensions are left intact.
 * Diagnostic paths deliberately omit user-controlled zone keys/save contents.
 */
function profileStateProblem(value: unknown): string | null {
  if (!isRecord(value)) return "profile";
  const { clock, stats, adventure } = value;
  if (!isRecord(clock)) return "clock";
  if (!isRecord(stats)) return "stats";
  if (!isRecord(adventure)) return "adventure";
  let problem = stateFieldsProblem(clock, "clock", [
    ["lastSettledWallMs", "integer"], ["simulatedMs", "counter"],
  ]) ?? stateFieldsProblem(stats, "stats", [
    ["fights", "counter"], ["victories", "counter"], ["defeats", "counter"],
    ["runsStarted", "counter"], ["runsCompleted", "counter"],
    ["itemsFound", "counter"], ["offlineSettlements", "counter"],
  ]) ?? stateFieldsProblem(adventure, "adventure", [
    ["activity", ["push", "farm", "idle"]], ["zoneId", "string"], ["runCounter", "counter"],
  ]);
  if (problem) return problem;
  if (!isRecord(adventure.zones)) return "adventure.zones";
  for (const zone of Object.values(adventure.zones)) {
    const path = "adventure.zones.<key>";
    if (!isRecord(zone)) return path;
    problem = stateFieldsProblem(zone, path, [
      ["unlocked", "boolean"], ["cleared", "boolean"],
      ["bestStage", "counter"], ["completions", "counter"],
    ]);
    if (problem) return problem;
    if (zone.checkpoint !== null) {
      if (!isRecord(zone.checkpoint)) return `${path}.checkpoint`;
      problem = stateFieldsProblem(zone.checkpoint, `${path}.checkpoint`, [
        ["runIndex", "counter"], ["stageIndex", "counter"], ["hp100", "hp"],
      ]);
      if (problem) return problem;
    }
  }
  const run = adventure.run;
  if (run !== null) {
    if (!isRecord(run)) return "adventure.run";
    problem = stateFieldsProblem(run, "adventure.run", [
      ["zoneId", "string"], ["mode", ["push", "farm", "trail"]],
      ["runIndex", "counter"], ["stageIndex", "counter"],
      ["elapsedMs", "counter"], ["restMs", "counter"],
      ["runElapsedMs", "counter"], ["bestAtStart", "counter"],
      ["hp100", "hp"], ["phase", ["rest", "fight"]],
    ]) ?? totalsProblem(run.totals, "adventure.run.totals");
    if (problem) return problem;
  }
  const result = adventure.lastResult;
  if (result !== null) {
    if (!isRecord(result)) return "adventure.lastResult";
    problem = stateFieldsProblem(result, "adventure.lastResult", [
      ["kind", ["defeat", "timeout", "cleared"]], ["zoneId", "string"],
      ["mode", ["push", "farm", "trail"]], ["stage", "positive"], ["stagesTotal", "positive"],
      ["enemyHp100", "counter"], ["enemyMaxHp100", "counter"], ["enemiesAlive", "counter"],
      ["heroHp100", "counter"], ["runElapsedMs", "counter"],
      ["newBest", "boolean"], ["firstClear", "boolean"], ["unlockedZoneIds", "strings"],
    ]) ?? totalsProblem(result.totals, "adventure.lastResult.totals");
    if (problem) return problem;
  }
  return null;
}

export function parseSave(text: string): ParseResult {
  let rawEnvelope: unknown;
  try {
    rawEnvelope = JSON.parse(text);
  } catch {
    return { ok: false, reason: "not-json" };
  }
  if (!isRecord(rawEnvelope) || rawEnvelope.format !== SAVE_FORMAT) return { ok: false, reason: "wrong-format" };
  if (!Number.isSafeInteger(rawEnvelope.schema)) return { ok: false, reason: "invalid:envelope-schema" };
  if (typeof rawEnvelope.rulesVersion !== "string" || typeof rawEnvelope.contentVersion !== "string") {
    return { ok: false, reason: "invalid:envelope-version" };
  }
  // Preserve finite timestamp semantics (including fractions/negative values).
  // Reject malformed candidates before they can influence recovery ordering.
  if (typeof rawEnvelope.savedAtWallMs !== "number" || !Number.isFinite(rawEnvelope.savedAtWallMs)) {
    return { ok: false, reason: "invalid:saved-at" };
  }
  const envelope = rawEnvelope as unknown as SaveEnvelope;
  if (typeof envelope.payload !== "string") return { ok: false, reason: "missing-payload" };
  if (sha256Hex(envelope.payload) !== envelope.checksum) return { ok: false, reason: "checksum-mismatch" };
  if (envelope.schema > HUNT_SAVE_SCHEMA_VERSION) return { ok: false, reason: "newer-schema" };
  let encoded: unknown;
  try {
    encoded = JSON.parse(envelope.payload);
  } catch {
    return { ok: false, reason: "payload-not-json" };
  }
  const encodedProblem = encodedProfileProblem(encoded);
  if (encodedProblem) return { ok: false, reason: `invalid:${encodedProblem}` };
  const migrated = migrate(encoded as EncodedProfile, envelope.schema);
  if (!migrated) return { ok: false, reason: "unsupported-schema" };
  if (envelope.schema === FORGE_SAVE_SCHEMA_VERSION && migrated.forge === undefined
    || envelope.schema === SAVE_SCHEMA_VERSION && migrated.forge !== undefined) {
    return { ok: false, reason: "invalid:forge-schema" };
  }
  if (envelope.schema < BOSS_SAVE_SCHEMA_VERSION && ((envelope.schema === ITEM_LOCK_SAVE_SCHEMA_VERSION) !== (migrated.itemLocks !== undefined)
    || envelope.schema === ITEM_LOCK_SAVE_SCHEMA_VERSION && migrated.schema !== ITEM_LOCK_SAVE_SCHEMA_VERSION)) {
    return { ok: false, reason: "invalid:item-locks-schema" };
  }
  if ((envelope.schema === HUNT_SAVE_SCHEMA_VERSION) !== (migrated.hunts !== undefined)
    || (envelope.schema === HUNT_SAVE_SCHEMA_VERSION) !== (migrated.schema === HUNT_SAVE_SCHEMA_VERSION)) return { ok: false, reason: "invalid:hunt-schema" };
  if (envelope.schema < HUNT_SAVE_SCHEMA_VERSION && ((envelope.schema === LONG_TERM_SAVE_SCHEMA_VERSION) !== (migrated.longTerm !== undefined)
    || (envelope.schema === LONG_TERM_SAVE_SCHEMA_VERSION) !== (migrated.schema === LONG_TERM_SAVE_SCHEMA_VERSION))) {
    return { ok: false, reason: "invalid:long-term-schema" };
  }
  if (envelope.schema < LONG_TERM_SAVE_SCHEMA_VERSION && ((envelope.schema === BOSS_SAVE_SCHEMA_VERSION) !== (migrated.ashenKing !== undefined)
    || (envelope.schema === BOSS_SAVE_SCHEMA_VERSION) !== (migrated.schema === BOSS_SAVE_SCHEMA_VERSION))) {
    return { ok: false, reason: "invalid:solo-boss-schema" };
  }
  const stateProblem = profileStateProblem(migrated);
  if (stateProblem) return { ok: false, reason: `invalid:profile-state:${stateProblem}` };
  const profile = decodeProfile(migrated);
  const problem = validateProfile(profile);
  if (problem) return { ok: false, reason: `invalid:${problem}` };
  return { ok: true, profile, envelope };
}

/** Old formats are read without rewriting them. First use of a new domain upgrades the save. */
function migrate(encoded: EncodedProfile, schema: number): EncodedProfile | null {
  if (schema === SAVE_SCHEMA_VERSION || schema === FORGE_SAVE_SCHEMA_VERSION || schema === ITEM_LOCK_SAVE_SCHEMA_VERSION
    || schema === BOSS_SAVE_SCHEMA_VERSION || schema === LONG_TERM_SAVE_SCHEMA_VERSION || schema === HUNT_SAVE_SCHEMA_VERSION) return encoded;
  return null;
}

function forgeProblem(profile: Profile): string | null {
  const forge: unknown = profile.forge;
  if (forge === undefined) return null;
  if (!isRecord(forge) || forge.version !== 1 || !Number.isSafeInteger(forge.nextTransactionId)
    || (forge.nextTransactionId as number) < 1) return "forge-counter";
  if (forge.devUnlocked !== undefined && typeof forge.devUnlocked !== "boolean") return "forge-dev";
  const positiveId = (id: unknown): id is number => Number.isSafeInteger(id) && (id as number) > 0
    && (id as number) < profile.inventory.nextInstanceId;
  if (forge.devItemIds !== undefined && (!Array.isArray(forge.devItemIds)
    || forge.devItemIds.length > 10000 || !forge.devItemIds.every(positiveId)
    || new Set(forge.devItemIds).size !== forge.devItemIds.length)) return "forge-dev";
  const receipt = forge.lastReceipt;
  if (receipt === undefined) return forge.nextTransactionId === 1 ? null : "forge-receipt";
  if (!isRecord(receipt) || !Number.isSafeInteger(receipt.transactionId)
    || (receipt.transactionId as number) < 1
    || receipt.transactionId !== (forge.nextTransactionId as number) - 1
    || !positiveId(receipt.outputInstanceId) || !Array.isArray(receipt.consumedIds)
    || !receipt.consumedIds.every(positiveId)
    || receipt.consumedIds.length !== receipt.count || receipt.consumedIds.length < 1
    || receipt.consumedIds.some((id, i, ids) => id >= (receipt.outputInstanceId as number) || i > 0 && id <= ids[i - 1]!)
    || profile.inventory.instances.some(i => (receipt.consumedIds as number[]).includes(i.id))) return "forge-receipt";
  if (stateFieldsProblem(receipt, "forge-receipt", [
    ["inputKey", "string"], ["rulesVersion", "string"], ["configVersion", "string"],
    ["slot", SLOT_ORDER], ["rarity", "string"], ["count", "positive"], ["gold", "counter"],
    ["seed", "counter"], ["draws", "counter"], ["critical", "boolean"],
    ["outputRarity", "string"], ["outputBaseId", "string"], ["mode", ["configured", "normal", "critical"]],
  ])) return "forge-receipt";
  const inputKey = canonicalJson({ transactionId: receipt.transactionId, configVersion: receipt.configVersion,
    slot: receipt.slot, rarity: receipt.rarity, instanceIds: receipt.consumedIds, mode: receipt.mode });
  return receipt.inputKey === inputKey ? null : "forge-receipt";
}

function bossRecordProblem(record: unknown, bossId: string, tier: number, attemptIndex: number, profile: Profile): boolean {
  const season = bossId.startsWith("season_");
  if (!isRecord(record) || record.format !== "emberbound-boss-fight-record/1" || record.startHp100 !== null
    || typeof record.rulesVersion !== "string" || typeof record.contentVersion !== "string"
    || typeof record.contentHash !== "string" || !/^[0-9a-f]{64}$/.test(record.contentHash)
    || record.seed !== bossFightSeed(profile.masterSeed, bossId, tier, attemptIndex)
    || !Array.isArray(record.activeRuleIds) || record.activeRuleIds.length !== (season ? 1 : 0)
    || (season && typeof record.activeRuleIds[0] !== "string")
    || !isRecord(record.encounter) || record.encounter.bossId !== bossId || record.encounter.tier !== tier
    || !isRecord(record.build) || !isRecord(record.build.equipment)
    || !Array.isArray(record.itemInstances) || record.itemInstances.length > SLOT_ORDER.length) return true;

  const { build } = record;
  if (stateFieldsProblem(build, "build", [["characterLevel", "positive"], ["classId", "string"], ["masteryXp", "counter"]])) return true;
  if (build.promoted !== undefined && (build.promoted !== true || profile.schema < LONG_TERM_SAVE_SCHEMA_VERSION)) return true;
  if (bossId.startsWith("trial_") && (tier !== 1 || bossId !== `trial_${build.classId}` || build.promoted !== undefined)) return true;
  if (build.seasonRelicAttackBp !== undefined && (!season || tier < 2 || !Number.isSafeInteger(build.seasonRelicAttackBp)
    || (build.seasonRelicAttackBp as number) <= 0 || (build.seasonRelicAttackBp as number) > 10_000)) return true;
  if (build.artifactId === null) {
    if (build.artifactAttackBp !== undefined) return true;
  } else if (build.artifactId !== "ashen_crown" || !Number.isSafeInteger(build.artifactAttackBp)
    || (build.artifactAttackBp as number) <= 0 || (build.artifactAttackBp as number) > 10_000) return true;

  const ids = new Set<number>();
  for (const item of record.itemInstances) {
    if (!isRecord(item) || stateFieldsProblem(item, "item", [
      ["id", "positive"], ["baseId", "string"], ["acquiredSeq", "positive"], ["isNew", "boolean"],
    ]) || ids.has(item.id as number)) return true;
    ids.add(item.id as number);
  }
  for (const [slot, id] of Object.entries(record.build.equipment)) {
    if (!(SLOT_ORDER as readonly string[]).includes(slot) || !ids.delete(id as number)) return true;
  }
  return ids.size !== 0;
}

function ladderProblem(profile: Profile, value: unknown, bossId: string): string | null {
  if (!isRecord(value) || value.version !== 1 || stateFieldsProblem(value, "solo-boss", [
    ["highestClearedTier", "counter"], ["attemptCount", "positive"],
  ])) return "solo-boss-progress";
  const cleared = value.highestClearedTier as number;
  const attempts = value.attemptCount as number;
  const { active, lastResult } = value;
  if (cleared > attempts - (active === null ? 0 : 1) || (bossId.startsWith("trial_") && cleared > 1)) return "solo-boss-progress";
  if (active !== null && (!isRecord(active) || stateFieldsProblem(active, "active", [["elapsedMs", "counter"], ["autoPush", "boolean"]])
    || profile.adventure?.activity !== "idle" || profile.adventure.run !== null
    || (bossId !== ASHEN_KING_ID && active.autoPush !== false)
    || bossRecordProblem(active.record, bossId, cleared + 1, attempts, profile))) return "solo-boss-attempt";

  if (lastResult === null) return active !== null && attempts === 1 ? null : "solo-boss-result";
  if (!isRecord(lastResult) || stateFieldsProblem(lastResult, "result", [
    ["tier", "positive"], ["outcome", ["victory", "defeat", "timeout", "interrupted"]],
    ["enemyHp100", "counter"], ["enemyMaxHp100", "counter"],
  ]) || active !== null && attempts < 2) return "solo-boss-result";
  const hp = lastResult.enemyHp100 as number;
  const max = lastResult.enemyMaxHp100 as number;
  if (lastResult.outcome === "victory") return lastResult.tier === cleared && hp === 0 && max > 0 ? null : "solo-boss-result";
  if (lastResult.tier !== cleared + 1) return "solo-boss-result";
  if (lastResult.outcome === "interrupted") return hp === 0 && max === 0 ? null : "solo-boss-result";
  return hp > 0 && hp <= max ? null : "solo-boss-result";
}

function huntsProblem(profile: Profile): string | null {
  const state: unknown = profile.hunts;
  if (state === undefined) return profile.schema === HUNT_SAVE_SCHEMA_VERSION ? "hunt-schema" : null;
  if (profile.schema !== HUNT_SAVE_SCHEMA_VERSION || !isRecord(state) || state.version !== 1
    || stateFieldsProblem(state, "hunt", [["progressMs", "counter"], ["nextDiscoveryId", "positive"], ["completed", "counter"]])
    || !Array.isArray(state.queue) || state.queue.length > 3) return "hunt-state";
  const ids = new Set<number>();
  let started = 0;
  for (const entry of state.queue) {
    if (!isRecord(entry) || stateFieldsProblem(entry, "hunt", [["id", "positive"], ["huntId", "string"], ["step", "counter"], ["hp100", "hp"]])
      || (entry.step as number) > 2 || (entry.id as number) >= (state.nextDiscoveryId as number) || ids.has(entry.id as number)
      || entry.slot !== null && !(SLOT_ORDER as readonly unknown[]).includes(entry.slot)
      || entry.route !== null && !["direct", "raid", "weakness"].includes(entry.route as string)
      || entry.step === 0 && entry.route !== null || entry.step === 1 && entry.route === "direct" || entry.step === 2 && entry.route === null
      || entry.slot === null && (entry.step !== 0 || entry.hp100 !== null)) return "hunt-discovery";
    ids.add(entry.id as number);
    if (entry.slot !== null) started++;
  }
  if (started > 1 || (state.completed as number) + state.queue.length !== (state.nextDiscoveryId as number) - 1) return "hunt-counter";
  const active = state.active;
  if (active !== null) {
    if (!isRecord(active) || stateFieldsProblem(active, "hunt", [["elapsedMs", "counter"]])
      || profile.adventure?.activity !== "idle" || profile.adventure.run !== null || profile.ashenKing?.active
      || Object.values(profile.longTerm?.ladders ?? {}).some(l => l?.active)) return "hunt-attempt";
    const record = active.record;
    if (!isRecord(record) || !isRecord(record.hunt) || record.format !== "emberbound-fight-record/4"
      || !isRecord(record.encounter) || typeof record.encounter.zoneId !== "string"
      || stateFieldsProblem(record, "record", [["startHp100", "hp"]])) return "hunt-record";
    const ref = record.hunt;
    const entry = state.queue.find(e => e.id === ref.discoveryId);
    if (!entry || entry.slot === null || ref.huntId !== entry.huntId || ref.step !== entry.step || ref.route !== entry.route
      || record.encounter.stageIndex !== entry.step || record.seed !== huntSeed(profile.masterSeed, entry.id, entry.step)) return "hunt-record";
    // Reuse the common pinned-build/item validation, after checking Hunt-specific fields above.
    const normalized = { ...record, format: "emberbound-boss-fight-record/1", startHp100: null,
      encounter: { bossId: ASHEN_KING_ID, tier: 1 }, seed: bossFightSeed(profile.masterSeed, ASHEN_KING_ID, 1, 1) };
    if (bossRecordProblem(normalized, ASHEN_KING_ID, 1, 1, profile)) return "hunt-build";
  }
  const result = state.lastResult;
  if (result !== null && (!isRecord(result) || stateFieldsProblem(result, "hunt-result", [
    ["discoveryId", "positive"], ["huntId", "string"], ["step", "counter"], ["gold", "counter"],
    ["outcome", ["victory", "defeat", "timeout", "interrupted"]], ["enemyHp100", "counter"], ["enemyMaxHp100", "counter"],
  ]) || (result.step as number) > 2 || (result.discoveryId as number) >= (state.nextDiscoveryId as number)
    || (result.enemyHp100 as number) > (result.enemyMaxHp100 as number) || !Array.isArray(result.itemIds) || result.itemIds.length > 1
    || result.itemIds.some(id => !Number.isSafeInteger(id) || id < 1 || id >= profile.inventory.nextInstanceId))) return "hunt-result";
  return null;
}

function bossProgressProblem(profile: Profile): string | null {
  const longTerm: unknown = profile.longTerm;
  if (profile.ashenKing === undefined ? profile.schema === BOSS_SAVE_SCHEMA_VERSION : profile.schema < BOSS_SAVE_SCHEMA_VERSION) {
    return "solo-boss-schema";
  }
  const permanentProblem = profile.ashenKing === undefined ? null : ladderProblem(profile, profile.ashenKing, ASHEN_KING_ID);
  if (permanentProblem) return permanentProblem;
  if (longTerm === undefined) return profile.schema === LONG_TERM_SAVE_SCHEMA_VERSION ? "long-term-schema" : null;
  if (profile.schema < LONG_TERM_SAVE_SCHEMA_VERSION || !isRecord(longTerm) || longTerm.version !== 1 || !isRecord(longTerm.ladders)) {
    return "long-term-schema";
  }
  const ladders = Object.entries(longTerm.ladders);
  if (!ladders.length) return "long-term-progress";
  let active = (profile.ashenKing?.active ? 1 : 0) + (profile.hunts?.active ? 1 : 0);
  for (const [id, value] of ladders) {
    if (!/^(?:trial|season)_[a-z0-9_]+$/.test(id) || ladderProblem(profile, value, id)) return "long-term-progress";
    if (isRecord(value) && value.active !== null) active += 1;
  }
  return active <= 1 ? null : "multiple-active-challenges";
}

export function validateProfile(profile: Profile): string | null {
  const hunt = huntsProblem(profile);
  if (hunt) return hunt;
  if (!Number.isSafeInteger(profile.masterSeed)) return "seed";
  if (!isRecord(profile.character) || typeof profile.character.activeClassId !== "string") return "character";
  if (!Number.isSafeInteger(profile.gold) || profile.gold < 0) return "gold";
  if (!Number.isSafeInteger(profile.inventory.nextInstanceId)) return "inventory";
  let last = 0;
  for (const i of profile.inventory.instances) {
    if (!Number.isSafeInteger(i.id) || i.id <= last) return "instance-order";
    if (i.id >= profile.inventory.nextInstanceId) return "instance-counter";
    last = i.id;
  }
  if (profile.itemLocks !== undefined) {
    const locks: unknown = profile.itemLocks;
    if (profile.schema < ITEM_LOCK_SAVE_SCHEMA_VERSION || profile.schema > HUNT_SAVE_SCHEMA_VERSION) return "item-locks-schema";
    if (!isRecord(locks) || locks.version !== 1 || !Array.isArray(locks.lockedInstanceIds)) return "item-locks";
    let previous = 0;
    const owned = new Set(profile.inventory.instances.map(i => i.id));
    for (const id of locks.lockedInstanceIds) {
      if (!Number.isSafeInteger(id) || id <= previous || !owned.has(id)) return "item-locks-ids";
      previous = id;
    }
  } else if (profile.schema === ITEM_LOCK_SAVE_SCHEMA_VERSION) return "item-locks-schema";
  const boss = bossProgressProblem(profile);
  if (boss) return boss;
  const forge = forgeProblem(profile);
  if (forge) return forge;
  const run = profile.adventure?.run;
  if (run) {
    if (!Number.isSafeInteger(run.stageIndex) || run.stageIndex < 0) return "run-stage";
    if (run.hp100 !== null && (!Number.isSafeInteger(run.hp100) || run.hp100 <= 0)) return "run-hp";
  }
  return null;
}
