import { describe, expect, it } from "vitest";
import { FORGE_V1 } from "@emberbound/game-content";
import { applyCommand, cloneProfile, createInstance, fuse, parseSave, previewBulkSalvage,
  salvageItems, serializeSave, setItemLock, validateProfile, type BulkSalvageInput } from "../src/index";
import { content, newProfile } from "./helpers";
function fixture() {
  const p = newProfile(1042); p.gold = 500; p.adventure.zones.greenfields!.cleared = true;
  const ids = Array.from({ length: 7 }, () => createInstance(p, "wayfarer_blade", { isNew: true }).id);
  const selected = [ids[1]!, ids[4]!, ...["uncommon", "rare", "epic", "legendary"].map(r =>
    createInstance(p, content.snapshot.items.find(i => i.rarity === r)!.id, { isNew: true }).id)];
  const result = previewBulkSalvage(p, content, selected); if (!result.ok) throw new Error(result.error);
  const input: BulkSalvageInput = { copies: result.bulkSalvage.copies, rulesVersion: result.bulkSalvage.rulesVersion, expectedGold: result.bulkSalvage.gold };
  return { p, ids, selected, input };
}
const command = (p: ReturnType<typeof newProfile>, input: unknown) => applyCommand(p, content,
  { type: "bulkSalvage", input: input as BulkSalvageInput }, { contentTimeMs: 0 });
