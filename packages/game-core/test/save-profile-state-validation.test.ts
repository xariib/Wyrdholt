import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SAVE_PATHS as paths, MemorySaveFs, ContentIndex, advanceAdventure,
  canonicalJson, cloneProfile, encodeProfile, leaveCurrentRun, loadSaveSafely,
  parseSave, serializeSave, sha256Hex, simulateOffline, writeSaveSafely,
  type Profile, type SaveEnvelope,
} from "@emberbound/game-core";
import { clone, content, newProfile, run, setLevel, setMastery, withLegacyStarterGear } from "./helpers";

// Approved SAVE-TRIAGE-02 contract, independent of the private parser helpers.
// Unknown IDs and semantic relationships between fields are deliberately outside it.
type Field = { path: string; kind: string; values?: string[] };
const fields: Field[] = [
  {
    "path": "clock.lastSettledWallMs",
    "kind": "integer"
  },
  {
    "path": "clock.simulatedMs",
    "kind": "counter"
  },
  {
    "path": "stats.fights",
    "kind": "counter"
  },
  {
    "path": "stats.victories",
    "kind": "counter"
  },
  {
    "path": "stats.defeats",
    "kind": "counter"
  },
  {
    "path": "stats.runsStarted",
    "kind": "counter"
  },
  {
    "path": "stats.runsCompleted",
    "kind": "counter"
  },
  {
    "path": "stats.itemsFound",
    "kind": "counter"
  },
  {
    "path": "stats.offlineSettlements",
    "kind": "counter"
  },
  {
    "path": "adventure.activity",
    "kind": "enum",
    "values": [
      "push",
      "farm",
      "idle"
    ]
  },
  {
    "path": "adventure.zoneId",
    "kind": "string"
  },
  {
    "path": "adventure.runCounter",
    "kind": "counter"
  },
  {
    "path": "adventure.zones.<key>.unlocked",
    "kind": "boolean"
  },
  {
    "path": "adventure.zones.<key>.cleared",
    "kind": "boolean"
  },
  {
    "path": "adventure.zones.<key>.bestStage",
    "kind": "counter"
  },
  {
    "path": "adventure.zones.<key>.completions",
    "kind": "counter"
  },
  {
    "path": "adventure.zones.<key>.checkpoint.runIndex",
    "kind": "counter"
  },
  {
    "path": "adventure.zones.<key>.checkpoint.stageIndex",
    "kind": "counter"
  },
  {
    "path": "adventure.zones.<key>.checkpoint.hp100",
    "kind": "hp"
  },
  {
    "path": "adventure.run.zoneId",
    "kind": "string"
  },
  {
    "path": "adventure.run.mode",
    "kind": "enum",
    "values": [
      "push",
      "farm",
      "trail"
    ]
  },
  {
    "path": "adventure.run.runIndex",
    "kind": "counter"
  },
  {
    "path": "adventure.run.stageIndex",
    "kind": "counter"
  },
  {
    "path": "adventure.run.elapsedMs",
    "kind": "counter"
  },
  {
    "path": "adventure.run.restMs",
    "kind": "counter"
  },
  {
    "path": "adventure.run.runElapsedMs",
    "kind": "counter"
  },
  {
    "path": "adventure.run.bestAtStart",
    "kind": "counter"
  },
  {
    "path": "adventure.run.hp100",
    "kind": "hp"
  },
  {
    "path": "adventure.run.phase",
    "kind": "enum",
    "values": [
      "rest",
      "fight"
    ]
  },
  {
    "path": "adventure.run.totals.xp",
    "kind": "counter"
  },
  {
    "path": "adventure.run.totals.gold",
    "kind": "counter"
  },
  {
    "path": "adventure.run.totals.mastery",
    "kind": "counter"
  },
  {
    "path": "adventure.run.totals.items",
    "kind": "counter"
  },
  {
    "path": "adventure.lastResult.kind",
    "kind": "enum",
    "values": [
      "defeat",
      "timeout",
      "cleared"
    ]
  },
  {
    "path": "adventure.lastResult.zoneId",
    "kind": "string"
  },
  {
    "path": "adventure.lastResult.mode",
    "kind": "enum",
    "values": [
      "push",
      "farm",
      "trail"
    ]
  },
  {
    "path": "adventure.lastResult.stage",
    "kind": "positive"
  },
  {
    "path": "adventure.lastResult.stagesTotal",
    "kind": "positive"
  },
  {
    "path": "adventure.lastResult.enemyHp100",
    "kind": "counter"
  },
  {
    "path": "adventure.lastResult.enemyMaxHp100",
    "kind": "counter"
  },
  {
    "path": "adventure.lastResult.enemiesAlive",
    "kind": "counter"
  },
  {
    "path": "adventure.lastResult.heroHp100",
    "kind": "counter"
  },
  {
    "path": "adventure.lastResult.runElapsedMs",
    "kind": "counter"
  },
  {
    "path": "adventure.lastResult.newBest",
    "kind": "boolean"
  },
  {
    "path": "adventure.lastResult.firstClear",
    "kind": "boolean"
  },
  {
    "path": "adventure.lastResult.unlockedZoneIds",
    "kind": "strings"
  },
  {
    "path": "adventure.lastResult.totals.xp",
    "kind": "counter"
  },
  {
    "path": "adventure.lastResult.totals.gold",
    "kind": "counter"
  },
  {
    "path": "adventure.lastResult.totals.mastery",
    "kind": "counter"
  },
  {
    "path": "adventure.lastResult.totals.items",
    "kind": "counter"
  }
];
const containers: string[] = [
  "clock",
  "stats",
  "adventure",
  "adventure.zones",
  "adventure.zones.<key>",
  "adventure.zones.<key>.checkpoint",
  "adventure.run",
  "adventure.run.totals",
  "adventure.lastResult",
  "adventure.lastResult.totals"
];

