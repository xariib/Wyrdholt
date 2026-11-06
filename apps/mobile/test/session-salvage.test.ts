import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FORGE_V1 } from "@emberbound/game-content";
import { advanceAdventure, cloneProfile, createInstance, DEFAULT_SAVE_PATHS as paths, MemorySaveFs, parseSave,
  SALVAGE_RULES_VERSION, serializeSave, simulateOffline, type SalvageInput } from "@emberbound/game-core";
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
  override async write(path: string, text: string) { if (path === paths.temp && this.pause) await this.pause; return super.write(path, text); }
  override async rename(from: string, to: string) { await super.rename(from, to); this.renamed = true; }
  override async read(path: string) { if (this.failReadback && this.renamed && path === paths.main) return "bad readback"; return super.read(path); }
}
const sessions: GameSession[] = [];
async function open(fs: MemorySaveFs) { const s = new GameSession({ fs, ownership: work => work() }); sessions.push(s); await s.init(); return s; }
async function setup() {
  const fs = new ControlledFs(), s = await open(fs);
  expect((await s.createCharacter("Salvage", "monk", "mage")).status).toBe("created");
  const p = s.profile!; p.gold = 500; p.adventure.zones.greenfields!.cleared = true;
  const ids = Array.from({ length: 7 }, () => createInstance(p, "wayfarer_blade", { isNew: true }).id);
  expect((await s.saveNow()).status).toBe("saved");
  const input: SalvageInput = { instanceId: ids[0]!, rulesVersion: SALVAGE_RULES_VERSION, expectedGold: 5 };
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

describe("SALVAGE-008 guarded single-copy settlement", () => {
  it("waits for main readback, blocks duplicate/Forge/lock/equip/dispatch, and reload pays once", async () => {
    const { s, fs, ids, input } = await setup(), before = cloneProfile(s.profile!);
    let release!: () => void; fs.pause = new Promise<void>(r => { release = r; });
    const first = s.salvage(input); for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(s.profile).toEqual(before); expect(s.getSnapshot().busy).toBe("Saving salvage…");
    expect((await s.salvage(input)).ok).toBe(false); expect((await s.setItemLock(ids[1]!, true)).ok).toBe(false);
    expect((await s.forge({ transactionId: 1, configVersion: FORGE_V1.version, slot: "weapon", rarity: "common", instanceIds: ids.slice(0, 5) })).ok).toBe(false);
    expect(s.dispatch({ type: "equip", slot: "weapon", instanceId: ids[1]! }).ok).toBe(false);
    expect(s.dispatch({ type: "salvage", input }).ok).toBe(false);
    s.handleBackground(); vi.setSystemTime(Date.now() + 1000);
    let resumed = false; const resume = s.handleForeground().then(() => { resumed = true; });
    await Promise.resolve(); expect(resumed).toBe(false);
    release(); fs.pause = null; expect(await first).toMatchObject({ ok: true, salvage: { instanceId: ids[0], gold: 5 } }); await resume;
    expect(s.profile!.gold).toBe(before.gold + 5);
    expect(s.profile!.inventory.instances).toEqual(before.inventory.instances.filter(i => i.id !== ids[0]));
    const reloaded = await open(fs), once = cloneProfile(reloaded.profile!);
    expect((await reloaded.salvage(input)).ok).toBe(false); expect(reloaded.profile).toEqual(once);
  });
  it.each(["write", "remove", "rename"] as const)("%s failure shows no success; recovery settles once", async op => {
    const { s, fs, input } = await setup(), before = cloneProfile(s.profile!);
    fs.failAt = { op }; expect((await s.salvage(input)).ok).toBe(false);
    expect(s.profile).toEqual(before); expect(s.getSnapshot().save.gate.mode).toBe("blocked");
    expect((await s.salvage(input)).ok).toBe(false);
    fs.failAt = null; await s.retryStorage(); await s.init();
    expect(s.getSnapshot().phase).toBe("playing");
    if (s.profile!.inventory.instances.some(i => i.id === input.instanceId)) expect((await s.salvage(input)).ok).toBe(true);
    else expect((await s.salvage(input)).ok).toBe(false);
    expect(s.profile!.gold).toBe(before.gold + 5);
    // Rename failure can leave a complete temp save; recovery loads that candidate.
    // A retry is already refused by ownership ID, then normal save restores main.
    expect((await s.saveNow()).status).toBe("saved");
    const parsed = parseSave(fs.files.get(paths.main)!); expect(parsed.ok && parsed.profile.gold).toBe(before.gold + 5);
    const reloaded = await open(fs); expect((await reloaded.salvage(input)).ok).toBe(false); expect(reloaded.profile!.gold).toBe(before.gold + 5);
  });
  it("failed readback blocks acknowledgement even after disk commit; recovery cannot reward again", async () => {
    const { s, fs, input } = await setup(), before = cloneProfile(s.profile!);
    fs.armReadbackFailure(); expect((await s.salvage(input)).ok).toBe(false);
    expect(s.profile).toEqual(before); expect(s.getSnapshot().save.gate.mode).toBe("blocked");
    fs.failReadback = false; const reloaded = await open(fs);
    expect(reloaded.profile!.gold).toBe(before.gold + 5); expect((await reloaded.salvage(input)).ok).toBe(false);
  });
  it("owner change refuses late success while reload reads the committed result", async () => {
    const { s, fs, input } = await setup(), gold = s.profile!.gold;
    let release!: () => void; fs.pause = new Promise<void>(r => { release = r; });
    const first = s.salvage(input); for (let i = 0; i < 20; i++) await Promise.resolve();
    const init = s.init(); release(); fs.pause = null;
    expect((await first).ok).toBe(false); await init;
    expect(s.profile!.gold).toBe(gold + 5); expect((await s.salvage(input)).ok).toBe(false);
    expect(s.getSnapshot().busy).toBeNull();
  });
  it.each(["locked", "equipped", "queued"])("rejects stale %s quote without touching any slot bytes", async kind => {
    const { s, fs, input } = await setup();
    if (kind === "locked") expect((await s.setItemLock(input.instanceId, true)).ok).toBe(true);
    if (kind === "equipped") s.profile!.equipment.weapon = input.instanceId;
    if (kind === "queued") s.profile!.pending = { equipment: { weapon: input.instanceId } };
    const before = cloneProfile(s.profile!), slots = [...fs.files];
    expect((await s.salvage(input)).ok).toBe(false); expect(s.profile).toEqual(before); expect([...fs.files]).toEqual(slots);
  });
  it.each([1200, 12000])("preserves %sms of combat/progression during delayed salvage save", async elapsed => {
    const { s, fs, input } = await setup();
    expect(s.dispatch({ type: "startFarm", zoneId: "greenfields" }).ok).toBe(true);
    const expected = cloneProfile(s.profile!);
    expected.inventory.instances = expected.inventory.instances.filter(i => i.id !== input.instanceId); expected.gold += 5;
    let release!: () => void; fs.pause = new Promise<void>(r => { release = r; });
    const first = s.salvage(input); for (let i = 0; i < 20; i++) await Promise.resolve();
    vi.advanceTimersByTime(elapsed); release(); fs.pause = null; expect((await first).ok).toBe(true);
    if (elapsed <= 5000) advanceAdventure(expected, s.content, elapsed, { offline: false, contentTimeMs: Date.now() });
    else simulateOffline(expected, s.content, elapsed, Date.now());
    vi.mocked(requestAnimationFrame).mock.calls.at(-1)![0](performance.now());
    for (let i = 0; i < 80; i++) await Promise.resolve();
    expect(s.profile!.adventure).toEqual(expected.adventure); expect(s.profile!.character).toEqual(expected.character);
    expect(s.profile!.gold).toBe(expected.gold); expect(s.profile!.inventory).toEqual(expected.inventory);
    expect(s.profile!.clock.lastSettledWallMs).toBe(Date.now());
  });
  it("plain dispatch cannot bypass durable salvage confirmation", async () => {
    const { s, fs, input } = await setup(), before = cloneProfile(s.profile!), slots = [...fs.files];
    expect(s.dispatch({ type: "salvage", input })).toMatchObject({ ok: false, error: expect.stringContaining("confirmation") });
    expect(s.profile).toEqual(before); expect([...fs.files]).toEqual(slots);
    expect(serializeSave(s.profile!, Date.now())).toBe(serializeSave(before, Date.now()));
  });
});
