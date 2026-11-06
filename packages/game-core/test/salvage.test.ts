import { describe, expect, it } from "vitest";
import { FORGE_V1 } from "@emberbound/game-content";
import type { ForgeInput } from "@emberbound/shared-types";
import { applyCommand, cloneProfile, createInstance, fuse, parseSave, previewSalvage,
  salvageItem, SALVAGE_RULES_VERSION, serializeSave, setItemLock, validateProfile, type Profile, type SalvageInput } from "../src/index";
import { content, newProfile } from "./helpers";

const input = (instanceId: unknown, expectedGold = 5): SalvageInput => ({ instanceId: instanceId as number, rulesVersion: SALVAGE_RULES_VERSION, expectedGold });
const command = (p: Profile, quote: unknown) => applyCommand(p, content, { type: "salvage", input: quote as SalvageInput }, { contentTimeMs: 0 });
function fixture() {
  const p = newProfile(1042); p.gold = 500; p.adventure.zones.greenfields!.cleared = true;
  const ids = Array.from({ length: 7 }, () => createInstance(p, "wayfarer_blade", { isNew: true }).id);
  return { p, ids };
}
function reload(p: Profile) {
  const parsed = parseSave(serializeSave(p, 0)); expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(parsed.reason); return parsed.profile;
}

