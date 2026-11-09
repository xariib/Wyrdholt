import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FORGE_V1 } from "@emberbound/game-content";
import type { ForgeInput } from "@emberbound/shared-types";
import { applyCommand, cloneProfile, createInstance, eligibleForgeIds, fuse, heroStatsFor, isItemLocked,
  parseSave, serializeSave, setItemLock, sha256Hex, simulateOffline, validateProfile } from "../src/index";
import { parseSave as oldParse, serializeSave as oldSerialize } from "./fixtures/schema2-codec";
import { content, newProfile } from "./helpers";

function fixture() {
  const p = newProfile(1042); p.gold = 500; p.adventure.zones.greenfields!.cleared = true;
  const ids = Array.from({ length: 6 }, () => createInstance(p, "wayfarer_wraps", { isNew: true }).id);
  const input: ForgeInput = { transactionId: 1, configVersion: FORGE_V1.version, slot: "weapon", rarity: "common", instanceIds: ids.slice(0, 5) };
  return { p, ids, input };
}
const command = (p: ReturnType<typeof newProfile>, instanceId: number, locked: boolean) =>
  applyCommand(p, content, { type: "setItemLock", instanceId, locked }, { contentTimeMs: 0 });
function reload(p: ReturnType<typeof newProfile>) {
  const parsed = parseSave(serializeSave(p, 0)); expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(parsed.reason); return parsed.profile;
}

