import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTENT } from "@emberbound/game-content";
import { DEFAULT_SAVE_PATHS as paths, MemorySaveFs, canUseItem, cloneProfile, createInstance, createProfile,
  discoverHunts, parseSave, prepareHuntFight, serializeSave, simulateOffline } from "@emberbound/game-core";
import { GameSession } from "../src/game/session";
import { runOfflineCatchUp } from "../src/game/offlineRunner";

vi.mock("../src/platform/device", () => ({ randomSeed: () => 1042, DEV_TOOLS: true }));
vi.mock("../src/platform/perfMonitor", () => ({ perfMonitor: { mark: vi.fn(), markStartup: vi.fn(), start: vi.fn(), pause: vi.fn(), recordCatchUp: vi.fn() } }));
vi.mock("../src/game/offlineRunner", () => ({ runOfflineCatchUp: vi.fn() }));

class ControlledFs extends MemorySaveFs {
  pause: Promise<void> | null = null;
  failReadback = false;
  renamed = false;
  override async write(path: string, text: string) {
    if (path === paths.temp && this.pause) await this.pause;
    return super.write(path, text);
  }
  override async rename(from: string, to: string) { await super.rename(from, to); this.renamed = true; }
  override async read(path: string) {
    if (path === paths.main && this.renamed && this.failReadback) throw new Error("Injected readback failure");
    return super.read(path);
  }
}
const sessions: GameSession[] = [];
async function open(fs: ControlledFs, seed = false) {
  const session = new GameSession({ fs, ownership: work => work() }); sessions.push(session);
  if (seed) {
    const c = session.content;
    const p = createProfile(c, { name: "Hunter", activeClassId: "warrior", alternateClassId: "mage", masterSeed: 1042, nowWallMs: Date.now() });
    p.character.level = 30; p.character.xp = c.levelTotals[29]!;
    p.character.masteryXp.warrior = c.masteryTotals(c.classDef("warrior").masteryTrackId)[19]!;
    for (const item of CONTENT.items.filter(i => i.rarity === "legendary" && canUseItem(i, "warrior"))) p.equipment[item.slot] = createInstance(p, item.id, { isNew: false }).id;
    Object.assign(p.adventure.zones.greenfields!, { unlocked: true, cleared: true, bestStage: 10, completions: 1 });
    discoverHunts(p, c, "greenfields", 1);
    fs.files.set(paths.main, serializeSave(p, Date.now()));
  }
  await session.init(); return session;
}
async function nearBoundary(session: GameSession) {
  expect((await session.startHunt({ type: "startHunt", discoveryId: 1, slot: "weapon" })).ok).toBe(true);
  const attempt = session.profile!.hunts!.active!;
  attempt.elapsedMs = prepareHuntFight(session.content, attempt, false)!.summary.durationMs - 1;
  expect((await session.saveNow()).status).toBe("saved");
}
function step() { vi.advanceTimersByTime(10); vi.mocked(requestAnimationFrame).mock.calls.at(-1)![0](performance.now()); }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1800000000000);
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1)); vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.mocked(runOfflineCatchUp).mockImplementation(async (profile, elapsed, now, options) => {
    const p = cloneProfile(profile); const summary = simulateOffline(p, options!.content!, elapsed, now);
    return { profile: p, summary, computeMs: 0, totalMs: 0, mode: "main-thread-short" };
  });
});
afterEach(() => {
  for (const session of sessions.splice(0)) session.handleBackground();
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks();
});
describe("guarded Hunt saves", () => {
  it("publishes entry and rewards only after readback and rejects simultaneous entry", async () => {
    const fs = new ControlledFs(); const s = await open(fs, true);
    let release!: () => void;
    fs.pause = new Promise(resolve => { release = resolve; });
    const pending = nearBoundary(s);
    await vi.waitFor(() => expect(s.getSnapshot().busy).toBe("Preparing Hunt…"));
    expect(s.profile!.hunts!.active).toBeNull();
    expect((await s.startHunt({ type: "startHunt", discoveryId: 1, slot: "ring" })).ok).toBe(false);
    fs.pause = null; release(); await pending;
    const gold = s.profile!.gold;
    fs.pause = new Promise(resolve => { release = resolve; }); step();
    await vi.waitFor(() => expect(s.getSnapshot().busy).toBe("Saving Hunt result…"));
    expect(s.profile!.gold).toBe(gold); expect(s.profile!.hunts!.active).not.toBeNull();
    fs.pause = null; release();
    await vi.waitFor(() => expect(s.profile!.hunts!.queue[0]!.step).toBe(1));
    const saved = parseSave(fs.files.get(paths.main)!);
    expect(saved.ok && saved.profile.hunts!.lastResult!.gold).toBe(60);
    expect(s.profile!.gold).toBe(gold + 60);
  });
  it.each(["temp write", "main readback"])("recovers exactly one reward after a failed %s", async failure => {
    const fs = new ControlledFs(); const s = await open(fs, true); await nearBoundary(s);
    const gold = s.profile!.gold; fs.renamed = false;
    if (failure === "temp write") fs.failAt = { op: "write", path: paths.temp }; else fs.failReadback = true;
    step(); await vi.waitFor(() => expect(s.getSnapshot().phase).toBe("storage-blocked"));
    expect(s.profile!.gold).toBe(gold);
    fs.failAt = null; fs.failReadback = false; vi.setSystemTime(Date.now() + 1000);
    const recovered = await open(fs);
    expect(recovered.profile!.gold).toBe(gold + 60);
    expect(recovered.profile!.hunts!.queue[0]!.step).toBe(1);
    expect((await recovered.startHunt({ type: "startHunt", discoveryId: 1, slot: "weapon" })).ok).toBe(false);
  });
});
