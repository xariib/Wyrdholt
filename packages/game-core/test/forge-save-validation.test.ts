import { describe, expect, it } from "vitest";
import { FORGE_V1 } from "@emberbound/game-content";
import { createInstance, fuse, MemorySaveFs, loadSaveSafely, parseSave, serializeSave, sha256Hex, DEFAULT_SAVE_PATHS as paths, applyCommand, cloneProfile } from "../src/index";
import { content, newProfile } from "./helpers";

function saved() {
  const p = newProfile(17); p.gold = 1000; p.adventure.zones.greenfields!.cleared = true;
  const instanceIds = Array.from({ length: 5 }, () => createInstance(p, "wayfarer_blade", { isNew: true }).id);
  expect(fuse(p, content, FORGE_V1, { transactionId: 1, configVersion: FORGE_V1.version, slot: "weapon", rarity: "common", instanceIds }, false).ok).toBe(true);
  return serializeSave(p, 1);
}
function changed(mutate: (p: any, e: any) => void) {
  const e = JSON.parse(saved()), p = JSON.parse(e.payload);
  mutate(p, e); e.payload = JSON.stringify(p); e.checksum = sha256Hex(e.payload); return JSON.stringify(e);
}
const malformed: Array<[string, (p: any, e: any) => void]> = [
  ["null state", p => { p.forge = null; }],
  ["unknown version", p => { p.forge.version = 2; }],
  ["counter", p => { p.forge.nextTransactionId = 0; }],
  ["missing receipt", p => { delete p.forge.lastReceipt; }],
  ["null receipt", p => { p.forge.lastReceipt = null; }],
  ["wrong transaction", p => { p.forge.lastReceipt.transactionId = 9; }],
  ["invalid output", p => { p.forge.lastReceipt.outputInstanceId = 0; }],
  ["malformed inputs", p => { p.forge.lastReceipt.consumedIds = null; }],
  ["duplicate inputs", p => { p.forge.lastReceipt.consumedIds[1] = p.forge.lastReceipt.consumedIds[0]; }],
  ["receipt key", p => { p.forge.lastReceipt.inputKey = "different"; }],
  ["invalid slot", p => { p.forge.lastReceipt.slot = "invalid"; }],
  ["invalid cost", p => { p.forge.lastReceipt.gold = -1; }],
  ["invalid mode", p => { p.forge.lastReceipt.mode = "always-win"; }],
  ["invalid dev unlock", p => { p.forge.devUnlocked = "yes"; }],
  ["invalid dev ids", p => { p.forge.devItemIds = [0]; }],
  ["schema 2 without Forge", p => { delete p.forge; }],
  ["Forge hidden in schema 1", (_p, e) => { e.schema = 1; }],
];
describe("persisted Forge state", () => {
  it("accepts the complete bounded receipt and preserves its bytes on reload", () => {
    const text = saved(), parsed = parseSave(text); expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(serializeSave(parsed.profile, 1)).toBe(text);
  });
  it.each(malformed)("rejects checksum-valid %s without throwing or touching slots", async (_name, mutate) => {
    const text = changed(mutate); expect(() => parseSave(text)).not.toThrow(); expect(parseSave(text).ok).toBe(false);
    const fs = new MemorySaveFs(); fs.files.set(paths.main, text);
    const before = [...fs.files]; expect((await loadSaveSafely(fs)).status).toBe("corrupt"); expect([...fs.files]).toEqual(before);
  });
  it("invalid DEV grants leave schema, state, counters and gold unchanged", () => {
    const p = newProfile(), before = cloneProfile(p);
    expect(applyCommand(p, content, { type: "devForge", action: "grant", slot: "weapon", rarity: "unknown" }, { contentTimeMs: 0, forgeConfig: FORGE_V1, allowDevForge: true }).ok).toBe(false);
    expect(p).toEqual(before);
  });
});
