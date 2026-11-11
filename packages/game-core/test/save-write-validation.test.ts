import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SAVE_PATHS as paths,
  MemorySaveFs,
  loadSaveSafely,
  parseSave,
  serializeSave,
  sha256Hex,
  writeSaveSafely,
  type SaveEnvelope,
} from "@emberbound/game-core";
import { newProfile } from "./helpers";

function fixture(full = false) {
  const profile = newProfile(8201);
  profile.gold = 777;
  profile.pending = { activeClassId: "mage", equipment: { weapon: profile.equipment.weapon!, ring: null } };
  Object.assign(profile, { futureState: { charge: 4 } });
  if (full) Object.assign(profile.inventory.instances[0]!, {
    acquiredSeq: 42, isNew: true, rolls: { attack: 2 }, modifiers: ["test_modifier"],
    upgrade: { level: 2 }, seasonal: { seasonId: "test", state: { charge: 3 } },
    futureState: { charge: 9 },
  });
  return profile;
}

function envelope() { return JSON.parse(serializeSave(fixture(), 123)) as SaveEnvelope; }
function withPayload(payload: unknown): string {
  const env = envelope();
  env.payload = JSON.stringify(payload);
  env.checksum = sha256Hex(env.payload);
  return JSON.stringify(env);
}
function malformedInventory(): string {
  const payload = JSON.parse(envelope().payload);
  payload.inventory.full = "";
  return withPayload(payload);
}