function reload(p: ReturnType<typeof newProfile>) {
  const result = parseSave(serializeSave(p, 0)); if (!result.ok) throw new Error(result.reason); return result.profile;
}
describe("BULK-SALVAGE-009 exact atomic batch", () => {
  it("quotes read-only and consumes only confirmed IDs with mixed rewards, preserving every unrelated field", () => {
    const { p, selected, input } = fixture(); setItemLock(p, p.inventory.instances[0]!.id, true);
    p.pending = { equipment: { weapon: p.inventory.instances[0]!.id } };
    const before = cloneProfile(p); expect(previewBulkSalvage(p, content, selected).ok).toBe(true); expect(p).toEqual(before);
    expect(input.expectedGold).toBe(375); expect(command(p, input)).toMatchObject({ ok: true, bulkSalvage: { gold: 375 } });
    const expected = cloneProfile(before); expected.gold += 375; expected.inventory.instances = expected.inventory.instances.filter(i => !selected.includes(i.id));
    expect(p).toEqual(expected); expect(validateProfile(p)).toBeNull();
  });
  it.each(["missing", "locked", "equipped", "queued"])("one stale %s copy rejects whole preview/direct/command without mutation", kind => {
    const { p, selected, input } = fixture(), id = selected.at(-1)!;
    if (kind === "missing") p.inventory.instances = p.inventory.instances.filter(i => i.id !== id);
    if (kind === "locked") setItemLock(p, id, true);
    if (kind === "equipped") p.equipment.weapon = id;
    if (kind === "queued") p.pending = { equipment: { weapon: id } };
    const before = structuredClone(p), bytes = serializeSave(p, 0);
    expect(previewBulkSalvage(p, content, selected).ok).toBe(false);
    expect(salvageItems(p, content, input).ok).toBe(false); expect(command(p, input).ok).toBe(false);
    expect(p).toEqual(before); expect(serializeSave(p, 0)).toBe(bytes);
  });
  it.each([null, {}, [], "copies", NaN])("malformed batch %s rejects without mutation", input => {
    const { p } = fixture(), before = cloneProfile(p); expect(command(p, input).ok).toBe(false); expect(p).toEqual(before);
  });
  it.each(["duplicate", "duplicate-inflated", "empty", "null-copy", "invalid-id", "base", "copy-rule", "copy-gold", "total", "rule"])("invalid %s quote rejects without partial reward", kind => {
    const { p, input } = fixture();
    if (kind.startsWith("duplicate")) { input.copies.push({ ...input.copies[0]! }); if (kind === "duplicate-inflated") input.expectedGold += 5; }
    if (kind === "empty") { input.copies = []; input.expectedGold = 0; }
    if (kind === "null-copy") input.copies.push(null as unknown as typeof input.copies[number]);
    if (kind === "invalid-id") input.copies.at(-1)!.instanceId = 1.5;
    if (kind === "base") input.copies.at(-1)!.baseId = "wayfarer_blade";
    if (kind === "copy-rule") input.copies.at(-1)!.rulesVersion = "expired";
    if (kind === "copy-gold") input.copies.at(-1)!.gold = 5;
    if (kind === "total") input.expectedGold = 5;
    if (kind === "rule") input.rulesVersion = "expired";
    const before = cloneProfile(p); expect(command(p, input).ok).toBe(false); expect(p).toEqual(before);
  });
  it.each([Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 374, NaN, -1, 0.5])("Gold overflow/invalid %s is atomic", gold => {
    const { p, input } = fixture(); p.gold = gold; const before = structuredClone(p);
    expect(command(p, input).ok).toBe(false); expect(p).toEqual(before);
  });
  it("accepts exact safe-integer Gold boundary", () => {
    const { p, input } = fixture(); p.gold = Number.MAX_SAFE_INTEGER - 375;
    expect(command(p, input).ok).toBe(true); expect(p.gold).toBe(Number.MAX_SAFE_INTEGER);
  });
  it.each([1, 2, 3])("schema %s reload/retry never selects replacement or repeats reward", schema => {
    const { p, input, selected, ids } = fixture();
    if (schema >= 2) p.forge = { version: 1, nextTransactionId: 1 };
    if (schema === 3) setItemLock(p, ids[0]!, true); p.schema = schema;
    expect(command(p, input).ok).toBe(true); const after = reload(p), once = cloneProfile(after);
    expect(JSON.parse(serializeSave(after, 0)).schema).toBe(schema); expect(command(after, input).ok).toBe(false); expect(after).toEqual(once);
    const replacement = createInstance(after, "wayfarer_blade", { isNew: true }); const beforeRetry = cloneProfile(after);
    expect(command(after, input).ok).toBe(false); expect(after).toEqual(beforeRetry); expect(replacement.id).toBe(once.inventory.nextInstanceId);
    expect(selected.every(id => !after.inventory.instances.some(i => i.id === id))).toBe(true);
  });
  it("preserves Forge output receipts and DEV tracking after batch/retry", () => {
    const { p, ids } = fixture(); const recipe = { transactionId: 1, configVersion: FORGE_V1.version, slot: "weapon" as const, rarity: "common", instanceIds: ids.slice(0, 5) };
    const forged = fuse(p, content, FORGE_V1, recipe); if (!forged.ok) throw new Error(forged.error);
    const id = forged.forge.outputInstanceId, quote = previewBulkSalvage(p, content, [id, ids[5]!]); if (!quote.ok) throw new Error(quote.error);
    p.forge!.devItemIds = [id, ids[5]!, ids[6]!]; const receipt = cloneProfile(p).forge!.lastReceipt;
    expect(command(p, { rulesVersion: quote.bulkSalvage.rulesVersion, copies: quote.bulkSalvage.copies, expectedGold: 20 }).ok).toBe(true);
    expect(p.forge!.lastReceipt).toEqual(receipt); expect(p.forge!.devItemIds).toEqual([ids[6]]);
    const once = cloneProfile(p); expect(fuse(p, content, FORGE_V1, recipe)).toEqual({ ...forged, repeated: true }); expect(p).toEqual(once);
  });
  it("handles an explicitly supplied 6,000-copy batch without changing monotone ID counter", () => {
    const p = newProfile(42), ids = Array.from({ length: 6000 }, () => createInstance(p, "wayfarer_blade", { isNew: true }).id);
    const quote = previewBulkSalvage(p, content, ids); if (!quote.ok) throw new Error(quote.error);
    const next = p.inventory.nextInstanceId, gold = p.gold;
    expect(command(p, { rulesVersion: quote.bulkSalvage.rulesVersion, copies: quote.bulkSalvage.copies, expectedGold: 30000 }).ok).toBe(true);
    expect(p.gold).toBe(gold + 30000); expect(p.inventory.instances.every(i => !ids.includes(i.id))).toBe(true); expect(p.inventory.nextInstanceId).toBe(next);
  });
});
