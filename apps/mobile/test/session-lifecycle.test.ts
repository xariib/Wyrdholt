import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { advanceAdventure, isFightActive, cloneProfile, simulateOffline, parseSave, serializeSave, type AdventureEvent } from "@emberbound/game-core";
const files = vi.hoisted(() => new Map<string, string>());
vi.mock("../src/platform/storage", () => ({
  storageDescription: () => "test storage",
  withStorageOwnership: async (work: () => Promise<unknown>) => work(),
  CapacitorSaveFs: class {
    async read(p: string) { return files.get(p) ?? null; }
    async write(p: string, text: string) { files.set(p, text); }
    async remove(p: string) { files.delete(p); }
    async rename(a: string, b: string) { const value = files.get(a); if (value !== undefined) files.set(b, value); files.delete(a); }
  },
}));
vi.mock("../src/platform/device", () => ({ randomSeed: () => 1042, DEV_TOOLS: true }));
vi.mock("../src/platform/perfMonitor", () => ({perfMonitor: {mark: vi.fn(), markStartup: vi.fn(), start: vi.fn(), pause: vi.fn(), recordCatchUp: vi.fn()}}));
vi.mock("../src/game/offlineRunner", () => ({runOfflineCatchUp: vi.fn()}));
import { runOfflineCatchUp } from "../src/game/offlineRunner";
import { GameSession } from "../src/game/session";
const sessions: GameSession[] = [];
async function fresh() { const s = new GameSession(); sessions.push(s); await s.init(); expect((await s.createCharacter("Test", "monk", "mage")).status).toBe("created"); return s; }
function delayCatchUp() {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  vi.mocked(runOfflineCatchUp).mockImplementation(async (profile, elapsed, now) => {
    await gate;
    const copy = cloneProfile(profile);
    const summary = simulateOffline(copy, sessions[0]!.content, elapsed, now);
    return {profile: copy, summary, computeMs: 1, totalMs: 1, mode: "worker"};
  });
  return release;
}
beforeEach(() => { files.clear(); vi.useFakeTimers(); vi.setSystemTime(1800000000000); vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1)); vi.stubGlobal("cancelAnimationFrame", vi.fn()); vi.mocked(runOfflineCatchUp).mockReset(); });
afterEach(async () => { for (const s of sessions.splice(0)) { s.handleBackground(); await s.saveNow(); } vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("session lifecycle races and persistence", () => {
  it.each(["live frame", "background"])("does not replay settled offline time after a clock rollback during %s", async (boundary) => {
    const s = await fresh();
    const settledAt = Date.now();
    vi.setSystemTime(settledAt - 30 * 60_000);
    if (boundary === "live frame") {
      (s as unknown as { advanceLive(profile: NonNullable<GameSession["profile"]>, step: number, wallNow: number, events: AdventureEvent[]): void })
        .advanceLive(s.profile!, 16, Date.now(), []);
    } else s.handleBackground();
    expect(await s.saveNow()).toMatchObject({ status: "saved", savedAtWallMs: settledAt });
    vi.setSystemTime(settledAt);
    const restored = new GameSession(); sessions.push(restored); await restored.init();
    expect(runOfflineCatchUp).not.toHaveBeenCalled();
    expect(restored.getSnapshot().save.loadedFrom).toBe("main");
    expect(restored.profile!.clock.lastSettledWallMs).toBe(settledAt);
    expect(restored.profile!.clock.simulatedMs).toBe(boundary === "live frame" ? 16 : 0);
  });

  it.each([1, 3])("settles every return through the latest timestamp with %i re-background cycles pending", async (cycles) => {
    const s = await fresh(); s.handleBackground(); const initial = cloneProfile(s.profile!);
    vi.setSystemTime(Date.now() + 31 * 60_000);
    const firstReturn = Date.now(); const release = delayCatchUp();
    const requests = [s.handleForeground()];
    for (let n = 0; n < cycles; n++) {
      vi.setSystemTime(Date.now() + 500); s.handleBackground();
      vi.setSystemTime(Date.now() + 30 * 60_000); requests.push(s.handleForeground());
    }
    const latestReturn = Date.now();
    expect(runOfflineCatchUp).toHaveBeenCalledTimes(1);
    release(); await Promise.all(requests);
    const reference = cloneProfile(initial);
    simulateOffline(reference, s.content, firstReturn - initial.clock.lastSettledWallMs, firstReturn);
    reference.clock.lastSettledWallMs = firstReturn;
    simulateOffline(reference, s.content, latestReturn - firstReturn, latestReturn);
    reference.clock.lastSettledWallMs = latestReturn;
    expect(latestReturn - s.profile!.clock.lastSettledWallMs).toBe(0);
    expect(s.profile!.clock.simulatedMs).toBe(reference.clock.simulatedMs);
    expect(s.profile!.character).toEqual(reference.character); // XP, level, all class Mastery
    expect(s.profile!.gold).toBe(reference.gold);
    expect(s.profile!.inventory).toEqual(reference.inventory); // exact IDs, items, NEW state
    expect(new Set(s.profile!.inventory.instances.map(i => i.id)).size).toBe(s.profile!.inventory.instances.length);
    expect(runOfflineCatchUp).toHaveBeenCalledTimes(2);
    await s.saveNow();
    const restored = new GameSession(); sessions.push(restored); await restored.init();
    expect(restored.profile!.clock.lastSettledWallMs).toBe(latestReturn);
    expect(restored.profile!.character).toEqual(reference.character);
    expect(restored.profile!.gold).toBe(reference.gold);
    const savedReference = parseSave(serializeSave(reference, latestReturn));
    if (!savedReference.ok) throw new Error("Reference save did not load");
    expect(restored.profile!.inventory).toEqual(savedReference.profile.inventory); // codec intentionally omits diagnostic provenance
    expect(runOfflineCatchUp).toHaveBeenCalledTimes(2); // reopening must not pay either interval again
  });
  it("shares the startup catch-up owner with later lifecycle returns", async () => {
    const s = await fresh(); s.handleBackground(); await s.saveNow();
    vi.setSystemTime(Date.now() + 31 * 60_000); const firstReturn = Date.now();
    const release = delayCatchUp(); const restored = new GameSession(); sessions.push(restored);
    const startup = restored.init();
    for (let i = 0; i < 40 && !vi.mocked(runOfflineCatchUp).mock.calls.length; i++) await Promise.resolve();
    expect(runOfflineCatchUp).toHaveBeenCalledTimes(1);
    vi.setSystemTime(firstReturn + 500); restored.handleBackground();
    vi.setSystemTime(Date.now() + 30 * 60_000); const latestReturn = Date.now();
    const resume = restored.handleForeground(); release(); await Promise.all([startup, resume]);
    expect(restored.profile!.clock.lastSettledWallMs).toBe(latestReturn);
    expect(runOfflineCatchUp).toHaveBeenCalledTimes(2);
  });
  it("settles the remaining absence when the original worker completed in the background", async () => {
    const s = await fresh(); s.handleBackground(); const initial = cloneProfile(s.profile!);
    vi.setSystemTime(Date.now() + 31 * 60_000); const firstReturn = Date.now();
    const release = delayCatchUp(); const first = s.handleForeground();
    vi.setSystemTime(Date.now() + 500); s.handleBackground();
    release(); await first;
    expect(s.profile!.clock.lastSettledWallMs).toBe(firstReturn);
    vi.setSystemTime(Date.now() + 30 * 60_000); const latestReturn = Date.now(); await s.handleForeground();
    const reference = cloneProfile(initial);
    simulateOffline(reference, s.content, firstReturn - initial.clock.lastSettledWallMs, firstReturn);
    simulateOffline(reference, s.content, latestReturn - firstReturn, latestReturn);
    expect(s.profile!.clock.lastSettledWallMs).toBe(latestReturn);
    expect(s.profile!.character).toEqual(reference.character);
    expect(s.profile!.gold).toBe(reference.gold);
    expect(s.profile!.inventory).toEqual(reference.inventory);
  });

  it("keeps Rare+ drops visible when level, build and zone events arrive together", async () => {
    const s = await fresh();
    const item = s.content.snapshot.items.find(i => i.rarity === "rare")!;
    s.dispatch({type: "devGrant", baseIds: [item.id]});
    const inst = s.profile!.inventory.instances.find(i => i.baseId === item.id)!;
    // Exercise the presentation event boundary without relying on a lucky random drop.
    (s as unknown as {handleEvents(events: AdventureEvent[]): void}).handleEvents([
      {type: "fightSettled",zoneId:"greenfields",stageIndex:9,role:"boss",durationMs:1000,mode:"push",outcome:"victory",xp:1,gold:1,mastery:1,levelsGained:1,itemIds:[inst.id],buildChanged:true},
      {type:"zoneCleared",zoneId:"greenfields",firstClear:true,unlockedZoneIds:["darkwood"],mode:"push"},
    ]);
    expect(s.getSnapshot().toast?.tone).toBe("loot");
    expect(s.getSnapshot().toast?.text).toContain(item.name);
  });
  it("does not restart the clock when catch-up finishes after re-backgrounding", async () => {
    const s = await fresh(); s.handleBackground(); vi.setSystemTime(Date.now() + 7200000);
    const release = delayCatchUp(); const resume = s.handleForeground();
    s.handleBackground(); vi.mocked(requestAnimationFrame).mockClear(); release(); await resume;
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(s.getSnapshot().phase).toBe("playing");
  });
  it("coalesces repeated foreground events while a worker is pending", async () => {
    const s = await fresh(); s.handleBackground(); vi.setSystemTime(Date.now() + 7200000);
    const release = delayCatchUp(); vi.mocked(requestAnimationFrame).mockClear();
    const first = s.handleForeground(); const second = s.handleForeground();
    await Promise.resolve();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(runOfflineCatchUp).toHaveBeenCalledTimes(1);
    release(); await Promise.all([first, second]);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    await s.saveNow();
    const xp = s.profile!.character.xp, gold = s.profile!.gold;
    const restored = new GameSession(); sessions.push(restored); await restored.init();
    expect(restored.profile!.character.xp).toBe(xp); expect(restored.profile!.gold).toBe(gold);
    expect(runOfflineCatchUp).toHaveBeenCalledTimes(1);
    const ids = restored.profile!.inventory.instances.map(i => i.id); expect(new Set(ids).size).toBe(ids.length);
  });
  it("does not run the combat clock after settlement errors", async () => {
    const s = await fresh(); s.handleBackground(); vi.setSystemTime(Date.now() + 7200000);
    vi.mocked(runOfflineCatchUp).mockRejectedValue(new Error("worker and fallback failed"));
    vi.mocked(requestAnimationFrame).mockClear(); await s.handleForeground();
    expect(s.getSnapshot().phase).toBe("error"); expect(requestAnimationFrame).not.toHaveBeenCalled();
  });
  it("persists pending equipment and class changes when immediately backgrounded", async () => {
    const s = await fresh(); for(let i=0;i<100 && !isFightActive(s.profile!);i++) advanceAdventure(s.profile!, s.content, 100, {offline: false, contentTimeMs: Date.now()});
    expect(isFightActive(s.profile!)).toBe(true);
    const item = s.content.snapshot.items.find(i => i.slot === "head" && i.rarity === "rare" && i.classId === "monk")!;
    s.dispatch({type: "devGrant", baseIds: [item.id]});
    const inst = s.profile!.inventory.instances.find(i => i.baseId === item.id)!;
    const equip = s.dispatch({type: "equip", slot: "head", instanceId: inst.id});
    if (!equip.ok) throw new Error(equip.error);
    expect(equip.queued).toBe(true);
    const changeClass = s.dispatch({type: "setActiveClass", classId: "mage"});
    if (!changeClass.ok) throw new Error(changeClass.error);
    expect(changeClass.queued).toBe(true);
    s.handleBackground(); await s.saveNow();
    const restored = new GameSession(); sessions.push(restored); await restored.init();
    expect(restored.profile!.pending).toEqual(s.profile!.pending);
    expect(restored.profile!.adventure.run).toEqual(s.profile!.adventure.run);
    expect(restored.profile!.character.activeClassId).toBe("monk");
  });
});