function active(): Profile {
  const p = newProfile(7314);
  expect(run(p, { type: "startPush", zoneId: "greenfields" }).ok).toBe(true);
  return p;
}
const fighting = active();
advanceAdventure(fighting, content, fighting.adventure.run!.restMs + 50, { offline: false, contentTimeMs: 0 });
const checkpoint = cloneProfile(fighting);
leaveCurrentRun(checkpoint);
const defeated = active();
advanceAdventure(defeated, content, 600_000, { offline: false, contentTimeMs: 0 });
expect(fighting.adventure.run?.phase).toBe("fight");
expect(checkpoint.adventure.zones.greenfields?.checkpoint).not.toBeNull();
expect(defeated.adventure.lastResult?.kind).toBe("defeat");

function baseFor(path: string): Profile {
  return cloneProfile(path.includes("checkpoint") ? checkpoint : path.includes("lastResult") ? defeated : fighting);
}
function set(p: unknown, path: string, value: unknown): void {
  const parts = path.replace("<key>", "greenfields").split(".");
  let target = p as Record<string, any>;
  for (const part of parts.slice(0, -1)) target = target[part];
  const key = parts.at(-1)!;
  if (value === undefined) delete target[key]; else target[key] = value;
}
function textFor(p: Profile, timestamp = 300): string {
  const env = JSON.parse(serializeSave(newProfile(1), timestamp)) as SaveEnvelope;
  // JSON permits malformed payload types that the canonical serializer rejects.
  env.payload = JSON.stringify(encodeProfile(p));
  env.checksum = sha256Hex(env.payload);
  return JSON.stringify(env);
}
function accepts(field: Field, value: unknown): boolean {
  switch (field.kind) {
    case "integer": return Number.isSafeInteger(value);
    case "counter": return Number.isSafeInteger(value) && (value as number) >= 0;
    case "positive": return Number.isSafeInteger(value) && (value as number) > 0;
    case "hp": return value === null || Number.isSafeInteger(value) && (value as number) > 0;
    case "string": return typeof value === "string";
    case "boolean": return typeof value === "boolean";
    case "strings": return Array.isArray(value) && value.every(x => typeof x === "string");
    case "enum": return typeof value === "string" && field.values!.includes(value);
    default: throw new Error("Unknown test field kind");
  }
}
const variants: Array<[string, unknown]> = [
  ["missing", undefined], ["null", null], ["array", []], ["object", {}],
  ["string", "oops"], ["boolean", true], ["fraction", 1.5],
  ["unsafe-integer", Number.MAX_SAFE_INTEGER + 1], ["negative", -1],
  ["zero", 0], ["array-element", [1]], ["mixed-elements", ["zone", null]],
];
const invalid: Array<{ path: string; variant: string; value: unknown }> = [];
for (const path of containers) for (const [variant, value] of variants.slice(0, 6)) {
  if (value === null && ["adventure.run", "adventure.lastResult", "adventure.zones.<key>.checkpoint"].includes(path)) continue;
  // Empty zone maps are valid; every other container needs its mandatory fields.
  if (path === "adventure.zones" && variant === "object") continue;
  if (path === "adventure.zones.<key>" && variant === "missing") continue;
  invalid.push({ path, variant, value });
}
for (const field of fields) for (const [variant, value] of variants) {
  if (!accepts(field, value)) invalid.push({ path: field.path, variant, value });
}
const validBackup = serializeSave(newProfile(9123), 100);

