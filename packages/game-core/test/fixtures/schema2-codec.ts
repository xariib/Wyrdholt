// Frozen PR22 reader (256688d), only relative import paths adjusted for this fixture.
import { SLOT_ORDER, type ItemInstance } from "@emberbound/shared-types";
import { canonicalJson } from "../../src/hash/canonical";
import { sha256Hex } from "../../src/hash/sha256";
import type { Profile } from "../../src/profile/types";
import { RULES_VERSION, SAVE_SCHEMA_VERSION } from "../../src/rules/version";

/**
 * Versioned save envelope with a SHA-256 checksum of the payload.
 *
 * The payload encodes the inventory compactly: plain instances (no per-instance
 * data) are grouped by catalog item as id lists; instances carrying rolled
 * stats, modifiers, provenance, upgrades or seasonal state are stored in full.
 * Adding per-instance data later needs no ownership rewrite.
 */

export const SAVE_FORMAT = "emberbound-save";
/** Schema 1 remains the default; schema 2 adds the independent Forge domain. */
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
    schema: profile.forge ? FORGE_SAVE_SCHEMA_VERSION : SAVE_SCHEMA_VERSION,
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
  if (envelope.schema > FORGE_SAVE_SCHEMA_VERSION) return { ok: false, reason: "newer-schema" };
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
  if ((envelope.schema === FORGE_SAVE_SCHEMA_VERSION) !== (migrated.forge !== undefined)) {
    return { ok: false, reason: "invalid:forge-schema" };
  }
  const stateProblem = profileStateProblem(migrated);
  if (stateProblem) return { ok: false, reason: `invalid:profile-state:${stateProblem}` };
  const profile = decodeProfile(migrated);
  const problem = validateProfile(profile);
  if (problem) return { ok: false, reason: `invalid:${problem}` };
  return { ok: true, profile, envelope };
}

/** Both formats are read without rewriting non-Forge characters. */
function migrate(encoded: EncodedProfile, schema: number): EncodedProfile | null {
  if (schema === SAVE_SCHEMA_VERSION || schema === FORGE_SAVE_SCHEMA_VERSION) return encoded;
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

export function validateProfile(profile: Profile): string | null {
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
  const forge = forgeProblem(profile);
  if (forge) return forge;
  const run = profile.adventure?.run;
  if (run) {
    if (!Number.isSafeInteger(run.stageIndex) || run.stageIndex < 0) return "run-stage";
    if (run.hp100 !== null && (!Number.isSafeInteger(run.hp100) || run.hp100 <= 0)) return "run-hp";
  }
  return null;
}
