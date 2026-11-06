import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FORGE_V1 } from "@emberbound/game-content";
import { advanceAdventure, cloneProfile, createInstance, DEFAULT_SAVE_PATHS as paths, MemorySaveFs, parseSave, serializeSave, simulateOffline } from "@emberbound/game-core";
import type { ForgeInput } from "@emberbound/shared-types";
vi.mock("../src/platform/device", () => ({ randomSeed: () => 1042, DEV_TOOLS: true }));
vi.mock("../src/platform/perfMonitor", () => ({ perfMonitor: { mark: vi.fn(), markStartup: vi.fn(), start: vi.fn(), pause: vi.fn(), recordCatchUp: vi.fn() } }));
vi.mock("../src/game/offlineRunner", () => ({ runOfflineCatchUp: vi.fn() }));
import { GameSession } from "../src/game/session";
import { runOfflineCatchUp } from "../src/game/offlineRunner";

class ControlledFs extends MemorySaveFs {
  pause: Promise<void> | null = null;
  failReadback = false;
  private renamed = false;
  armReadbackFailure() { this.renamed = false; this.failReadback = true; }
  override async write(path: string, text: string) {
    if (path === paths.temp && this.pause) await this.pause;
    return super.write(path, text);
  }
  override async rename(from: string, to: string) { await super.rename(from, to); this.renamed = true; }
  override async read(path: string) {
    if (this.failReadback && this.renamed && path === paths.main) return "not a valid readback";
    return super.read(path);
  }
}
const sessions: GameSession[] = [];
async function open(fs: MemorySaveFs) {
  const s = new GameSession({ fs, ownership: work => work() }); sessions.push(s); await s.init(); return s;
}
async function setup() {
  const fs = new ControlledFs(), s = await open(fs);
  expect((await s.createCharacter("Locks", "monk", "mage")).status).toBe("created");
  const p = s.profile!; p.gold = 500; p.adventure.zones.greenfields!.cleared = true;
  const ids = Array.from({ length: 6 }, () => createInstance(p, "wayfarer_blade", { isNew: true }).id);
  expect((await s.saveNow()).status).toBe("saved");
  const input: ForgeInput = { transactionId: 1, configVersion: FORGE_V1.version, slot: "weapon", rarity: "common", instanceIds: ids.slice(0, 5), mode: "normal" };
  return { s, fs, ids, input };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1800000000000);
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1)); vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.mocked(runOfflineCatchUp).mockImplementation(async (p, elapsed, now, options) => {
    const content = options?.content ?? sessions.at(-1)!.content;
    const copy = cloneProfile(p), summary = simulateOffline(copy, content, elapsed, now);
    return { profile: copy, summary, computeMs: 0, totalMs: 0, mode: "main-thread" };
  });
});
afterEach(async () => {
  for (const s of sessions.splice(0)) { s.handleBackground(); await s.saveNow(); }
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks();
});