describe("SAVE-TRIAGE-02 unknown-input state gate", () => {
  it("covers the approved 50 leaves and 10 containers", () => {
    expect(fields).toHaveLength(50);
    expect(containers).toHaveLength(10);
  });
  it.each(invalid)("rejects $path / $variant; loads valid backup without mutation", async ({ path, value }) => {
    const p = baseFor(path);
    set(p, path, value);
    const profileBefore = JSON.stringify(p);
    const text = textFor(p);
    const textBefore = sha256Hex(text);
    const parsed = parseSave(text);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    // An empty malformed record fails at a mandatory child; all other reasons
    // identify the exact abstract contract path, never a concrete zone key.
    expect(parsed.reason === `invalid:profile-state:${path}` ||
      parsed.reason.startsWith(`invalid:profile-state:${path}.`)).toBe(true);
    expect(parseSave(text)).toEqual(parsed);
    expect(JSON.stringify(p)).toBe(profileBefore);
    expect(sha256Hex(text)).toBe(textBefore);
    const fs = new MemorySaveFs();
    fs.files.set(paths.main, text);
    fs.files.set(paths.backup, validBackup);
    const before = [...fs.files];
    expect(await loadSaveSafely(fs)).toMatchObject({ status: "loaded", source: "backup" });
    expect([...fs.files]).toEqual(before);
  });
  it.each(fields.filter(f => ["integer", "counter", "positive", "hp"].includes(f.kind)))
    ("rejects JSON numeric overflow at $path", ({ path }) => {
      const p = baseFor(path); set(p, path, "__overflow__");
      const env = JSON.parse(textFor(p)) as SaveEnvelope;
      env.payload = env.payload.replace('"__overflow__"', "1e400");
      env.checksum = sha256Hex(env.payload);
      expect(parseSave(JSON.stringify(env))).toEqual({ ok: false, reason: `invalid:profile-state:${path}` });
    });
  it("uses an abstract diagnostic even for a private zone name", () => {
    const p = newProfile(1);
    Object.assign(p.adventure.zones, { "private-player-content": { unlocked: "secret" } });
    expect(parseSave(textFor(p))).toEqual({ ok: false, reason: "invalid:profile-state:adventure.zones.<key>.unlocked" });
  });
});

function assertRoundTrip(p: Profile, timestamp = 123): void {
  const before = canonicalJson(p);
  const text = serializeSave(p, timestamp);
  const parsed = parseSave(text);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(serializeSave(parsed.profile, timestamp)).toBe(text);
  expect(parsed.profile.clock).toEqual(p.clock);
  expect(parsed.profile.stats).toEqual(p.stats);
  expect(parsed.profile.adventure).toEqual(p.adventure);
  expect(canonicalJson(p)).toBe(before);
}

describe("SAVE-TRIAGE-02 valid compatibility and boundaries", () => {
  it.each([
    ["idle", newProfile(7314)], ["rest", active()], ["fight", fighting],
    ["checkpoint", checkpoint], ["defeat", defeated],
  ] as const)("accepts the legitimate producer state %s", (_name, p) => assertRoundTrip(p));
  it("accepts a produced cleared result and follow-on farm", () => {
    const p = newProfile(13);
    // Controlled compatibility fixture, never pacing evidence or content tuning.
    setLevel(p, 8); setMastery(p, "monk", 10);
    run(p, { type: "startPush", zoneId: "greenfields" });
    for (let i = 0; i < 14_400 && p.adventure.lastResult?.kind !== "cleared"; i++) {
      advanceAdventure(p, content, 250, { offline: false, contentTimeMs: 0 });
    }
    expect(p.adventure.lastResult?.kind).toBe("cleared");
    expect(p.adventure.activity).toBe("farm");
    assertRoundTrip(p);
  });
  it("accepts timeout metadata with zero remaining HP and empty unlocks", () => {
    const p = cloneProfile(defeated);
    Object.assign(p.adventure.lastResult!, { kind: "timeout", heroHp100: 0, enemyHp100: 0,
      enemyMaxHp100: 0, enemiesAlive: 0, unlockedZoneIds: [], newBest: false, firstClear: false });
    assertRoundTrip(p);
  });
  it("accepts a timeout result from the existing test-only combat rules", () => {
    const snapshot = clone(content.snapshot);
    snapshot.zones.find(z => z.id === "greenfields")!.ruleIds = ["test_enemy_tough", "test_enemy_soft"];
    const testContent = new ContentIndex(snapshot);
    const p = withLegacyStarterGear(active()); p.adventure.run!.stageIndex = 9;
    advanceAdventure(p, testContent, 600_000, { offline: false, contentTimeMs: 0 });
    expect(p.adventure.lastResult?.kind).toBe("timeout");
    assertRoundTrip(p);
  });
  it.each(fields.filter(f => f.kind === "enum"))
    ("accepts every defined control value at $path", field => {
      for (const value of field.values!) {
        const p = baseFor(field.path); set(p, field.path, value); assertRoundTrip(p);
      }
    });
  it.each(fields.filter(f => ["integer", "counter", "positive", "hp"].includes(f.kind)))
    ("preserves safe integer boundaries at $path", field => {
      const values = field.kind === "integer" ? [Number.MIN_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER]
        : field.kind === "hp" ? [null, 1, Number.MAX_SAFE_INTEGER]
        : field.kind === "positive" ? [1, Number.MAX_SAFE_INTEGER] : [0, Number.MAX_SAFE_INTEGER];
      for (const value of values) { const p = baseFor(field.path); set(p, field.path, value); assertRoundTrip(p); }
    });
  it.each([-1.5, 0, 123.25])("preserves finite envelope timestamp %s", timestamp => assertRoundTrip(newProfile(1), timestamp));
  it.each([{}, { future_zone: { unlocked: false, cleared: false, bestStage: 0, completions: 0, checkpoint: null } }])
    ("accepts sparse zones %j", zones => { const p = newProfile(1); p.adventure.zones = clone(zones) as Profile["adventure"]["zones"]; assertRoundTrip(p); });
  it("preserves nested unknown extensions without clamping or defaulting", () => {
    const p = cloneProfile(fighting);
    p.adventure.lastResult = cloneProfile(defeated).adventure.lastResult;
    p.adventure.zones.greenfields!.checkpoint = cloneProfile(checkpoint).adventure.zones.greenfields!.checkpoint;
    for (const v of [p, p.clock, p.stats, p.adventure, p.adventure.run!, p.adventure.run!.totals,
      p.adventure.lastResult!, p.adventure.lastResult!.totals, p.adventure.zones.greenfields!, p.adventure.zones.greenfields!.checkpoint!]) {
      Object.assign(v, { futureExtension: { tag: "preserved", n: 4, optional: null } });
    }
    assertRoundTrip(p);
  });
  it.each(["zone", "stage"])("leaves out-of-catalog %s validation outside this gate", kind => {
    const p = cloneProfile(fighting);
    if (kind === "zone") { p.adventure.zoneId = "future_zone"; p.adventure.run!.zoneId = "future_zone"; }
    else p.adventure.run!.stageIndex = 999;
    expect(parseSave(textFor(p)).ok).toBe(true);
    expect(() => advanceAdventure(p, content, 1, { offline: false, contentTimeMs: 0 })).toThrow();
  });
  it("still parses the pinned legacy schema 1 fixture with its unchanged bytes", () => {
    const text = readFileSync(new URL("./fixtures/legacy-schema1.json", import.meta.url), "utf8");
    expect(sha256Hex(text)).toBe("6539d367d50ca966a720c5afef364b2f1205d6382f6b80a68d99a178e085f77a");
    expect(parseSave(text).ok).toBe(true);
  });
});

