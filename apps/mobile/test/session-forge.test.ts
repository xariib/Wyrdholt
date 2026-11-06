import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FORGE_V1 } from "@emberbound/game-content";
import { cloneProfile, createInstance, DEFAULT_SAVE_PATHS as paths, MemorySaveFs, parseSave, simulateOffline } from "@emberbound/game-core";
import type { ForgeInput } from "@emberbound/shared-types";
vi.mock("../src/platform/device", () => ({ randomSeed: () => 1042, DEV_TOOLS: true }));
vi.mock("../src/platform/perfMonitor", () => ({ perfMonitor: { mark: vi.fn(), markStartup: vi.fn(), start: vi.fn(), pause: vi.fn(), recordCatchUp: vi.fn() } }));
vi.mock("../src/game/offlineRunner", () => ({ runOfflineCatchUp: vi.fn() }));
import { GameSession } from "../src/game/session";
import { runOfflineCatchUp } from "../src/game/offlineRunner";

class PausedFs extends MemorySaveFs {
  pause: Promise<void> | null = null;
  override async write(path: string, text: string) {
    if (path === paths.temp && this.pause) await this.pause;
    return super.write(path, text);
  }
}
const sessions: GameSession[] = [];
async function open(fs: MemorySaveFs) {
  const s = new GameSession({ fs, ownership: work => work() });
  sessions.push(s); await s.init(); return s;
}
async function setup(fs = new PausedFs()) {
  const s = await open(fs);
  expect((await s.createCharacter("Forge", "monk", "mage")).status).toBe("created");
  const p = s.profile!;
  p.gold = 500; p.adventure.zones.greenfields!.cleared = true;
  const ids = Array.from({ length: 5 }, () => createInstance(p, "wayfarer_blade", { isNew: true }).id);
  expect((await s.saveNow()).status).toBe("saved");
  const input: ForgeInput = { transactionId: 1, configVersion: FORGE_V1.version, slot: "weapon", rarity: "common", instanceIds: ids, mode: "normal" };
  return { s, fs, input, before: cloneProfile(s.profile!) };
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

describe("Forge with the actual guarded session", () => {
  it("publishes only saved results, blocks duplicate/mutating commands, and waits on foreground", async () => {
    const { s, fs, input, before } = await setup();
    let release!: () => void; fs.pause = new Promise<void>(resolve => { release = resolve; });
    const first = s.forge(input);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(s.profile).toEqual(before);
    expect((await s.forge(input)).ok).toBe(false);
    expect(s.dispatch({ type: "devForge", action: "gold" }).ok).toBe(false);
    expect(s.dispatch({ type: "forge", input }).ok).toBe(false);
    s.handleBackground(); vi.setSystemTime(Date.now() + 1000);
    let resumed = false; const resume = s.handleForeground().then(() => { resumed = true; });
    await Promise.resolve(); expect(resumed).toBe(false);
    release(); fs.pause = null;
    const result = await first; await resume;
    expect(result.ok).toBe(true);
    if (!result.ok || !result.forge) throw new Error("Expected a confirmed fusion");
    expect(s.profile!.gold).toBe(before.gold - 100);
    expect(s.profile!.forge?.nextTransactionId).toBe(2);
    const reloaded = await open(fs);
    expect(reloaded.profile!.forge?.lastReceipt).toEqual(result.forge);
    const once = cloneProfile(reloaded.profile!);
    expect(await reloaded.forge(input)).toMatchObject({ ok: true, repeated: true });
    expect(reloaded.profile).toEqual(once);
  });

  it.each(["write", "remove", "rename"] as const)("does not reveal or spend in memory on %s failure; recovery retries exactly once", async op => {
    const { s, fs, input, before } = await setup();
    fs.failAt = { op };
    expect((await s.forge(input)).ok).toBe(false);
    expect(s.profile).toEqual(before);
    expect(s.getSnapshot().save.gate.mode).toBe("blocked");
    expect((await s.forge(input)).ok).toBe(false);
    fs.failAt = null;
    await s.retryStorage(); await s.init();
    expect(s.getSnapshot().phase).toBe("playing");
    const result = await s.forge(input);
    expect(result.ok).toBe(true);
    expect(s.profile!.gold).toBe(before.gold - 100);
    expect(s.profile!.forge?.nextTransactionId).toBe(2);
    const parsed = parseSave(fs.files.get(paths.main)!);
    expect(parsed.ok && parsed.profile.forge?.nextTransactionId).toBe(2);
  });

  it("does not acknowledge a late fusion after init changes the owner", async () => {
    const { s, fs, input, before } = await setup();
    let release!: () => void; fs.pause = new Promise<void>(resolve => { release = resolve; });
    const fusion = s.forge(input);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    const reload = s.init();
    release(); fs.pause = null;
    expect((await fusion).ok).toBe(false); await reload;
    expect(s.getSnapshot().busy).toBeNull();
    expect(s.getSnapshot().phase).toBe("playing");
    expect(s.profile!.gold).toBe(before.gold - 100);
    expect(s.profile!.forge?.nextTransactionId).toBe(2);
    expect(await s.forge(input)).toMatchObject({ ok: true, repeated: true });
  });

  it("rejects invalid recipes without changing the profile or slot bytes", async () => {
    const { s, fs, input, before } = await setup();
    const slots = [...fs.files];
    expect((await s.forge({ ...input, instanceIds: input.instanceIds.slice(1) })).ok).toBe(false);
    expect(s.profile).toEqual(before); expect([...fs.files]).toEqual(slots);
  });
});