describe("SAVE-001 parser boundaries and compatibility", () => {
  // Captured on unmodified QA base 59817b0; encoder/checksum bytes are unchanged.
  it.each([
    [false, "8e5b9a7e23e359dd351be59acb007d3d8fa78bd8149e0fcc423dd236ecb8cbf3"],
    [true, "34afb88734193ce7fd862b1f680d0c01a3ae858fd818f5a539f405a11b46da34"],
  ] as const)("preserves schema 1 bytes, IDs, pending/equipped and extensions (full=%s)", (full, expectedHash) => {
    const profile = fixture(full);
    // These frozen SAVE-001 hashes pin the old content label as well as the
    // encoder contract. New gameplay content must not recapture their bytes.
    profile.contentVersion = "emberbound-content/0.4.0-c2";
    profile.inventory.instances[0]!.baseId = "wayfarer_blade";
    const text = serializeSave(profile, 123);
    expect(sha256Hex(text)).toBe(expectedHash);
    const parsed = parseSave(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // The pre-existing encoder drops informational provenance from all items.
    // Preserve that established normalization rather than changing save bytes.
    const expected = {
      ...profile,
      inventory: {
        ...profile.inventory,
        instances: profile.inventory.instances.map(({ provenance: _drop, ...item }) => item),
      },
    };
    expect(parsed.profile).toEqual(expected);
    expect(parsed.envelope.schema).toBe(1);
    expect(serializeSave(parsed.profile, 123)).toBe(text);
  });

  it("still accepts the pinned legacy schema 1 fixture without mutating its profile", () => {
    const text = readFileSync(new URL("./fixtures/legacy-schema1.json", import.meta.url), "utf8");
    expect(sha256Hex(text)).toBe("6539d367d50ca966a720c5afef364b2f1205d6382f6b80a68d99a178e085f77a");
    const parsed = parseSave(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const payload = JSON.parse(parsed.envelope.payload);
    expect(parsed.profile.character).toEqual(payload.character);
    expect(parsed.profile.equipment).toEqual(payload.equipment);
    expect(parsed.profile.pending).toEqual(payload.pending);
    expect(parsed.profile.clock).toEqual(payload.clock);
  });

  it.each([7, 99])("rejects future schema %i", (schema) => {
    expect(parseSave(JSON.stringify({ ...envelope(), schema }))).toEqual({ ok: false, reason: "newer-schema" });
  });
  it("keeps the existing unsupported-schema result", () => {
    expect(parseSave(JSON.stringify({ ...envelope(), schema: 0 }))).toEqual({ ok: false, reason: "unsupported-schema" });
  });

  it.each([null, true, 42, "profile", []])("rejects non-object envelope %j without throwing", (value) => {
    expect(parseSave(JSON.stringify(value))).toEqual({ ok: false, reason: "wrong-format" });
  });
  it.each([null, true, 42, "profile", []])("rejects checksum-valid non-object payload %j", (value) => {
    expect(parseSave(withPayload(value))).toEqual({ ok: false, reason: "invalid:profile" });
  });
  it.each(["1", null, 1.5])("rejects incorrectly typed schema %j", (schema) => {
    expect(parseSave(JSON.stringify({ ...envelope(), schema }))).toEqual({ ok: false, reason: "invalid:envelope-schema" });
  });
  it.each(["rulesVersion", "contentVersion"])("rejects non-string envelope %s", (field) => {
    expect(parseSave(JSON.stringify({ ...envelope(), [field]: {} }))).toEqual({ ok: false, reason: "invalid:envelope-version" });
  });

  it.each([
    ["id", "1"], ["baseId", null], ["acquiredSeq", "1"], ["isNew", 1],
  ])("rejects malformed full-item field %s", (field, value) => {
    const payload = JSON.parse(serializeSave(fixture(true), 123)).payload;
    const encoded = JSON.parse(payload);
    encoded.inventory.full[0][field as string] = value;
    expect(parseSave(withPayload(encoded))).toEqual({ ok: false, reason: "invalid:inventory-item" });
  });
  it.each([
    ["string id", [["1"], []]], ["fractional id", [[1.5], []]],
    ["null newId", [[1], [null]]], ["short tuple", [[1]]],
    ["long tuple", [[1], [], []]],
  ])("rejects malformed compact-group elements: %s", (_name, group) => {
    const encoded = JSON.parse(envelope().payload);
    encoded.inventory.groups.wayfarer_blade = group;
    expect(parseSave(withPayload(encoded)).ok).toBe(false);
  });

  it.each(["999999", null, true, [], {}])("rejects invalid timestamp %j", (savedAtWallMs) => {
    expect(parseSave(JSON.stringify({ ...envelope(), savedAtWallMs }))).toEqual({ ok: false, reason: "invalid:saved-at" });
  });
  it("rejects missing and JSON-overflow timestamps", () => {
    const env: Partial<SaveEnvelope> = envelope();
    delete env.savedAtWallMs;
    expect(parseSave(JSON.stringify(env))).toEqual({ ok: false, reason: "invalid:saved-at" });
    const overflow = JSON.stringify(envelope()).replace('"savedAtWallMs":123', '"savedAtWallMs":1e400');
    expect(parseSave(overflow)).toEqual({ ok: false, reason: "invalid:saved-at" });
  });
  it.each([-1.5, 0, 123.25])("preserves existing finite timestamp semantics (%s)", (timestamp) => {
    const parsed = parseSave(serializeSave(fixture(), timestamp));
    expect(parsed.ok && parsed.envelope.savedAtWallMs).toBe(timestamp);
  });

  it("excludes invalid timestamps, reads all candidates without mutation and keeps problems", async () => {
    const fs = new MemorySaveFs();
    fs.files.set(paths.main, JSON.stringify({ ...envelope(), savedAtWallMs: "999999" }));
    fs.files.set(paths.temp, serializeSave(fixture(), 200));
    fs.files.set(paths.backup, serializeSave(fixture(), 300));
    const before = [...fs.files];
    const loaded = await loadSaveSafely(fs);
    expect(loaded).toMatchObject({ status: "loaded", source: "backup", problems: ["main: invalid:saved-at"] });
    expect([...fs.files]).toEqual(before);
  });
});

describe("SAVE-001 write boundaries", () => {
  it.each(["inventory", "timestamp"])("rejects invalid new %s without replacing valid main or backup", async (kind) => {
    const fs = new MemorySaveFs();
    const current = serializeSave(fixture(), 100);
    const backup = serializeSave(fixture(), 50);
    fs.files.set(paths.main, current);
    fs.files.set(paths.backup, backup);
    const bad = kind === "inventory" ? malformedInventory() : JSON.stringify({ ...envelope(), savedAtWallMs: null });
    await expect(writeSaveSafely(fs, bad)).rejects.toThrow("Save verification failed; previous save kept.");
    expect(fs.files.get(paths.main)).toBe(current);
    expect(fs.files.get(paths.backup)).toBe(backup);
    expect(await loadSaveSafely(fs)).toMatchObject({ status: "loaded", source: "main" });
  });

  it("writes valid new data over malformed main without copying corruption over valid backup", async () => {
    const fs = new MemorySaveFs();
    const backup = serializeSave(fixture(), 50);
    const next = serializeSave(fixture(true), 200);
    fs.files.set(paths.main, malformedInventory());
    fs.files.set(paths.backup, backup);
    await writeSaveSafely(fs, next);
    expect(fs.files.get(paths.main)).toBe(next);
    expect(fs.files.get(paths.backup)).toBe(backup);
    expect(fs.files.has(paths.temp)).toBe(false);
  });

  it.each(["remove", "rename"] as const)("recovers valid temp/backup after a %s crash with malformed old main", async (op) => {
    const fs = new MemorySaveFs();
    const backup = serializeSave(fixture(), 50);
    const next = serializeSave(fixture(true), 200);
    fs.files.set(paths.main, malformedInventory());
    fs.files.set(paths.backup, backup);
    fs.failAt = { op };
    await expect(writeSaveSafely(fs, next)).rejects.toThrow("simulated crash");
    fs.failAt = null;
    const before = [...fs.files];
    expect(await loadSaveSafely(fs)).toMatchObject({ status: "loaded", source: "temp", result: { envelope: { savedAtWallMs: 200 } } });
    expect(fs.files.get(paths.backup)).toBe(backup);
    expect([...fs.files]).toEqual(before);
  });

  it("preserves the existing write/verify/backup/remove/rename order for valid saves", async () => {
    const fs = new MemorySaveFs();
    const old = serializeSave(fixture(), 100);
    const next = serializeSave(fixture(true), 200);
    fs.files.set(paths.main, old);
    const operations: string[] = [];
    await writeSaveSafely({
      read: async path => { operations.push(`read:${path}`); return fs.read(path); },
      write: async (path, data) => { operations.push(`write:${path}`); await fs.write(path, data); },
      remove: async path => { operations.push(`remove:${path}`); await fs.remove(path); },
      rename: async (from, to) => { operations.push(`rename:${from}->${to}`); await fs.rename(from, to); },
    }, next);
    expect(operations).toEqual([
      `write:${paths.temp}`, `read:${paths.temp}`, `read:${paths.main}`,
      `write:${paths.backup}`, `remove:${paths.main}`, `rename:${paths.temp}->${paths.main}`,
    ]);
    expect(fs.files.get(paths.main)).toBe(next);
    expect(fs.files.get(paths.backup)).toBe(old);
  });

  it("propagates a main storage read failure while retaining the valid backup and temp", async () => {
    const fs = new MemorySaveFs();
    const backup = serializeSave(fixture(), 50);
    fs.files.set(paths.backup, backup);
    fs.read = async path => {
      if (path === paths.main) throw new Error("synthetic read failure");
      return fs.files.get(path) ?? null;
    };
    await expect(writeSaveSafely(fs, serializeSave(fixture(), 200))).rejects.toThrow("synthetic read failure");
    expect(fs.files.get(paths.backup)).toBe(backup);
    expect(await loadSaveSafely(fs)).toMatchObject({ status: "loaded", source: "temp" });
  });
});