const representativePaths = ["clock", "adventure", "stats", "stats.offlineSettlements", "adventure.run.totals", "adventure.lastResult.stagesTotal"];
describe("SAVE-TRIAGE-02 safe write regression", () => {
  it.each(representativePaths)("invalid new %s cannot replace main or backup", async path => {
    const p = baseFor(path); set(p, path, undefined);
    const fs = new MemorySaveFs(); const main = serializeSave(newProfile(1), 200);
    fs.files.set(paths.main, main); fs.files.set(paths.backup, validBackup);
    await expect(writeSaveSafely(fs, textFor(p))).rejects.toThrow("Save verification failed; previous save kept.");
    expect(fs.files.get(paths.main)).toBe(main); expect(fs.files.get(paths.backup)).toBe(validBackup);
    // Existing writer writes the invalid temp before verification; no new zero-write claim.
    expect(fs.files.get(paths.temp)).toBe(textFor(p));
  });
  it.each(representativePaths)("valid new skips malformed old %s when backing up", async path => {
    const p = baseFor(path); set(p, path, undefined);
    const fs = new MemorySaveFs(); fs.files.set(paths.main, textFor(p)); fs.files.set(paths.backup, validBackup);
    const next = serializeSave(newProfile(2), 400);
    await writeSaveSafely(fs, next);
    expect(fs.files.get(paths.main)).toBe(next); expect(fs.files.get(paths.backup)).toBe(validBackup);
    expect(fs.files.has(paths.temp)).toBe(false);
  });
  it.each(["remove", "rename"] as const)("keeps recoverable valid temp after %s failure", async op => {
    const p = active(); set(p, "clock", []);
    const fs = new MemorySaveFs(); fs.files.set(paths.main, textFor(p)); fs.files.set(paths.backup, validBackup);
    const next = serializeSave(newProfile(2), 400); fs.failAt = { op };
    await expect(writeSaveSafely(fs, next)).rejects.toThrow("simulated crash"); fs.failAt = null;
    expect(await loadSaveSafely(fs)).toMatchObject({ status: "loaded", source: "temp" });
    expect(fs.files.get(paths.backup)).toBe(validBackup);
  });
});

