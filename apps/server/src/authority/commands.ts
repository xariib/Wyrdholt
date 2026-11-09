import { FORGE_V1 } from "@emberbound/game-content";
import { applyCommand, canonicalJson, cloneProfile, settleOffline, sha256Hex, upgradeClassGearIfSafe, type Command, type CommandResult, type ContentIndex, type Profile } from "@emberbound/game-core";
import { SLOT_ORDER } from "@emberbound/shared-types";

export type PlayerCommand = Exclude<Command, { type: `dev${string}` | "advance" }>;

type Data = Record<string, unknown>;
const record = (value: unknown): value is Data => Boolean(value && typeof value === "object" && !Array.isArray(value));
const id = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9_-]{1,80}$/i.test(value);
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const positive = (value: unknown): value is number => count(value) && value > 0;
const slot = (value: unknown) => (SLOT_ORDER as readonly unknown[]).includes(value);
const ids = (value: unknown) => Array.isArray(value) && value.length <= 500 && value.every(positive);

export function isPlayerCommand(value: unknown): value is PlayerCommand {
  if (!record(value)) return false;
  const input = value.input;
  switch (value.type) {
    case "startPush":
    case "startFarm": return id(value.zoneId);
    case "startBoss": return positive(value.tier) && typeof value.autoPush === "boolean" && (value.bossId === undefined || id(value.bossId));
    case "equip": return slot(value.slot) && positive(value.instanceId);
    case "setActiveClass": return id(value.classId);
    case "cancelPending": return true;
    case "markReviewed": return ids(value.instanceIds);
    case "setItemLock": return positive(value.instanceId) && typeof value.locked === "boolean";
    case "forge": return record(input) && positive(input.transactionId) && typeof input.configVersion === "string"
      && slot(input.slot) && id(input.rarity) && ids(input.instanceIds) && (input.mode === undefined || input.mode === "configured");
    case "salvage": return record(input) && positive(input.instanceId) && typeof input.rulesVersion === "string" && count(input.expectedGold);
    case "bulkSalvage": return record(input) && count(input.expectedGold) && typeof input.rulesVersion === "string"
      && Array.isArray(input.copies) && input.copies.length <= 500 && input.copies.every(copy => record(copy)
        && positive(copy.instanceId) && id(copy.baseId) && typeof copy.rulesVersion === "string" && count(copy.gold));
    default: return false;
  }
}

export interface CommandEnvelope {
  format: "wyrdholt-command/1";
  requestId: string;
  revision: number;
  command: PlayerCommand | null;
}

export function parseCommandEnvelope(value: unknown): CommandEnvelope | null {
  if (!record(value) || value.format !== "wyrdholt-command/1" || !id(value.requestId) || !count(value.revision)
    || (value.command !== null && !isPlayerCommand(value.command))) return null;
  try {
    const serialized = canonicalJson({ format: value.format, requestId: value.requestId, revision: value.revision, command: value.command });
    return serialized.length <= 65_536 ? JSON.parse(serialized) as CommandEnvelope : null;
  } catch {
    return null;
  }
}

export interface CommandJournalEntry {
  request: CommandEnvelope;
  atMs: number;
  contentHash: string;
  beforeHash: string;
  afterHash: string;
  /** Server entropy for new Forge actions. Older journal entries derive the seed in game-core. */
  forgeSeed?: number;
  result: Extract<CommandResult, { ok: true }>;
}

export function executeAuthorityCommand(content: ContentIndex, before: Profile, request: CommandEnvelope, atMs: number, forgeSeed?: number) {
  if (!Number.isSafeInteger(atMs) || atMs < before.clock.lastSettledWallMs) throw new Error("Authority time moved backwards");
  const profile = cloneProfile(before);
  if (atMs > profile.clock.lastSettledWallMs) settleOffline(profile, content, atMs);
  else upgradeClassGearIfSafe(profile, content);
  const result: CommandResult = request.command === null ? { ok: true, queued: false }
    : applyCommand(profile, content, request.command, { contentTimeMs: atMs, forgeConfig: FORGE_V1, authorityForgeSeed: forgeSeed });
  if (!result.ok) return result;
  const entry: CommandJournalEntry = {
    request, atMs, contentHash: content.longTermHash,
    beforeHash: sha256Hex(canonicalJson(before)), afterHash: sha256Hex(canonicalJson(profile)), result,
    ...(forgeSeed === undefined ? {} : { forgeSeed }),
  };
  return { ok: true as const, profile, entry };
}

/** Recompute the result and state from a trusted prior profile and the journal. */
export function verifyAuthorityReplay(content: ContentIndex, before: Profile, entry: CommandJournalEntry): Profile | null {
  const request = parseCommandEnvelope(entry.request);
  if (!request || entry.contentHash !== content.longTermHash || !Number.isSafeInteger(entry.atMs)
    || entry.atMs < before.clock.lastSettledWallMs || entry.beforeHash !== sha256Hex(canonicalJson(before))) return null;
  const { forgeSeed } = entry;
  if (forgeSeed !== undefined && (request.command?.type !== "forge" || !Number.isInteger(forgeSeed)
    || forgeSeed < 0 || forgeSeed > 0xffffffff)) return null;
  const replayed = executeAuthorityCommand(content, before, request, entry.atMs, forgeSeed);
  return replayed.ok && canonicalJson(replayed.entry) === canonicalJson(entry) ? replayed.profile : null;
}