describe("ITEM-LOCKS-007 guarded durable lock commands", () => {
  it.each([1200, 12000])("preserves %sms of combat time across a delayed lock write", async elapsed => {
    const { s, fs, ids } = await setup();
    expect(s.dispatch({ type: "startFarm", zoneId: "greenfields" }).ok).toBe(true);
    const before = cloneProfile(s.profile!);
    let release!: () => void; fs.pause = new Promise<void>(r => { release = r; });
    const lock = s.setItemLock(ids[0]!, true);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    vi.advanceTimersByTime(elapsed);
    release(); fs.pause = null; expect((await lock).ok).toBe(true);
    const expected = cloneProfile(before);
    if (elapsed <= 5000) advanceAdventure(expected, s.content, elapsed, { offline: false, contentTimeMs: Date.now() });
    else simulateOffline(expected, s.content, elapsed, Date.now());
    const frame = vi.mocked(requestAnimationFrame).mock.calls.at(-1)![0];
    frame(performance.now());
    for (let i = 0; i < 80; i++) await Promise.resolve();
    expect(s.profile!.adventure).toEqual(expected.adventure);
    expect(s.profile!.character).toEqual(expected.character);
    expect(s.profile!.gold).toEqual(expected.gold);
    expect(s.profile!.clock.lastSettledWallMs).toBe(Date.now());
    expect(s.profile!.itemLocks!.lockedInstanceIds).toEqual([ids[0]]);
    expect(s.getSnapshot().save.gate.mode).toBe("writable");
  });
  it("waits for main readback, excludes concurrent Forge/lock/equip and preserves exact copy NEW", async () => {
    const { s, fs, ids, input } = await setup(), before = cloneProfile(s.profile!);
    let release!: () => void; fs.pause = new Promise<void>(r => { release = r; });
    const first = s.setItemLock(ids[0]!, true);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(s.profile).toEqual(before); expect(s.getSnapshot().busy).toBe("Saving item lock…");
    expect((await s.forge(input)).ok).toBe(false); expect((await s.setItemLock(ids[1]!, true)).ok).toBe(false);
    expect(s.dispatch({ type: "equip", slot: "weapon", instanceId: ids[1]! }).ok).toBe(false);
    expect(s.dispatch({ type: "setItemLock", instanceId: ids[1]!, locked: true }).ok).toBe(false);
    s.handleBackground(); vi.setSystemTime(Date.now() + 1000);
    let resumed = false; const resume = s.handleForeground().then(() => { resumed = true; });
    await Promise.resolve(); expect(resumed).toBe(false);
    release(); fs.pause = null; expect((await first).ok).toBe(true); await resume;
    expect(s.profile!.itemLocks!.lockedInstanceIds).toEqual([ids[0]]);
    expect(s.profile!.inventory.instances.filter(i => ids.includes(i.id)).every(i => i.isNew)).toBe(true);
    expect((await s.forge(input)).ok).toBe(false); expect(s.profile!.gold).toBe(before.gold);
    const saved = parseSave(fs.files.get(paths.main)!);
    expect(saved.ok && saved.envelope.schema).toBe(3);
    const reloaded = await open(fs); expect(reloaded.profile!.itemLocks).toEqual(s.profile!.itemLocks);
    expect((await reloaded.setItemLock(ids[0]!, false)).ok).toBe(true);
    expect((await reloaded.forge(input)).ok).toBe(true); expect(reloaded.profile!.schema).toBe(3);
  });
  it("a pending Forge prevents late lock mutations from changing the transaction inputs", async () => {
    const { s, fs, ids, input } = await setup();
    let release!: () => void; fs.pause = new Promise<void>(r => { release = r; });
    const first = s.forge(input);
    expect((await s.setItemLock(ids[0]!, true)).ok).toBe(false);
    release(); fs.pause = null; expect((await first).ok).toBe(true);
    expect(s.profile!.itemLocks).toBeUndefined(); expect((await s.setItemLock(ids[0]!, true)).ok).toBe(false);
  });
  it.each(["write", "remove", "rename"] as const)("does not acknowledge lock on %s failure; blocks play until recovery", async op => {
    const { s, fs, ids } = await setup(), before = cloneProfile(s.profile!);
    fs.failAt = { op };
    expect((await s.setItemLock(ids[0]!, true)).ok).toBe(false); expect(s.profile).toEqual(before);
    expect(s.getSnapshot().save.gate.mode).toBe("blocked");
    expect((await s.setItemLock(ids[1]!, true)).ok).toBe(false);
    fs.failAt = null; await s.retryStorage(); await s.init();
    expect(s.getSnapshot().phase).toBe("playing");
    expect((await s.setItemLock(ids[0]!, true)).ok).toBe(true);
    const reloaded = await open(fs); expect(reloaded.profile!.itemLocks!.lockedInstanceIds).toEqual([ids[0]]);
  });
  it("bad main readback cannot publish an unsaved-success lock state", async () => {
    const { s, fs, ids } = await setup(), before = cloneProfile(s.profile!);
    fs.armReadbackFailure();
    expect((await s.setItemLock(ids[0]!, true)).ok).toBe(false); expect(s.profile).toEqual(before);
    expect(s.getSnapshot().save.gate.mode).toBe("blocked");
    fs.failReadback = false; const reloaded = await open(fs);
    expect(reloaded.profile!.itemLocks!.lockedInstanceIds).toEqual([ids[0]]);
  });
  it("owner change refuses late acknowledgement; reload reads the committed lock", async () => {
    const { s, fs, ids } = await setup();
    let release!: () => void; fs.pause = new Promise<void>(r => { release = r; });
    const lock = s.setItemLock(ids[0]!, true);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    const init = s.init(); release(); fs.pause = null;
    expect((await lock).ok).toBe(false); await init;
    expect(s.profile!.itemLocks!.lockedInstanceIds).toEqual([ids[0]]);
    expect(s.getSnapshot().busy).toBeNull();
  });
  it("invalid locks do not mutate any slots or schema", async () => {
    const { s, fs } = await setup(), before = cloneProfile(s.profile!), slots = [...fs.files];
    expect((await s.setItemLock(999999, true)).ok).toBe(false);
    expect(s.profile).toEqual(before); expect([...fs.files]).toEqual(slots);
  });
  it("schema 2 receipt/output identities survive first lock, export/import and offline catch-up", async () => {
    const { s, fs, ids, input } = await setup(); const result = await s.forge(input);
    if (!result.ok || !result.forge) throw new Error("Expected Forge receipt");
    const output = result.forge.outputInstanceId;
    expect(s.profile!.schema).toBe(2);
    expect((await s.setItemLock(output, true)).ok).toBe(true);
    expect((await s.setItemLock(ids[5]!, true)).ok).toBe(true);
    const exported = s.exportSave(), receipt = cloneProfile(s.profile!).forge!.lastReceipt;
    s.handleBackground(); vi.setSystemTime(Date.now() + 60000); await s.handleForeground();
    const reloaded = await open(fs);
    expect(reloaded.profile!.itemLocks!.lockedInstanceIds).toEqual([ids[5], output]);
    expect(reloaded.profile!.forge!.lastReceipt).toEqual(receipt);
    const imported = await open(new MemorySaveFs()); const intent = await imported.prepareImport(exported);
    if (intent.status !== "ready") throw new Error("Expected import intent");
    expect((await imported.importSave(exported, intent.intent)).status).toBe("imported");
    expect(imported.profile!.itemLocks).toEqual(reloaded.profile!.itemLocks);
    expect(imported.profile!.forge!.lastReceipt).toEqual(receipt);
    expect(JSON.parse(serializeSave(imported.profile!, Date.now())).schema).toBe(3);
  });
});