// Combined PR2/R4 Node contracts: controlled memory storage and queued ownership.
// These fixtures exercise public construction, actual parser/guard/staging and
// source-faithful clone+simulateOffline; they are not native/Web Locks acceptance.
import type { SaveFileAdapter } from "@emberbound/game-core";
import type { SettlementTelemetry } from "../../../apps/mobile/src/game/settlement";
// Typed public view keeps this Node test out of the app's browser type graph.
// The actual computed runtime import still constructs the frozen GameSession.
type NodeSlot = "main" | "temp" | "backup";
type NodeReason = "unsupported" | "corrupt" | "io" | "rules" | "storage-changed" | "ownership" | "profile";
interface NodeGate {
  mode: "uninspected" | "verified-empty" | "writable" | "blocked"; reason?: NodeReason; generation: number;
  slots: readonly { slot: NodeSlot; status: "missing" | "valid" | "unsupported" | "corrupt" | "error"; schema?: number; errorCode?: string }[];
  canCreate: boolean; canImport: boolean; canReset: boolean;
}
type NodeSaved = { status: "saved"; savedAtWallMs: number; bytes: number; mainHash: string; readbackVerified: true; durability: "not-verified" };
type NodeStage = "serialize" | "validate" | "preflight" | "ownership" | "temp-write" | "temp-read"
  | "main-read" | "backup-write" | "main-remove" | "rename" | "main-readback" | "postflight"
  | "stale-commit" | "reset-remove" | "reset-verify" | "profile";
type NodeUnsuccessful = { status: "blocked"; reason: NodeReason; generation: number }
  | { status: "failed"; stage: NodeStage; errorCode?: string; storageMayHaveChanged: boolean }
  | { status: "skipped"; reason: "no-profile" | "stale-generation" };
type NodeAction = { status: "created" | "imported"; receipt: NodeSaved }
  | { status: "reset"; verifiedEmpty: true; generation: number }
  | { status: "rejected"; reason: "invalid" | "busy" | "confirmation" | "not-empty"; message: string } | NodeUnsuccessful;
