import { describe, it, expect } from "vitest";
import { CONTENT, FORGE_V1 } from "@emberbound/game-content";
import { ContentIndex, createInstance, fuse, forgeCeiling, eligibleForgeIds, cloneProfile, serializeSave, parseSave, MemorySaveFs, writeSaveSafely, loadSaveSafely, advanceAdventure, applyCommand } from "../src/index";
import type { ForgeInput } from "@emberbound/shared-types";
import { newProfile, content, withLegacyStarterGear } from "./helpers";
function setup(rarity = "common", slot = "weapon") {
  const p = newProfile(123); p.gold = 50000; p.forge = { version: 1, nextTransactionId: 1, devUnlocked: true };
  const base = CONTENT.items.find(i => i.rarity === rarity && i.slot === slot)!;
  const count = FORGE_V1.recipes[rarity]?.count ?? 1;
  const ids = Array.from({ length: count }, () => createInstance(p, base.id, { isNew: true }).id);
  const input: ForgeInput = { transactionId: 1, configVersion: FORGE_V1.version, rarity, slot: base.slot, instanceIds: ids, mode: "normal" };
  return { p, input };
}
function rejected(s: ReturnType<typeof setup>) { const before = cloneProfile(s.p); expect(fuse(s.p, content, FORGE_V1, s.input, true).ok).toBe(false); expect(s.p).toEqual(before); }
describe("Forge V1 authoritative transaction", () => {
  it.each(["common", "uncommon", "rare", "epic"])("valid %s recipe consumes exact inputs, Gold once and creates +1", rarity => {
    const { p, input } = setup(rarity); const expectedId = p.inventory.nextInstanceId;
    const spare = createInstance(p, content.item(p.inventory.instances.at(-1)!.baseId).id, { isNew: false });
    const result = fuse(p, content, FORGE_V1, input, true); expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.forge.outputRarity).toBe(FORGE_V1.rarities[FORGE_V1.rarities.indexOf(rarity) + 1]);
    expect(result.forge.outputInstanceId).toBe(expectedId + 1); expect(result.forge.critical).toBe(false);
    expect(p.gold).toBe(50000 - FORGE_V1.recipes[rarity]!.gold);
    expect(input.instanceIds.every(id => !p.inventory.instances.some(i => i.id === id))).toBe(true);
    expect(p.inventory.instances.some(i => i.id === spare.id)).toBe(true);
    const item = p.inventory.instances.at(-1)!; expect(item.isNew).toBe(true); expect(content.item(item.baseId).slot).toBe(input.slot);
    const once = cloneProfile(p); expect(fuse(p, content, FORGE_V1, input, true)).toEqual({ ...result, repeated: true }); expect(p).toEqual(once);
  });
  it("rejects four Common copies and duplicate input IDs", () => { const s = setup(); s.input.instanceIds.pop(); rejected(s); const t = setup(); t.input.instanceIds[1] = t.input.instanceIds[0]!; rejected(t); });
  it("rejects mixed slots", () => { const s = setup(); s.input.instanceIds[0] = createInstance(s.p, "linen_hood", { isNew: true }).id; rejected(s); });
  it("rejects mixed rarities", () => { const s = setup(); s.input.instanceIds[0] = createInstance(s.p, "briar_edge", { isNew: true }).id; rejected(s); });
  it("accepts different names within slot/rarity without relying on input order", () => {
    const s = setup(); const snapshot = JSON.parse(JSON.stringify(CONTENT)) as typeof CONTENT;
    snapshot.items.push({ ...snapshot.items.find(i => i.id === "wayfarer_blade")!, id: "test_second_common", name: "Another Common Weapon" });
    const c = new ContentIndex(snapshot); s.p.inventory.instances.find(i => i.id === s.input.instanceIds[0])!.baseId = "test_second_common";
    const other = cloneProfile(s.p); expect(fuse(s.p, c, FORGE_V1, s.input, true)).toEqual(fuse(other, c, FORGE_V1, { ...s.input, instanceIds: [...s.input.instanceIds].reverse() }, true));
  });
  it.each(["equipped", "queued"])("protects %s copies", kind => { const s = setup(); if (kind === "equipped") s.p.equipment.weapon = s.input.instanceIds[0]!; else s.p.pending = { equipment: { weapon: s.input.instanceIds[0]! } }; expect(eligibleForgeIds(s.p, content, "weapon", "common")).not.toContain(s.input.instanceIds[0]); rejected(s); });
  it("rejects insufficient Gold", () => { const s = setup(); s.p.gold = 99; rejected(s); });
  it("rejects malformed IDs and transaction counters without mutation", () => {
    for (const invalid of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      const s = setup(); s.input.instanceIds[0] = invalid; rejected(s);
      const t = setup(); t.input.transactionId = invalid; rejected(t);
    }
  });
  it("rejects an old confirmation after another successful transaction", () => {
    const s = setup(); expect(fuse(s.p, content, FORGE_V1, s.input, true).ok).toBe(true);
    const ids = Array.from({ length: 5 }, () => createInstance(s.p, "wayfarer_blade", { isNew: true }).id);
    expect(fuse(s.p, content, FORGE_V1, { ...s.input, transactionId: 2, instanceIds: ids }, true).ok).toBe(true);
    rejected(s);
  });
  it.each(["common", "uncommon", "rare"])("forced critical %s gives +2", rarity => { const { p, input } = setup(rarity); const r = fuse(p, content, FORGE_V1, { ...input, mode: "critical" }, true); expect(r.ok && r.forge.critical).toBe(true); expect(r.ok && r.forge.outputRarity).toBe(FORGE_V1.rarities[FORGE_V1.rarities.indexOf(rarity) + 2]); });
  it("caps Epic at Legendary; Legendary cannot fuse", () => { const { p, input } = setup("epic"); const r = fuse(p, content, FORGE_V1, { ...input, mode: "critical" }, true); expect(r.ok && r.forge.outputRarity).toBe("legendary"); expect(r.ok && r.forge.critical).toBe(false); rejected(setup("legendary")); });
  it("uses progression clears and caps critical at unlocked output", () => { const s = setup("uncommon"); delete s.p.forge; expect(forgeCeiling(s.p, FORGE_V1)).toBe(-1); rejected(s); s.p.adventure.zones.greenfields!.cleared = true; expect(forgeCeiling(s.p, FORGE_V1)).toBe(2); const r = fuse(s.p, content, FORGE_V1, { ...s.input, mode: "critical" }, true); expect(r.ok && r.forge.outputRarity).toBe("rare"); expect(r.ok && r.forge.critical).toBe(false); s.p.adventure.zones.darkwood!.cleared = true; expect(forgeCeiling(s.p, FORGE_V1)).toBe(3); s.p.adventure.zones.ashen_mountains!.cleared = true; expect(forgeCeiling(s.p, FORGE_V1)).toBe(4); });
  it("configured outcome and PRNG replay are deterministic", () => { const a = setup("rare"), b = cloneProfile(a.p); const input = { ...a.input, mode: "configured" as const }; expect(fuse(a.p, content, FORGE_V1, input)).toEqual(fuse(b, content, FORGE_V1, { ...input, instanceIds: [...input.instanceIds].reverse() })); expect(a.p).toEqual(b); });
  it("configured 100% and 0% test odds follow the authoritative PRNG path", () => { for (const bp of [0, 10000]) { const s = setup(); const cfg = JSON.parse(JSON.stringify(FORGE_V1)); cfg.recipes.common.criticalBp = bp; const r = fuse(s.p, content, cfg, { ...s.input, mode: "configured" }); expect(r.ok && r.forge.critical).toBe(bp === 10000); } });
  it("rejects forced production outcomes, future tx, stale config and missing output", () => { const s = setup(); expect(fuse(s.p, content, FORGE_V1, s.input).ok).toBe(false); s.input.transactionId = 2; rejected(s); s.input.transactionId = 1; s.input.configVersion = "old"; rejected(s); const t = setup(); const snap = { ...CONTENT, items: CONTENT.items.filter(i => i.rarity !== "uncommon") }; const before = cloneProfile(t.p); expect(fuse(t.p, new ContentIndex(snap), FORGE_V1, t.input, true).ok).toBe(false); expect(t.p).toEqual(before); });
  it("schema1 remains byte-compatible; Forge schema2 round trips and deduplicates", () => { const old = newProfile(); expect(JSON.parse(serializeSave(old, 1)).schema).toBe(1); expect(parseSave(serializeSave(old, 1)).ok).toBe(true); const s = setup(); const result = fuse(s.p, content, FORGE_V1, s.input, true); const saved = serializeSave(s.p, 10); expect(JSON.parse(saved).schema).toBe(2); const reloaded = parseSave(saved); expect(reloaded.ok).toBe(true); if (!reloaded.ok) return; const before = cloneProfile(reloaded.profile); expect(fuse(reloaded.profile, content, FORGE_V1, s.input, true)).toEqual({ ...result, repeated: true }); expect(reloaded.profile).toEqual(before); advanceAdventure(reloaded.profile, content, 60000, { contentTimeMs: 0, offline: true }); expect(reloaded.profile.forge).toEqual(before.forge); expect(new Set(reloaded.profile.inventory.instances.map(i => i.id)).size).toBe(reloaded.profile.inventory.instances.length); });
  it.each(["write", "remove", "rename"] as const)("crash during %s recovers a complete pre/post transaction", async op => {
    const s = setup(); const fs = new MemorySaveFs(); await writeSaveSafely(fs, serializeSave(s.p, 1)); const before = cloneProfile(s.p); fuse(s.p, content, FORGE_V1, s.input, true); fs.failAt = { op }; await expect(writeSaveSafely(fs, serializeSave(s.p, 2))).rejects.toThrow(); fs.failAt = null; const loaded = await loadSaveSafely(fs); expect(loaded.status).toBe("loaded"); if (loaded.status !== "loaded") return;
    const p = loaded.result.profile, completed = !!p.forge?.lastReceipt;
    expect(p.gold).toBe(completed ? s.p.gold : before.gold); expect(p.inventory.instances.map(i => i.id)).toEqual((completed ? s.p : before).inventory.instances.map(i => i.id));
    fuse(p, content, FORGE_V1, s.input, true); expect(p.inventory.instances.map(i => i.id)).toEqual(s.p.inventory.instances.map(i => i.id)); expect(p.gold).toBe(s.p.gold);
  });
  it("DEV grants use real IDs and reset preserves owned/equipped/queued and outputs", () => { const p = withLegacyStarterGear(newProfile()); const options = { contentTimeMs: 0, forgeConfig: FORGE_V1, allowDevForge: true }; applyCommand(p, content, { type: "devForge", action: "grant", slot: "weapon", rarity: "common" }, options); const ids = p.forge!.devItemIds!; p.pending = { equipment: { weapon: ids[0]! } }; const owned = p.equipment.weapon; applyCommand(p, content, { type: "devForge", action: "reset" }, options); expect(p.inventory.instances.some(i => i.id === owned)).toBe(true); expect(p.inventory.instances.some(i => i.id === ids[0])).toBe(true); expect(p.inventory.nextInstanceId).toBeGreaterThan(Math.max(...ids)); });
});
