import { describe, expect, it } from "vitest";
import {
  DEFAULT_SAVE_PATHS,
  MemorySaveFs,
  canonicalJson,
  cloneProfile,
  encodeProfile,
  loadSaveSafely,
  parseSave,
  reservedInstanceIds,
  rollLoot,
  serializeSave,
  simulateOffline,
  writeSaveSafely,
} from "@emberbound/game-core";
import { clone, content, newProfile, run, setLevel } from "./helpers";

describe("item instances", () => {
  it("assigns unique, increasing ids that survive save/load", () => {
    const p = newProfile(40);
    run(p, { type: "startFarm", zoneId: "greenfields" });
    simulateOffline(p, content, 3_600_000, 0);
    const ids = p.inventory.instances.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
    const loaded = parseSave(serializeSave(p, 1));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.profile.inventory.instances.map((i) => [i.id, i.baseId, i.isNew])).toEqual(
      p.inventory.instances.map((i) => [i.id, i.baseId, i.isNew]),
    );
    expect(loaded.profile.inventory.nextInstanceId).toBe(p.inventory.nextInstanceId);
  });

  it("replaying the same commands reproduces the same instance ids", () => {
    const make = () => {
      const p = newProfile(41);
      setLevel(p, 5);
      run(p, { type: "startPush", zoneId: "greenfields" });
      run(p, { type: "advance", ms: 600_000 });
      return p.inventory.instances.map((i) => `${i.id}:${i.baseId}`);
    };
    expect(make()).toEqual(make());
  });

  it("keeps catalog definition and owned instance separate, with room for per-instance data", () => {
    const p = newProfile(42);
    const inst = p.inventory.instances[0]!;
    inst.rolls = { attack: 2 };
    inst.upgrade = { level: 1 };
    inst.seasonal = { seasonId: "s1", state: { charge: 3 } };
    const loaded = parseSave(serializeSave(p, 1));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.profile.inventory.instances[0]).toMatchObject({ rolls: { attack: 2 }, upgrade: { level: 1 } });
    expect(content.item(inst.baseId).stats).not.toHaveProperty("rolls");
  });

  it("reserves equipped and queued instances", () => {
    const p = newProfile(43);
    const reserved = reservedInstanceIds(p);
    expect(reserved.size).toBe(6);
  });

  it("loot never exceeds the table's max rarity and falls back when a rarity has no eligible items", () => {
    const p = newProfile(44);
    const counts: Record<string, number> = {};
    for (let seed = 0; seed < 3_000; seed += 1) {
      const drop = rollLoot(p, content, "greenfields_boss", 1, seed, { source: "test" });
      if (!drop) continue;
      const rarity = content.item(drop.baseId).rarity;
      counts[rarity] = (counts[rarity] ?? 0) + 1;
    }
    // Level 1: rare items need encounter level 5, so rare rolls fall back to uncommon.
    expect(Object.keys(counts)).toEqual(["uncommon"]);
    const q: Record<string, number> = {};
    for (let seed = 0; seed < 3_000; seed += 1) {
      const drop = rollLoot(p, content, "greenfields_farm", 6, seed, { source: "test" });
      if (drop) q[content.item(drop.baseId).rarity] = (q[content.item(drop.baseId).rarity] ?? 0) + 1;
    }
    expect(q.epic).toBeUndefined();
    // Greenfields stage drops are rare (C1 pacing): about the table chance.
    const chance = content.lootTable("greenfields_farm").dropChanceBp / 10_000;
    const total = Object.values(q).reduce((a, b) => a + b, 0);
    expect(total / 3_000).toBeGreaterThan(chance * 0.5);
    expect(total / 3_000).toBeLessThan(chance * 1.6);
  });
});