describe("SALVAGE-008 approved single-copy rule", () => {
  it.each([["common", 5], ["uncommon", 15], ["rare", 50], ["epic", 100], ["legendary", 200]])("%s gives %s existing Gold", (rarity, gold) => {
    const { p } = fixture();
    const item = content.snapshot.items.find(i => i.rarity === rarity)!;
    const id = createInstance(p, item.id, { isNew: true }).id, before = cloneProfile(p);
    expect(previewSalvage(p, content, id)).toEqual({ ok: true, queued: false,
      salvage: { instanceId: id, baseId: item.id, rulesVersion: SALVAGE_RULES_VERSION, gold } });
    expect(p).toEqual(before);
    expect(command(p, input(id, gold))).toMatchObject({ ok: true, salvage: { instanceId: id, gold } });
    expect(p.gold).toBe(before.gold + gold);
    expect(p.inventory.instances).toEqual(before.inventory.instances.filter(i => i.id !== id));
    expect(p.inventory.nextInstanceId).toBe(before.inventory.nextInstanceId);
    expect(p.character).toEqual(before.character); expect(p.adventure).toEqual(before.adventure);
  });
  it.each(["locked", "equipped", "queued"])("rejects stale %s copies in preview, direct core and commands without mutation", kind => {
    const { p, ids } = fixture(), id = ids[2]!, stale = input(id);
    expect(previewSalvage(p, content, id).ok).toBe(true);
    if (kind === "locked") setItemLock(p, id, true);
    if (kind === "equipped") p.equipment.weapon = id;
    if (kind === "queued") p.pending = { equipment: { weapon: id } };
    const before = cloneProfile(p), bytes = serializeSave(p, 0);
    expect(previewSalvage(p, content, id).ok).toBe(false);
    expect(salvageItem(p, content, stale).ok).toBe(false); expect(command(p, stale).ok).toBe(false);
    expect(p).toEqual(before); expect(serializeSave(p, 0)).toBe(bytes);
    if (kind !== "locked") { setItemLock(p, id, true); setItemLock(p, id, false); expect(command(p, stale).ok).toBe(false); }
  });
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 999999, "7", [7]])("rejects invalid/missing ID %s", id => {
    const { p } = fixture(), before = cloneProfile(p);
    expect(command(p, input(id)).ok).toBe(false); expect(p).toEqual(before);
  });
  it.each([null, {}, { ...input(7), rulesVersion: "old" }, input(7, 999), input(7, NaN)])("rejects malformed/stale quotes %s", quote => {
    const { p } = fixture(), before = cloneProfile(p);
    expect(command(p, quote).ok).toBe(false); expect(p).toEqual(before);
  });
  it.each([Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 4, NaN, -1])("rejects invalid/exhausted Gold %s atomically", gold => {
    const { p, ids } = fixture(); p.gold = gold; const before = structuredClone(p);
    expect(command(p, input(ids[0])).ok).toBe(false); expect(p).toEqual(before);
  });
  it("allows the largest safe Gold result", () => {
    const { p, ids } = fixture(); p.gold = Number.MAX_SAFE_INTEGER - 5;
    expect(command(p, input(ids[0])).ok).toBe(true); expect(p.gold).toBe(Number.MAX_SAFE_INTEGER);
    expect(validateProfile(p)).toBeNull();
  });
  it.each([1, 2, 3])("reload/retry preserves schema %s and pays exactly once, without changing other copies/NEW/IDs/receipts", schema => {
    const { p, ids } = fixture();
    if (schema >= 2) p.forge = { version: 1, nextTransactionId: 1 };
    if (schema === 3) setItemLock(p, ids[1]!, true);
    p.schema = schema; const before = reload(p), quote = input(ids[3]);
    expect(command(p, quote).ok).toBe(true);
    const saved = reload(p), once = cloneProfile(saved);
    expect(JSON.parse(serializeSave(saved, 0)).schema).toBe(schema);
    expect(saved.inventory.instances).toEqual(before.inventory.instances.filter(i => i.id !== ids[3]));
    expect(saved.inventory.nextInstanceId).toBe(before.inventory.nextInstanceId);
    expect(saved.itemLocks).toEqual(before.itemLocks); expect(saved.forge).toEqual(before.forge);
    expect(saved.gold).toBe(before.gold + 5);
    expect(command(saved, quote).ok).toBe(false); expect(saved).toEqual(once);
    const fresh = createInstance(saved, "wayfarer_blade", { isNew: true }); expect(fresh.id).toBe(before.inventory.nextInstanceId);
    expect(command(saved, quote).ok).toBe(false); expect(saved.inventory.instances.some(i => i.id === fresh.id)).toBe(true);
  });
  it("salvages a Forge output while preserving its historical receipt/retry", () => {
    const { p, ids } = fixture();
    const recipe: ForgeInput = { transactionId: 1, configVersion: FORGE_V1.version, slot: "weapon", rarity: "common", instanceIds: ids.slice(0, 5), mode: "normal" };
    const forged = fuse(p, content, FORGE_V1, recipe, true); expect(forged.ok).toBe(true);
    const receipt = cloneProfile(p).forge!.lastReceipt!, beforeGold = p.gold;
    expect(command(p, input(receipt.outputInstanceId, 15)).ok).toBe(true);
    const saved = reload(p), once = cloneProfile(saved);
    expect(saved.gold).toBe(beforeGold + 15); expect(saved.forge!.lastReceipt).toEqual(receipt);
    expect(fuse(saved, content, FORGE_V1, recipe, true)).toEqual({ ...forged, repeated: true });
    expect(command(saved, input(receipt.outputInstanceId, 15)).ok).toBe(false); expect(saved).toEqual(once);
  });
  it("stale salvage and Forge cannot consume the same copy twice in either order", () => {
    for (const first of ["forge", "salvage"]) {
      const { p, ids } = fixture(), quote = input(ids[0]);
      const recipe: ForgeInput = { transactionId: 1, configVersion: FORGE_V1.version, slot: "weapon", rarity: "common", instanceIds: ids.slice(0, 5) };
      if (first === "forge") { expect(fuse(p, content, FORGE_V1, recipe).ok).toBe(true); const once = cloneProfile(p);
        expect(command(p, quote).ok).toBe(false); expect(p).toEqual(once); }
      else { expect(command(p, quote).ok).toBe(true); const once = cloneProfile(p);
        expect(fuse(p, content, FORGE_V1, recipe).ok).toBe(false); expect(p).toEqual(once); }
    }
  });
  it("salvages a DEV copy without changing other DEV IDs or historical state", () => {
    const { p } = fixture(); applyCommand(p, content, { type: "devForge", action: "grant", slot: "weapon", rarity: "common" }, { contentTimeMs: 0, forgeConfig: FORGE_V1, allowDevForge: true });
    const ids = [...p.forge!.devItemIds!]; expect(command(p, input(ids[2])).ok).toBe(true);
    expect(p.forge!.devItemIds).toEqual(ids.filter(id => id !== ids[2])); expect(validateProfile(p)).toBeNull(); expect(reload(p).forge).toEqual(p.forge);
  });
});