describe("ITEM-LOCKS-007 exact-copy protection", () => {
  it("locks only the requested identical copy, sorted/idempotent and without reviewing NEW", () => {
    const { p, ids } = fixture(), before = cloneProfile(p);
    expect(command(p, ids[3]!, true).ok).toBe(true);
    expect(command(p, ids[1]!, true).ok).toBe(true);
    expect(p.itemLocks).toEqual({ version: 1, lockedInstanceIds: [ids[1], ids[3]] });
    expect(p.inventory).toEqual(before.inventory); expect(p.equipment).toEqual(before.equipment);
    expect(p.schema).toBe(3); const once = cloneProfile(p);
    expect(command(p, ids[1]!, true).ok).toBe(true); expect(p).toEqual(once);
    expect(isItemLocked(p, ids[0]!)).toBe(false);
    expect(command(p, ids[1]!, false).ok).toBe(true); expect(command(p, ids[3]!, false).ok).toBe(true);
    expect(reload(p).itemLocks).toEqual({ version: 1, lockedInstanceIds: [] });
    expect(JSON.parse(serializeSave(p, 0)).schema).toBe(3);
  });
  it("unlocking a never-locked copy does not upgrade old saves", () => {
    const { p, ids } = fixture(), before = cloneProfile(p);
    expect(command(p, ids[0]!, false).ok).toBe(true); expect(p).toEqual(before);
    expect(oldSerialize(p, 0)).toBe(serializeSave(p, 0));
  });
  it.each([0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1, 999999])("rejects invalid or unowned ID %s with no mutation", id => {
    const { p } = fixture(), before = cloneProfile(p);
    expect(command(p, id, true).ok).toBe(false); expect(p).toEqual(before);
  });
  it("rejects non-boolean desired state without upgrading", () => {
    const { p, ids } = fixture(), before = cloneProfile(p);
    expect(command(p, ids[0]!, "yes" as unknown as boolean).ok).toBe(false); expect(p).toEqual(before);
  });
  it.each(["equipped", "queued"] as const)("locked %s gear still equips and keeps reservation after unlock", kind => {
    const { p, ids } = fixture(); const id = ids[1]!;
    if (kind === "queued") { applyCommand(p, content, { type: "startFarm", zoneId: "greenfields" }, { contentTimeMs: 0 });
      applyCommand(p, content, { type: "advance", ms: content.snapshot.config.restMs + 1 }, { contentTimeMs: 0 }); }
    const stats = heroStatsFor(p, content);
    setItemLock(p, id, true); expect(heroStatsFor(p, content)).toEqual(stats);
    const equipped = applyCommand(p, content, { type: "equip", slot: "weapon", instanceId: id }, { contentTimeMs: 0 });
    expect(equipped).toMatchObject({ ok: true, queued: kind === "queued" });
    expect(kind === "queued" ? p.pending?.equipment?.weapon : p.equipment.weapon).toBe(id);
    setItemLock(p, id, false);
    expect(eligibleForgeIds(p, content, "weapon", "common")).not.toContain(id);
  });
  it.each(["fuse", "command"] as const)("%s rejects a locked material atomically even with stale eligible selection", route => {
    const { p, ids, input } = fixture(); expect(eligibleForgeIds(p, content, "weapon", "common")).toContain(ids[0]);
    setItemLock(p, ids[0]!, true); const before = cloneProfile(p), bytes = serializeSave(p, 0);
    expect(eligibleForgeIds(p, content, "weapon", "common")).not.toContain(ids[0]);
    const result = route === "fuse" ? fuse(p, content, FORGE_V1, input) : applyCommand(p, content, { type: "forge", input }, { contentTimeMs: 0, forgeConfig: FORGE_V1 });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("locked") });
    expect(p).toEqual(before); expect(serializeSave(p, 0)).toBe(bytes);
    const control = cloneProfile(p); delete control.itemLocks; control.schema = 1;
    setItemLock(p, ids[0]!, false);
    expect(fuse(p, content, FORGE_V1, input)).toEqual(fuse(control, content, FORGE_V1, input));
    expect(p.schema).toBe(3); expect(control.schema).toBe(2);
  });
  it("fuses other identical copies, keeps the locked spare, output ID and historical retry", () => {
    const { p, ids, input } = fixture(); setItemLock(p, ids[5]!, true);
    const result = fuse(p, content, FORGE_V1, input); expect(result.ok).toBe(true);
    if (!result.ok) return;
    const output = result.forge.outputInstanceId; setItemLock(p, output, true);
    const loaded = reload(p), before = cloneProfile(loaded);
    expect(loaded.inventory.instances.find(i => i.id === ids[5])?.isNew).toBe(true);
    expect(loaded.inventory.instances.find(i => i.id === output)?.isNew).toBe(true);
    expect(fuse(loaded, content, FORGE_V1, input)).toEqual({ ...result, repeated: true });
    expect(loaded).toEqual(before); expect(loaded.forge!.lastReceipt!.outputInstanceId).toBe(output);
    expect(loaded.schema).toBe(3);
  });
  it("DEV cleanup preserves locked copies and valid references without downgrading schema", () => {
    const { p } = fixture(); const options = { contentTimeMs: 0, forgeConfig: FORGE_V1, allowDevForge: true };
    applyCommand(p, content, { type: "devForge", action: "grant", slot: "weapon", rarity: "common" }, options);
    const ids = [...p.forge!.devItemIds!]; setItemLock(p, ids[0]!, true);
    applyCommand(p, content, { type: "devForge", action: "reset" }, options);
    expect(p.schema).toBe(3); expect(p.forge!.devItemIds).toEqual([ids[0]]);
    expect(p.inventory.instances.some(i => i.id === ids[0])).toBe(true);
    expect(p.inventory.instances.some(i => i.id === ids[1])).toBe(false);
    expect(validateProfile(p)).toBeNull(); expect(reload(p).itemLocks).toEqual(p.itemLocks);
  });
});