interface NodeSnapshot {
  phase: "loading" | "create" | "catching-up" | "playing" | "error" | "storage-blocked"; profile: Profile | null;
  save: { lastSavedWallMs: number | null; bytes: number; mainHash: string | null; loadedFrom: string; gate: NodeGate };
  toast: { id: number; text: string; tone: "info" | "loot" | "success" | "warning" } | null;
}
export interface TestSession {
  readonly profile: Profile | null; readonly lastSettlement: SettlementTelemetry | null;
  init(): Promise<void>; getSnapshot(): NodeSnapshot; subscribe(listener: () => void): () => void;
  handleBackground(): void; handleForeground(): Promise<void>; retryStorage(): Promise<NodeGate>;
  readObservedSave(slot: NodeSlot): string | null; saveNow(): Promise<NodeSaved | NodeUnsuccessful>;
  createCharacter(name: string, active: string, alternate: string): Promise<NodeAction>;
  importSave(text: string): Promise<NodeAction>; resetSave(): Promise<NodeAction>;
}
export interface SessionModule { GameSession: new(options: { fs?: SaveFileAdapter; ownership?: TestOwnership }) => TestSession }
type TestOwnership = <T>(work: () => Promise<T>) => Promise<T>;
function queuedTestOwnership(): TestOwnership {
  let tail: Promise<void> = Promise.resolve();
  return <T>(work: () => Promise<T>): Promise<T> => {
    const result = tail.then(work);
    // Release the queue for both outcomes; return the original rejecting result.
    tail = result.then(() => undefined, () => undefined); return result;
  };
}
vi.mock("../../../apps/mobile/src/platform/storage", () => ({
  storageDescription: () => "controlled Node storage", CapacitorSaveFs: MemorySaveFs,
  withStorageOwnership: queuedTestOwnership(),
}));
vi.mock("../../../apps/mobile/src/platform/perfMonitor", () => ({
  perfMonitor: { mark: vi.fn(), markStartup: vi.fn(), start: vi.fn(), pause: vi.fn(), recordCatchUp: vi.fn() },
}));
const runOfflineCatchUp = vi.fn(async (p: Profile, elapsed: number, now: number) => {
  const copy = cloneProfile(p), summary = simulateOffline(copy, content, elapsed, now);
  return { profile: copy, summary, computeMs: 1, totalMs: 1, mode: "main-thread-short" as const };
});
vi.mock("../../../apps/mobile/src/game/offlineRunner", () => ({ runOfflineCatchUp }));
class NodeAuditFs extends MemorySaveFs {
  readonly events: string[] = [];
  override async read(path: string): Promise<string | null> { this.events.push(`read:${path}`); return super.read(path); }
  override async write(path: string, data: string): Promise<void> { this.events.push(`write:${path}`); return super.write(path, data); }
  override async remove(path: string): Promise<void> { this.events.push(`remove:${path}`); return super.remove(path); }
  override async rename(from: string, to: string): Promise<void> { this.events.push(`rename:${from}->${to}`); return super.rename(from, to); }
  mutations(from = 0): string[] { return this.events.slice(from).filter(e => !e.startsWith("read:")); }
}
const sessions: Array<{ s: TestSession; fs: NodeAuditFs }> = [];
const NODE_NOW = 1800000000000;
function nodeSlots(fs: NodeAuditFs): Array<[string, string]> { return [...fs.files].sort((a, b) => a[0].localeCompare(b[0])); }
async function recordNode(kind: string, data: Record<string, unknown>): Promise<void> {
  if (!process.env.SAVE_INTEGRATION_TRACE_DIR) return;
  const { appendFileSync } = await import("node:fs");
  appendFileSync(`${process.env.SAVE_INTEGRATION_TRACE_DIR}/profile-node.jsonl`, JSON.stringify({ kind, ...data }) + "\n");
}
function finiteNumbers(value: unknown): void {
  if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
  else if (Array.isArray(value)) for (const entry of value) finiteNumbers(entry);
  else if (value !== null && typeof value === "object") for (const entry of Object.values(value)) finiteNumbers(entry);
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NODE_NOW);
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1)); vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("__BUILD_ID__", "save-integration-002-fixture-only"); vi.stubGlobal("__BUILD_TIME__", "synthetic");
  vi.stubGlobal("__GIT_COMMIT__", "fixture-only"); vi.stubGlobal("__GIT_BRANCH__", "fixture-only"); vi.stubGlobal("__DEV_TOOLS__", false);
  vi.mocked(runOfflineCatchUp).mockClear();
});
afterEach(async () => {
  for (const { s, fs } of sessions.splice(0)) {
    const start = fs.events.length;
    // Read-only retry drains/pauses before background; cleanup must not write a
    // new save after the action assertions. Record cleanup separately.
    await s.retryStorage(); s.handleBackground();
    expect(fs.mutations(start)).toEqual([]);
    await recordNode("cleanup-read-only", { events: fs.events.slice(start), gate: s.getSnapshot().save.gate });
  }
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
});
async function nodeSession(fs: NodeAuditFs): Promise<TestSession> {
  const modulePath = new URL("../../../apps/mobile/src/game/session.ts", import.meta.url).href;
  const { GameSession } = await import(/* @vite-ignore */ modulePath) as SessionModule;
  const adapter: SaveFileAdapter = fs;
  const s = new GameSession({ fs: adapter, ownership: queuedTestOwnership() }); sessions.push({ s, fs }); return s;
}
describe("SAVE-TRIAGE-02 Node core fallback and strict app policy", () => {
  const cases = (["clock", "stats", "adventure"] as const).flatMap(root =>
    (["missing", "array"] as const).flatMap(variant => (["main", "temp", "backup"] as const).map(slot => ({ root, variant, slot }))));
  it.each(cases)("separate core/app policies for $root $variant at $slot", async ({ root, variant, slot }) => {
    const bad = active(); set(bad, root, variant === "missing" ? undefined : []);
    const mainProfile = newProfile(111); mainProfile.clock.lastSettledWallMs = NODE_NOW;
    const backupProfile = newProfile(9123); backupProfile.clock.lastSettledWallMs = NODE_NOW;
    const fs = new NodeAuditFs(); fs.files.set(paths.main, serializeSave(mainProfile, 100)); fs.files.set(paths.backup, serializeSave(backupProfile, 90));
    fs.files.set(paths[slot], textFor(bad, 300)); const original = nodeSlots(fs);
    const parsed = parseSave(fs.files.get(paths[slot])!); expect(parsed).toMatchObject({ ok: false, reason: `invalid:profile-state:${root}` });
    const loaded = await loadSaveSafely(fs);
    expect(loaded).toMatchObject({ status: "loaded", source: slot === "main" ? "backup" : "main", problems: [`${slot}: invalid:profile-state:${root}`] });
    if (loaded.status !== "loaded") throw new Error("Core fallback must remain available");
    expect(loaded.result.profile.masterSeed).toBe(slot === "main" ? 9123 : 111); expect(nodeSlots(fs)).toEqual(original); expect(fs.mutations()).toEqual([]);
    const appStart = fs.events.length, s = await nodeSession(fs); await s.init();
    expect(fs.events.slice(appStart)).toEqual([`read:${paths.main}`, `read:${paths.temp}`, `read:${paths.backup}`]);
    expect(s.getSnapshot()).toMatchObject({ phase: "storage-blocked", profile: null, save: { gate: { mode: "blocked", reason: "corrupt", canCreate: false, canImport: false, canReset: false } } });
    expect(s.lastSettlement).toBeNull(); expect(vi.mocked(runOfflineCatchUp)).not.toHaveBeenCalled();
    for (const key of ["main", "temp", "backup"] as const) expect(s.readObservedSave(key)).toBe(fs.files.get(paths[key]) ?? null);
    const before = s.getSnapshot(), publications: Array<ReturnType<TestSession["getSnapshot"]>> = [], off = s.subscribe(() => publications.push(s.getSnapshot()));
    s.handleBackground(); await s.handleForeground(); await s.retryStorage();
    const actions = [await s.saveNow(), await s.createCharacter("No replacement", "monk", "mage"), await s.importSave(serializeSave(mainProfile, 400)), await s.resetSave()];
    off(); expect(actions.every(a => a.status === "blocked")).toBe(true); expect(s.getSnapshot().phase).toBe("storage-blocked");
    expect(publications.every(u => u.profile === null && !["playing", "create", "catching-up"].includes(u.phase))).toBe(true);
    expect(s.profile).toBeNull(); expect(s.lastSettlement).toBeNull(); expect(vi.mocked(runOfflineCatchUp)).not.toHaveBeenCalled();
    expect(nodeSlots(fs)).toEqual(original); expect(fs.mutations(appStart)).toEqual([]); expect(s.getSnapshot().save.mainHash).toBe(before.save.mainHash);
    expect(s.getSnapshot().save.lastSavedWallMs).toBe(before.save.lastSavedWallMs); expect(s.getSnapshot().save.bytes).toBe(before.save.bytes); expect(s.getSnapshot().toast).toBe(before.toast);
    for (const key of ["main", "temp", "backup"] as const) expect(s.readObservedSave(key)).toBe(fs.files.get(paths[key]) ?? null);
    await recordNode(`policy-${root}-${variant}-${slot}`, { original, after: nodeSlots(fs), coreSource: loaded.source, problems: loaded.problems,
      gate: s.getSnapshot().save.gate, actions, appEvents: fs.events.slice(appStart), runnerCalls: vi.mocked(runOfflineCatchUp).mock.calls.length, publications: publications.map(u => ({ phase: u.phase, profile: u.profile })) });
  });
  it("all malformed slots remain core-corrupt and app-blocked, never create", async () => {
    const p = active(); set(p, "clock", undefined); const fs = new NodeAuditFs();
    for (const path of [paths.main, paths.temp, paths.backup]) fs.files.set(path, textFor(p)); const original = nodeSlots(fs);
    expect(await loadSaveSafely(fs)).toMatchObject({ status: "corrupt" }); expect(nodeSlots(fs)).toEqual(original); expect(fs.mutations()).toEqual([]);
    const start = fs.events.length, s = await nodeSession(fs); await s.init();
    expect(s.getSnapshot().phase).toBe("storage-blocked"); expect(s.profile).toBeNull();
    expect(s.getSnapshot().save.gate).toMatchObject({ mode: "blocked", reason: "corrupt", canCreate: false, canImport: false, canReset: false });
    expect((await s.createCharacter("No reset", "monk", "mage")).status).toBe("blocked"); expect((await s.resetSave()).status).toBe("blocked");
    expect(vi.mocked(runOfflineCatchUp)).not.toHaveBeenCalled(); expect(s.lastSettlement).toBeNull(); expect(nodeSlots(fs)).toEqual(original); expect(fs.mutations(start)).toEqual([]);
    await recordNode("all-malformed", { original, after: nodeSlots(fs), gate: s.getSnapshot().save.gate, appEvents: fs.events.slice(start) });
  });
  it("controlled ownership serializes and releases after rejection", async () => {
    const own = queuedTestOwnership(), events: string[] = []; let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const first = own(async () => { events.push("first-enter"); await barrier; events.push("first-reject"); throw new Error("synthetic owner work failure"); });
    const rejected = expect(first).rejects.toThrow("synthetic owner work failure");
    const second = own(async () => { events.push("second-enter"); return 2; });
    await Promise.resolve(); expect(events).toEqual(["first-enter"]); release(); await rejected; expect(await second).toBe(2);
    expect(events).toEqual(["first-enter", "first-reject", "second-enter"]); await recordNode("controlled-ownership", { events, nativeLocks: false });
  });
  it("three documented missing reads allow only explicit typed-created/readback", async () => {
    const fs = new NodeAuditFs(), s = await nodeSession(fs); await s.init();
    expect(fs.events).toEqual([`read:${paths.main}`, `read:${paths.temp}`, `read:${paths.backup}`]); expect(nodeSlots(fs)).toEqual([]); expect(s.profile).toBeNull();
    expect(s.getSnapshot().save.gate).toMatchObject({ mode: "verified-empty", canCreate: true });
    expect(s.getSnapshot().save.gate.slots.map(slot => slot.status)).toEqual(["missing", "missing", "missing"]);
    const start = fs.events.length, result = await s.createCharacter("xarib", "monk", "mage");
    expect(result.status).toBe("created"); if (result.status !== "created") throw new Error("Expected confirmed creation");
    const raw = fs.files.get(paths.main)!; expect(result.receipt).toMatchObject({ readbackVerified: true, durability: "not-verified", mainHash: sha256Hex(raw), bytes: new TextEncoder().encode(raw).length });
    expect(parseSave(raw).ok).toBe(true); expect(s.profile?.character.name).toBe("xarib"); expect(s.getSnapshot().phase).toBe("playing"); finiteNumbers(s.profile);
    await recordNode("explicit-create", { result, raw, events: fs.events.slice(start), gate: s.getSnapshot().save.gate });
  });
  it.each(["main", "backup"] as const)("compatible %s control loads without mutation or NaN", async slot => {
    const fs = new NodeAuditFs(), p = newProfile(81); p.clock.lastSettledWallMs = NODE_NOW; fs.files.set(paths[slot], serializeSave(p, -0.5));
    const original = nodeSlots(fs), s = await nodeSession(fs); await s.init();
    expect(s.getSnapshot()).toMatchObject({ phase: "playing", save: { loadedFrom: slot, gate: { mode: "writable" } } });
    expect(s.profile?.masterSeed).toBe(81); expect(s.profile?.clock.lastSettledWallMs).toBe(NODE_NOW); finiteNumbers(s.profile);
    expect(nodeSlots(fs)).toEqual(original); expect(fs.mutations()).toEqual([]); expect(vi.mocked(runOfflineCatchUp)).not.toHaveBeenCalled();
    await recordNode(`valid-${slot}`, { original, after: nodeSlots(fs), phase: s.getSnapshot().phase, clock: s.profile?.clock, events: fs.events });
  });
  it("valid farming settles init and foreground exactly once with confirmed persistence", async () => {
    const fs = new NodeAuditFs(), p = newProfile(9123); p.clock.lastSettledWallMs = NODE_NOW - 2000;
    expect(run(p, { type: "startFarm", zoneId: "greenfields" }).ok).toBe(true); fs.files.set(paths.main, serializeSave(p, 100));
    const original = nodeSlots(fs), s = await nodeSession(fs); await s.init();
    expect(s.getSnapshot().phase).toBe("playing"); expect(s.profile?.clock.lastSettledWallMs).toBe(NODE_NOW);
    expect(s.profile?.stats.offlineSettlements).toBe(p.stats.offlineSettlements + 1); expect(vi.mocked(runOfflineCatchUp)).toHaveBeenCalledTimes(1);
    const first = parseSave(fs.files.get(paths.main)!); expect(first.ok).toBe(true); if (!first.ok) throw new Error("Expected persisted settlement");
    expect(first.profile.stats.offlineSettlements).toBe(s.profile!.stats.offlineSettlements); expect(s.getSnapshot().save.mainHash).toBe(sha256Hex(fs.files.get(paths.main)!));
    expect(fs.files.get(paths.backup)).toBe(original[0]![1]); const settled = s.profile!.stats.offlineSettlements;
    const beforeBackground = fs.events.length; s.handleBackground(); const background = await s.saveNow();
    expect(background).toMatchObject({ status: "saved", readbackVerified: true }); const backgroundEvents = fs.events.slice(beforeBackground);
    vi.setSystemTime(NODE_NOW + 1000); const beforeForeground = fs.events.length;
    await Promise.all([s.handleForeground(), s.handleForeground()]);
    expect(s.getSnapshot().phase).toBe("playing"); expect(s.profile!.stats.offlineSettlements).toBe(settled + 1); expect(s.profile!.clock.lastSettledWallMs).toBe(NODE_NOW + 1000);
    expect(vi.mocked(runOfflineCatchUp)).toHaveBeenCalledTimes(2); finiteNumbers(s.profile);
    const finalRaw = fs.files.get(paths.main)!, parsed = parseSave(finalRaw); expect(parsed.ok).toBe(true); if (!parsed.ok) throw new Error("Expected confirmed foreground save");
    expect(parsed.profile.stats.offlineSettlements).toBe(settled + 1); expect(parsed.profile.clock.lastSettledWallMs).toBe(NODE_NOW + 1000);
    expect(s.getSnapshot().save.mainHash).toBe(sha256Hex(finalRaw)); const finalSlots = nodeSlots(fs);
    await s.handleForeground(); await s.init(); expect(s.profile!.stats.offlineSettlements).toBe(settled + 1); expect(nodeSlots(fs)).toEqual(finalSlots);
    await recordNode("farming-positive", { original, finalSlots, clock: s.profile!.clock, settlementsBefore: p.stats.offlineSettlements, settlementsAfter: s.profile!.stats.offlineSettlements,
      runnerEntries: vi.mocked(runOfflineCatchUp).mock.calls.map(([value, elapsed, now]) => ({ lastSettled: value.clock.lastSettledWallMs, phase: value.adventure.run?.phase, elapsed, now })),
      background, backgroundEvents, foregroundEvents: fs.events.slice(beforeForeground), savedHash: s.getSnapshot().save.mainHash });
  });
});
