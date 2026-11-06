import { CONTENT, FORGE_V1 } from "@emberbound/game-content";
import { ContentIndex, createProfile, createInstance, fuse, serializeSave, parseSave, canonicalJson, sha256Hex } from "@emberbound/game-core";
import { SLOT_ORDER, type ForgeMode } from "@emberbound/shared-types";
export function forgeVector(): { count: number; hash: string } {
  const content = new ContentIndex(CONTENT); const receipts = [];
  for (const slot of SLOT_ORDER) for (const rarity of FORGE_V1.rarities.slice(0, 4)) for (const mode of ["normal", "critical", "configured"] as ForgeMode[]) for (const seed of [1, 77, 999]) {
    const p = createProfile(content, { name: "Forge Vector", activeClassId: "monk", alternateClassId: "mage", masterSeed: seed, nowWallMs: 0 });
    p.gold = 50000; p.forge = { version: 1, nextTransactionId: 1, devUnlocked: true };
    const base = CONTENT.items.find(i => i.slot === slot && i.rarity === rarity)!;
    const ids = Array.from({ length: FORGE_V1.recipes[rarity]!.count }, () => createInstance(p, base.id, { isNew: true }).id);
    const input = { transactionId: 1, configVersion: FORGE_V1.version, slot, rarity, mode, instanceIds: ids.reverse() };
    const result = fuse(p, content, FORGE_V1, input, true); if (!result.ok) throw new Error(result.error);
    const loaded = parseSave(serializeSave(p, 1)); if (!loaded.ok) throw new Error(loaded.reason);
    const repeat = fuse(loaded.profile, content, FORGE_V1, input, true); if (!repeat.ok || !repeat.repeated) throw new Error("Replay duplicated");
    receipts.push({ receipt: result.forge, gold: p.gold, save: serializeSave(loaded.profile, 1) });
  }
  return { count: receipts.length, hash: sha256Hex(canonicalJson(receipts)) };
}
