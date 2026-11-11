import { describe, expect, it } from "vitest";
import { DEFAULT_SAVE_PATHS, MemorySaveFs, loadSaveSafely, parseSave, serializeSave, sha256Hex, writeSaveSafely, type Profile } from "@emberbound/game-core";
import { newProfile } from "./helpers";

function oldSave(profile: Profile, change: (p: any) => void = () => {}, savedAt = 123) {
  const envelope = JSON.parse(serializeSave(profile, savedAt));
  const payload = JSON.parse(envelope.payload);
  payload.schema = 6;
  payload.hunts = { version: 1, progressMs: 1000, nextDiscoveryId: 2, queue: [], completed: 1, active: null, lastResult: null };
  change(payload);
  envelope.schema = 6;
  envelope.payload = JSON.stringify(payload);
  envelope.checksum = sha256Hex(envelope.payload);
  return JSON.stringify(envelope);
}

describe("retired Android 0.5.0 save compatibility", () => {
  it.each([1, 2, 3, 4, 5])("preserves all surviving progress and rewards for schema %i", schema => {
    const p = newProfile(1042);
    p.schema = schema; p.gold = 9876;
    p.pending = { activeClassId: "mage", equipment: { ring: null } };
    const ladder = { version: 1 as const, highestClearedTier: 1, attemptCount: 1, active: null,
      lastResult: { tier: 1, outcome: "victory" as const, enemyHp100: 0, enemyMaxHp100: 100 } };
    if (schema >= 2) p.forge = { version: 1, nextTransactionId: 1 };
    if (schema >= 3) p.itemLocks = { version: 1, lockedInstanceIds: [p.inventory.instances[0]!.id] };
    if (schema >= 4) p.ashenKing = { ...ladder };
    if (schema >= 5) p.longTerm = { version: 1, ladders: { trial_monk: { ...ladder } } };
    const expected = parseSave(serializeSave(p,123));
    const actual = parseSave(oldSave(p));
    expect(expected.ok).toBe(true); expect(actual.ok).toBe(true);
    if (!actual.ok || !expected.ok) return;
    expect(actual.profile).toEqual(expected.profile);
    expect(parseSave(serializeSave(actual.profile,124))).toMatchObject({ ok: true, profile: expected.profile });
  });

  it("retires an unfinished encounter without granting or removing rewards", () => {
    const p = newProfile(); p.gold = 777;
    const result = parseSave(oldSave(p, data => { data.hunts.active = { record: { format: "emberbound-fight-record/4" }, elapsedMs: 2000 }; }));
    const expected = parseSave(serializeSave(p,123));
    expect(result.ok).toBe(true);
    if (result.ok && expected.ok) expect(result.profile).toEqual(expected.profile);
    if (result.ok) expect(result.profile).not.toHaveProperty("hunts");
  });

  it("keeps malformed surviving state, bad checksums and unknown future schemas rejected", () => {
    const p = newProfile();
    expect(parseSave(oldSave(p, data => { delete data.clock; })).ok).toBe(false);
    expect(parseSave(oldSave(p, data => { data.inventory.full = "broken"; })).ok).toBe(false);
    expect(parseSave(oldSave(p, data => { delete data.hunts; }))).toMatchObject({ ok: false, reason: "newer-schema" });
    const raw = JSON.parse(oldSave(p)); raw.checksum = "bad";
    expect(parseSave(JSON.stringify(raw))).toMatchObject({ ok: false, reason: "checksum-mismatch" });
    raw.schema = 7; raw.checksum = sha256Hex(raw.payload);
    expect(parseSave(JSON.stringify(raw))).toMatchObject({ ok: false, reason: "newer-schema" });
  });

  it("loads the newest old save and safely rewrites it without falling back to older progress", async () => {
    const fs = new MemorySaveFs(), p = newProfile();
    fs.files.set(DEFAULT_SAVE_PATHS.backup, serializeSave(p,1));
    p.gold = 999; fs.files.set(DEFAULT_SAVE_PATHS.main, oldSave(p));
    const loaded = await loadSaveSafely(fs);
    expect(loaded.status).toBe("loaded");
    if (loaded.status !== "loaded") return;
    expect(loaded.source).toBe("main"); expect(loaded.result.profile.gold).toBe(999);
    await writeSaveSafely(fs,serializeSave(loaded.result.profile,124));
    const reloaded = await loadSaveSafely(fs);
    expect(reloaded).toMatchObject({ status: "loaded", result: { profile: { gold: 999, schema: 1 } } });
  });
});