describe("ITEM-LOCKS-007 schema 3 migration and offline", () => {
  it.each([1, 2])("keeps schema %s bytes and identity identical to the frozen PR22 codec", schema => {
    const { p, input } = fixture();
    if (schema === 2) fuse(p, content, FORGE_V1, input);
    const before = cloneProfile(p), text = oldSerialize(p, 123), parsed = parseSave(text);
    expect(parsed.ok).toBe(true); expect(p).toEqual(before);
    if (!parsed.ok) return;
    expect(parsed.profile.itemLocks).toBeUndefined(); expect(parsed.envelope.schema).toBe(schema);
    expect(serializeSave(parsed.profile, 123)).toBe(text);
    expect(parsed.profile.equipment).toEqual(p.equipment); expect(parsed.profile.forge).toEqual(p.forge);
  });
  it("loads legacy schema 1 and upgrades only on explicit first lock", () => {
    const raw = readFileSync(new URL("./fixtures/legacy-schema1.json", import.meta.url), "utf8");
    const old = oldParse(raw), parsed = parseSave(raw); expect(parsed).toEqual(old);
    if (!parsed.ok) throw new Error("Old save rejected");
    const before = cloneProfile(parsed.profile), id = before.inventory.instances[0]!.id;
    expect(command(parsed.profile, id, true).ok).toBe(true);
    expect(parsed.profile.character).toEqual(before.character); expect(parsed.profile.inventory).toEqual(before.inventory);
    expect(parsed.profile.equipment).toEqual(before.equipment); expect(parsed.profile.pending).toEqual(before.pending);
    expect(reload(parsed.profile).itemLocks!.lockedInstanceIds).toEqual([id]);
  });
  it.each([false, true])("roundtrips schema 3 with Forge=%s and old reader refusal", forging => {
    const { p, ids, input } = fixture(); if (forging) fuse(p, content, FORGE_V1, input);
    setItemLock(p, ids[5]!, true); const text = serializeSave(p, 123);
    expect(oldParse(text)).toEqual({ ok: false, reason: "newer-schema" });
    const parsed = parseSave(text); expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(serializeSave(parsed.profile, 123)).toBe(text);
  });
  it("lock metadata does not change offline rewards, pending builds, loot or combat", () => {
    const { p, ids } = fixture(); p.pending = { equipment: { weapon: ids[2]! } };
    applyCommand(p, content, { type: "startFarm", zoneId: "greenfields" }, { contentTimeMs: 0 });
    const control = cloneProfile(p); setItemLock(p, ids[2]!, true); setItemLock(p, ids[4]!, true);
    const a = simulateOffline(p, content, 3600000, 3600000), b = simulateOffline(control, content, 3600000, 3600000);
    expect(a).toEqual(b); expect(p.itemLocks!.lockedInstanceIds).toEqual([ids[2], ids[4]]);
    const loaded = reload(p); delete loaded.itemLocks; loaded.schema = control.schema;
    expect(serializeSave(loaded, 3600000)).toBe(serializeSave(control, 3600000));
  });
  const malformed: Array<[string, (p: any, e: any) => void]> = [
    ["missing domain", p => { delete p.itemLocks; }], ["null", p => { p.itemLocks = null; }],
    ["future domain", p => { p.itemLocks.version = 2; }], ["non-array", p => { p.itemLocks.lockedInstanceIds = {}; }],
    ["duplicate", p => { p.itemLocks.lockedInstanceIds.push(p.itemLocks.lockedInstanceIds[0]); }],
    ["unsorted", p => { p.itemLocks.lockedInstanceIds.reverse(); }], ["string", p => { p.itemLocks.lockedInstanceIds = ["1"]; }],
    ["negative", p => { p.itemLocks.lockedInstanceIds = [-1]; }], ["fraction", p => { p.itemLocks.lockedInstanceIds = [1.5]; }],
    ["unowned", p => { p.itemLocks.lockedInstanceIds = [999999]; }],
    ["wrong payload schema", p => { p.schema = 2; }],
    ["schema 1 downgrade", (_p, e) => { e.schema = 1; }], ["schema 2 downgrade", (_p, e) => { e.schema = 2; }],
  ];
  it.each(malformed)("rejects checksum-valid %s without throwing or dropping locks", (_name, change) => {
    const { p, ids } = fixture(); setItemLock(p, ids[0]!, true); setItemLock(p, ids[1]!, true);
    const e = JSON.parse(serializeSave(p, 123)), payload = JSON.parse(e.payload); change(payload, e);
    e.payload = JSON.stringify(payload); e.checksum = sha256Hex(e.payload); const raw = JSON.stringify(e);
    expect(() => parseSave(raw)).not.toThrow(); expect(parseSave(raw).ok).toBe(false);
  });
});