describe("saves", () => {
  it("round-trips a profile exactly (versioned envelope, checksum)", () => {
    const p = newProfile(50);
    run(p, { type: "startPush", zoneId: "greenfields" });
    run(p, { type: "advance", ms: 45_000 });
    const text = serializeSave(p, 123);
    const loaded = parseSave(text);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const strip = (x: typeof p) => {
      const c = clone(x);
      for (const i of c.inventory.instances) delete i.provenance;
      return canonicalJson(encodeProfile(c));
    };
    expect(strip(loaded.profile)).toBe(strip(p));
    expect(loaded.envelope.savedAtWallMs).toBe(123);
  });

  it("detects corruption and newer schemas", () => {
    const text = serializeSave(newProfile(51), 1);
    const env = JSON.parse(text);
    env.payload = env.payload.replace('"gold":0', '"gold":999');
    expect(parseSave(JSON.stringify(env))).toEqual({ ok: false, reason: "checksum-mismatch" });
    const newer = JSON.parse(text);
    newer.schema = 99;
    expect(parseSave(JSON.stringify(newer))).toEqual({ ok: false, reason: "newer-schema" });
    expect(parseSave("{not json")).toEqual({ ok: false, reason: "not-json" });
  });

  it("recovers a valid save after a crash at every step of a write", async () => {
    const steps: Array<{ op: "write" | "remove" | "rename"; path?: string }> = [
      { op: "write", path: DEFAULT_SAVE_PATHS.temp },
      { op: "write", path: DEFAULT_SAVE_PATHS.backup },
      { op: "remove", path: DEFAULT_SAVE_PATHS.main },
      { op: "rename", path: DEFAULT_SAVE_PATHS.temp },
    ];
    for (const failAt of steps) {
      const fs = new MemorySaveFs();
      const first = newProfile(52);
      await writeSaveSafely(fs, serializeSave(first, 1));
      const second = clone(first);
      second.gold = 777;
      fs.failAt = failAt;
      await expect(writeSaveSafely(fs, serializeSave(second, 2))).rejects.toThrow(/simulated crash/);
      fs.failAt = null;
      const loaded = await loadSaveSafely(fs);
      expect(loaded.status).toBe("loaded");
      if (loaded.status !== "loaded") continue;
      expect([0, 777]).toContain(loaded.result.profile.gold);
      if (failAt.op !== "write" || failAt.path !== DEFAULT_SAVE_PATHS.temp) {
        // Once the new save was written and verified, it is never lost.
        expect(loaded.result.profile.gold).toBe(777);
      }
    }
  });

  it("falls back to the backup when the main save is corrupt", async () => {
    const fs = new MemorySaveFs();
    await writeSaveSafely(fs, serializeSave(newProfile(53), 1));
    const p2 = newProfile(53);
    p2.gold = 5;
    await writeSaveSafely(fs, serializeSave(p2, 2));
    fs.files.set(DEFAULT_SAVE_PATHS.main, "garbage");
    const loaded = await loadSaveSafely(fs);
    expect(loaded.status).toBe("loaded");
    if (loaded.status === "loaded") {
      expect(loaded.source).toBe("backup");
      expect(loaded.problems.join()).toContain("main");
    }
  });

  it("keeps large inventories compact", () => {
    const p = newProfile(54);
    for (let i = 0; i < 5_000; i += 1) run(p, { type: "devGrant", baseIds: [i % 2 ? "briar_edge" : "linen_hood"] });
    const text = serializeSave(p, 1);
    expect(text.length).toBeLessThan(80_000);
  });
});

describe("cloneProfile (WebView 97 has no structuredClone)", () => {
  it("is an independent copy that simulates exactly like the original", () => {
    const p = newProfile(77);
    run(p, { type: "startPush", zoneId: "greenfields" });
    simulateOffline(p, content, 1_800_000, 0);
    const a = cloneProfile(p);
    const b = structuredClone(p);
    expect(canonicalJson(a)).toBe(canonicalJson(p));
    a.gold += 1;
    expect(p.gold).toBe(b.gold);
    a.gold -= 1;
    const sa = simulateOffline(a, content, 3_600_000, 1_800_000);
    const sb = simulateOffline(b, content, 3_600_000, 1_800_000);
    expect(canonicalJson(sa)).toBe(canonicalJson(sb));
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });
});
