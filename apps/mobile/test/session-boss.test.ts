import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTENT } from "@emberbound/game-content";
import {
  DEFAULT_SAVE_PATHS as paths, MemorySaveFs, ashenCrownAt, cloneProfile, createInstance, createProfile, parseSave,
  prepareBossFight, serializeSave, simulateOffline,
} from "@emberbound/game-core";
import { GameSession } from "../src/game/session";
import { runOfflineCatchUp } from "../src/game/offlineRunner";

vi.mock("../src/platform/device", () => ({ randomSeed: () => 1042, DEV_TOOLS: true }));
vi.mock("../src/platform/perfMonitor", () => ({ perfMonitor: { mark: vi.fn(), markStartup: vi.fn(), start: vi.fn(), pause: vi.fn(), recordCatchUp: vi.fn() } }));
vi.mock("../src/game/offlineRunner", () => ({ runOfflineCatchUp: vi.fn() }));

class ControlledFs extends MemorySaveFs {
  pause: Promise<void> | null = null;
  failReadback = false;
  renamed = false;

  override async write(path: string, text: string): Promise<void> {
    if (path === paths.temp && this.pause) await this.pause;
    return super.write(path, text);
  }

  override async rename(from: string, to: string): Promise<void> {
    await super.rename(from, to);
    this.renamed = true;
  }

  override async read(path: string): Promise<string | null> {
    if (path === paths.main && this.renamed && this.failReadback) throw new Error("Injected readback error");
    return super.read(path);
  }
}

const sessions: GameSession[] = [];

async function open(fs: ControlledFs, seed = false): Promise<GameSession> {
  const session = new GameSession({ fs, ownership: work => work() });
  sessions.push(session);
  if (seed) {
    const c = session.content;
    const profile = createProfile(c, { name: "Challenge", activeClassId: "mage", alternateClassId: "monk", masterSeed: 1042, nowWallMs: Date.now() });
    profile.character.xp = c.levelTotals[29]!;
    profile.character.level = 30;
    profile.character.masteryXp.mage = c.masteryTotals(c.classDef("mage").masteryTrackId)[19]!;
    for (const item of CONTENT.items.filter(item => item.rarity === "legendary")) {
      profile.equipment[item.slot] = createInstance(profile, item.id, { isNew: false }).id;
    }
    Object.assign(profile.adventure.zones.ashen_mountains!, { unlocked: true, cleared: true, completions: 1, bestStage: 10 });
    fs.files.set(paths.main, serializeSave(profile, Date.now()));
  }
  await session.init();
  return session;
}

async function nearBoundary(session: GameSession): Promise<void> {
  expect((await session.startBoss(1, false)).ok).toBe(true);
  const attempt = session.profile!.ashenKing!.active!;
  attempt.elapsedMs = prepareBossFight(session.content, attempt, false)!.summary.durationMs - 1;
  expect((await session.saveNow()).status).toBe("saved");
}

function step(): void {
  vi.advanceTimersByTime(10);
  vi.mocked(requestAnimationFrame).mock.calls.at(-1)![0](performance.now());
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1800000000000);
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.mocked(runOfflineCatchUp).mockImplementation(async (profile, elapsed, now, options) => {
    const copy = cloneProfile(profile);
    const summary = simulateOffline(copy, options!.content!, elapsed, now);
    return { profile: copy, summary, computeMs: 0, totalMs: 0, mode: "main-thread-short" };
  });
});

afterEach(() => {
  for (const session of sessions.splice(0)) session.handleBackground();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("guarded Ashen King saves", () => {
  it("publishes entry and settlement only after save readback", async () => {
    const fs = new ControlledFs();
    const session = await open(fs, true);
    let release!: () => void;
    fs.pause = new Promise(resolve => { release = resolve; });
    const starting = nearBoundary(session);
    await vi.waitFor(() => expect(session.getSnapshot().busy).toBe("Preparing Ashen King attempt…"));
    expect(session.profile!.ashenKing).toBeUndefined();
    expect((await session.startBoss(1, true)).ok).toBe(false);
    fs.pause = null;
    release();
    await starting;

    fs.pause = new Promise(resolve => { release = resolve; });
    step();
    await vi.waitFor(() => expect(session.getSnapshot().busy).toBe("Saving Ashen King result…"));
    expect(session.profile!.ashenKing!.highestClearedTier).toBe(0);
    expect(session.profile!.ashenKing!.active).not.toBeNull();
    fs.pause = null;
    release();
    await vi.waitFor(() => expect(session.profile!.ashenKing!.highestClearedTier).toBe(1));
    const saved = parseSave(fs.files.get(paths.main)!);
    expect(saved.ok && saved.profile.ashenKing).toMatchObject({ highestClearedTier: 1, active: null, attemptCount: 1 });
    expect(ashenCrownAt(session.profile!.ashenKing!.highestClearedTier)?.rank).toBe(1);
  });

  it.each(["temp write", "main readback"] as const)("recovers one clear and one milestone after a failed %s", async (failure) => {
    const fs = new ControlledFs();
    const session = await open(fs, true);
    await nearBoundary(session);
    fs.renamed = false;
    if (failure === "temp write") fs.failAt = { op: "write", path: paths.temp };
    else fs.failReadback = true;
    step();
    await vi.waitFor(() => expect(session.getSnapshot().phase).toBe("storage-blocked"));
    expect(session.profile!.ashenKing!.highestClearedTier).toBe(0);
    fs.failAt = null;
    fs.failReadback = false;
    vi.setSystemTime(Date.now() + 1000);

    const restored = await open(fs);
    expect(restored.profile!.ashenKing).toMatchObject({ highestClearedTier: 1, active: null, attemptCount: 1 });
    expect(restored.profile!.stats.victories).toBe(1);
    expect(ashenCrownAt(restored.profile!.ashenKing!.highestClearedTier)?.rank).toBe(1);
    expect((await restored.startBoss(1, false)).ok).toBe(false);
    expect(restored.profile!.ashenKing!.attemptCount).toBe(1);
  });
});
