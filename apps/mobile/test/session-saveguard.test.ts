import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONTENT,
} from "@emberbound/game-content";
import {
  ContentIndex, MemorySaveFs, DEFAULT_SAVE_PATHS as paths, applyCommand, cloneProfile, createProfile,
  parseSave, serializeSave, sha256Hex, simulateOffline, type Profile,
} from "@emberbound/game-core";
const bridge = vi.hoisted(() => ({
  files: new Map<string, string>(), operations: [] as string[], readError: null as string | null,
  writeHook: null as null | ((path: string, data: string) => void | Promise<void>),
}));
vi.mock("@capacitor/core", async original => {
  const real = await original<typeof import("@capacitor/core")>();
  return { ...real, Capacitor: { ...real.Capacitor, getPlatform: () => "android", isNativePlatform: () => true } };
});
vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA" }, Encoding: { UTF8: "utf8" },
  Filesystem: {
    readFile: async ({ path }: { path: string }) => {
      if (path === paths.main && bridge.readError) throw Object.assign(new Error("read failed"), { code: bridge.readError });
      if (!bridge.files.has(path)) throw Object.assign(new Error("missing"), { code: "OS-PLUG-FILE-0008" });
      return { data: bridge.files.get(path)! };
    },
    writeFile: async ({ path, data }: { path: string; data: string }) => { bridge.operations.push("write"); bridge.files.set(path, data); await bridge.writeHook?.(path, data); },
    deleteFile: async ({ path }: { path: string }) => { bridge.operations.push("remove"); bridge.files.delete(path); },
    rename: async ({ from, to }: { from: string; to: string }) => { bridge.operations.push("rename"); bridge.files.set(to, bridge.files.get(from)!); bridge.files.delete(from); },
  },
}));
vi.mock("../src/platform/device", () => ({ randomSeed: () => 1042, DEV_TOOLS: false }));
vi.mock("../src/platform/perfMonitor", () => ({ perfMonitor: { mark: vi.fn(), markStartup: vi.fn(), start: vi.fn(), pause: vi.fn(), recordCatchUp: vi.fn() } }));
vi.mock("../src/game/offlineRunner", () => ({ runOfflineCatchUp: vi.fn() }));
import { GameSession } from "../src/game/session";
import { runOfflineCatchUp } from "../src/game/offlineRunner";
import { CapacitorSaveFs } from "../src/platform/storage";
import { SaveStorageError } from "../src/platform/storageErrors";

const content = new ContentIndex(CONTENT), NOW = 1800000000000;
const sessions: GameSession[] = [];
function profile(name = "Original", farming = false): Profile {
  const p = createProfile(content, { name, activeClassId: "monk", alternateClassId: "mage", masterSeed: 1042, nowWallMs: NOW - 2000 });
  if (farming) applyCommand(p, content, { type: "startFarm", zoneId: "greenfields" }, { contentTimeMs: NOW });
  return p;
}
function text(name = "Original", savedAt = 100, farming = false): string { return serializeSave(profile(name, farming), savedAt); }
function changedPayload(save: string, change: (value: Record<string, unknown>) => void, schema = 1): string {
  const envelope = JSON.parse(save); const payload = JSON.parse(envelope.payload);
  change(payload); envelope.schema = schema; envelope.payload = JSON.stringify(payload); envelope.checksum = sha256Hex(envelope.payload);
  return JSON.stringify(envelope);
}
const unsupported = (schema = 5, savedAt = 100) => changedPayload(text("Original", savedAt), p => { p.schema = schema; }, schema);
class ProbeFs extends MemorySaveFs {
  readonly mutations: string[] = [];
  readonly reads = new Map<string, number>();
  readHook?: (path: string, value: string | null, count: number) => string | null;
  mutateHook?: (operation: string, path: string) => Promise<void> | void;
  noopRename = false;
  override async read(path: string): Promise<string | null> {
    const n = (this.reads.get(path) ?? 0) + 1; this.reads.set(path, n);
    const value = await super.read(path);
    return this.readHook ? this.readHook(path, value, n) : value;
  }
  override async write(path: string, data: string): Promise<void> {
    this.mutations.push("write:" + path); await this.mutateHook?.("write", path); await super.write(path, data);
  }
  override async remove(path: string): Promise<void> {
    this.mutations.push("remove:" + path); await this.mutateHook?.("remove", path); await super.remove(path);
  }
  override async rename(from: string, to: string): Promise<void> {
    this.mutations.push("rename:" + from); await this.mutateHook?.("rename", from);
    if (!this.noopRename) await super.rename(from, to);
  }
}
function session(fs = new ProbeFs()) { const s = new GameSession({ fs }); sessions.push(s); return s; }
const filesSnapshot = (fs: ProbeFs) => [...fs.files].sort((a, b) => a[0].localeCompare(b[0]));
function privateApi(s: GameSession) {
  return s as unknown as { tick(now: number): void; startClock(): void; scheduleSave(delay?: number): void; saveChain: Promise<void> };
}
async function drainUntil(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i++) await Promise.resolve();
  expect(condition()).toBe(true);
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(NOW);
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1)); vi.stubGlobal("cancelAnimationFrame", vi.fn());
  bridge.files.clear(); bridge.operations.length = 0; bridge.readError = null;
  bridge.writeHook = null;
  vi.mocked(runOfflineCatchUp).mockReset();
  vi.mocked(runOfflineCatchUp).mockImplementation(async (p, elapsed, now) => {
    const copy = cloneProfile(p), summary = simulateOffline(copy, content, elapsed, now);
    return { profile: copy, summary, computeMs: 1, totalMs: 1, mode: "main-thread-short" };
  });
});
afterEach(async () => {
  for (const s of sessions.splice(0)) { s.handleBackground(); await privateApi(s).saveChain; }
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
});

describe("SG01–SG07 strict refusal preserves every slot", () => {
  it.each([0, 5, 99].flatMap(schema => [50, 100, 500].map(savedAt => ({ schema, savedAt }))))("SG04/05 refuses schema $schema savedAt $savedAt in each slot", async ({ schema, savedAt }) => {
    for (const slot of ["main", "temp", "backup"] as const) {
      const fs = new ProbeFs(); fs.files.set(paths.main, text("Main", 100)); fs.files.set(paths.backup, text("Backup", 100));
      fs.files.set(paths[slot], unsupported(schema, savedAt)); const original = filesSnapshot(fs);
      const s = session(fs); await s.init();
      expect(s.getSnapshot().phase).toBe("storage-blocked"); expect(s.getSnapshot().save.gate.reason).toBe("unsupported");
      expect(s.profile).toBeNull(); expect(filesSnapshot(fs)).toEqual(original); expect(fs.mutations).toEqual([]);
    }
  });
  it("SG01/02 blocks farming startup, every lifecycle/dev/direct entrypoint and observed export normalization", async () => {
    const fs = new ProbeFs(); fs.files.set(paths.main, unsupported()); fs.files.set(paths.backup, text("Backup", 100, true));
    const original = filesSnapshot(fs), s = session(fs); await s.init();
    s.handleBackground(); await s.handleForeground(); privateApi(s).tick(20000); privateApi(s).startClock(); privateApi(s).scheduleSave(1);
    s.grantSampleGear(); s.unlockAllZones(); await s.simulateOfflineReturn(2, true);
    expect(s.dispatch({ type: "startPush", zoneId: "greenfields" }).ok).toBe(false);
    expect((await s.createCharacter("New", "monk", "mage")).status).toBe("blocked");
    expect((await s.importSave(text("New"))).status).toBe("blocked"); expect((await s.resetSave()).status).toBe("blocked");
    expect((await s.saveNow()).status).toBe("blocked"); await s.retryStorage(); await vi.advanceTimersByTimeAsync(60000);
    expect(s.readObservedSave("main")).toBe(unsupported()); expect(s.exportSave()).toBe("");
    expect(runOfflineCatchUp).not.toHaveBeenCalled(); expect(fs.mutations).toEqual([]); expect(filesSnapshot(fs)).toEqual(original);
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });
  it.each(["all-invalid", "invalid-main", "invalid-backup", "invalid-temp", "empty", "whitespace", "checksum", "envelope"])("SG05/06/07 refuses %s; create/import/reset cannot bypass", async kind => {
    const fs = new ProbeFs(); fs.files.set(paths.main, text());
    if (kind === "all-invalid") { fs.files.set(paths.main, "bad"); fs.files.set(paths.backup, "bad"); }
    if (kind === "invalid-main") { fs.files.set(paths.main, "bad"); fs.files.set(paths.backup, text("Backup")); }
    if (kind === "invalid-backup") fs.files.set(paths.backup, "bad");
    if (kind === "invalid-temp") fs.files.set(paths.temp, "bad");
    if (kind === "empty" || kind === "whitespace") fs.files.set(paths.main, kind === "empty" ? "" : "  ");
    if (kind === "checksum") { const e = JSON.parse(text()); e.checksum = "bad"; fs.files.set(paths.main, JSON.stringify(e)); }
    if (kind === "envelope") { const e = JSON.parse(text()); delete e.format; fs.files.set(paths.main, JSON.stringify(e)); }
    const original = filesSnapshot(fs), s = session(fs); await s.init();
    expect(s.getSnapshot().save.gate.reason).toBe("corrupt");
    for (const outcome of [await s.createCharacter("New", "monk", "mage"), await s.importSave(text()), await s.resetSave()]) expect(outcome.status).toBe("blocked");
    expect(fs.mutations).toEqual([]); expect(filesSnapshot(fs)).toEqual(original);
  });
  it("SG25 refuses outdated main or selected candidate without content-policy changes", async () => {
    const outdated = changedPayload(text(), p => { p.rulesVersion = "old-rules"; });
    for (const mainMissing of [false, true]) {
      const fs = new ProbeFs(); fs.files.set(mainMissing ? paths.backup : paths.main, outdated);
      const s = session(fs); await s.init();
      expect(s.getSnapshot().save.gate.reason).toBe("rules"); expect((await s.createCharacter("New", "monk", "mage")).status).toBe("blocked");
      expect(fs.mutations).toEqual([]);
    }
  });
});

describe("SG08–SG17 missing, normal recovery and real I/O", () => {
  it("SG08 async creation requires three proven missing reads and publishes only after readback; double submit rejected", async () => {
    const fs = new ProbeFs(), s = session(fs); await s.init();
    expect(s.getSnapshot().save.gate.slots.map(o => o.status)).toEqual(["missing", "missing", "missing"]);
    let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
    fs.mutateHook = async (op, path) => { if (op === "write" && path === paths.temp) await wait; };
    const creating = s.createCharacter("æNew", "monk", "mage");
    await drainUntil(() => fs.mutations.length > 0); expect(s.profile).toBeNull();
    expect((await s.createCharacter("Duplicate", "monk", "mage")).status).toBe("rejected");
    release(); const result = await creating; expect(result.status).toBe("created");
    if (result.status !== "created") throw new Error("Creation failed");
    expect(result.receipt.readbackVerified).toBe(true); expect(result.receipt.durability).toBe("not-verified");
    expect(result.receipt.bytes).toBe(new TextEncoder().encode(fs.files.get(paths.main)!).length);
    expect(s.profile!.character.name).toBe("æNew"); expect(fs.reads.get(paths.main)).toBeGreaterThanOrEqual(4);
    expect((await s.createCharacter("Replace", "monk", "mage")).status).toBe("rejected");
  });
  it.each(["main-tie", "temp-newer", "backup-newer", "missing-main-temp", "missing-main-backup"])("SG09/10 preserves core recovery ordering for %s", async kind => {
    const fs = new ProbeFs();
    if (!kind.startsWith("missing")) fs.files.set(paths.main, text("Main", 100));
    if (kind !== "missing-main-backup") fs.files.set(paths.temp, text("Temp", kind === "temp-newer" ? 200 : 100));
    fs.files.set(paths.backup, text("Backup", kind === "backup-newer" ? 300 : 100));
    const expected = kind === "main-tie" ? "main" : kind === "temp-newer" || kind === "missing-main-temp" ? "temp" : "backup";
    const original = filesSnapshot(fs), s = session(fs); await s.init();
    expect(s.getSnapshot().save.loadedFrom).toBe(expected); expect(s.getSnapshot().phase).toBe("playing");
    expect(filesSnapshot(fs)).toEqual(original); expect(fs.mutations).toEqual([]);
    expect((await s.saveNow()).status).toBe("saved");
  });
  it.each(["main", "temp", "backup"] as const)("SG11 I/O in %s blocks otherwise valid slots", async slot => {
    const fs = new ProbeFs(); fs.files.set(paths.main, text());
    fs.readHook = (path, value) => { if (path === paths[slot]) throw Object.assign(new Error("I/O"), { code: "OS-PLUG-FILE-0013" }); return value; };
    const s = session(fs); await s.init(); expect(s.getSnapshot().save.gate.reason).toBe("io");
    expect(s.getSnapshot().save.gate.slots.find(o => o.slot === slot)).toMatchObject({ status: "error", errorCode: "OS-PLUG-FILE-0013" });
    expect((await s.createCharacter("New", "monk", "mage")).status).toBe("blocked"); expect(fs.mutations).toEqual([]);
  });
  it("SG17 actual platformadapter does not mask main read I/O or overwrite unreadable newer main", async () => {
    bridge.files.set(paths.main, unsupported()); bridge.readError = "OS-PLUG-FILE-0013";
    const s = new GameSession({ fs: new CapacitorSaveFs() }); sessions.push(s); await s.init();
    expect(s.getSnapshot().save.gate.reason).toBe("io"); expect(s.profile).toBeNull();
    expect((await s.createCharacter("New", "monk", "mage")).status).toBe("blocked");
    expect(bridge.files.get(paths.main)).toBe(unsupported()); expect(bridge.operations).toEqual([]);
  });
});

describe("SG18–SG22 receipts and partial failures", () => {
  it.each(["temp-write", "temp-different", "temp-null", "temp-throw", "main-read", "backup-write", "main-remove", "rename", "main-readback", "main-readback-null", "main-readback-different", "postflight"])("SG20/21 reports %s failure and never updates saved metadata", async point => {
    const fs = new ProbeFs(); fs.files.set(paths.main, text()); const s = session(fs); await s.init();
    fs.readHook = (path, value, count) => {
      if (path === paths.temp && count === 3 && point.startsWith("temp-") && point !== "temp-write") {
        if (point === "temp-throw") throw new Error("read failed"); return point === "temp-null" ? null : "different";
      }
      if (path === paths.main && ((point === "main-read" && count === 3) || (point === "main-readback" && count === 4))) throw new Error("main failed");
      if (path === paths.main && count === 4 && point.startsWith("main-readback-")) return point.endsWith("null") ? null : "different";
      if (path === paths.backup && point === "postflight" && count === 3) throw new Error("backup unreadable");
      return value;
    };
    fs.mutateHook = (op, path) => {
      if ((point === "temp-write" && op === "write" && path === paths.temp) || (point === "backup-write" && op === "write" && path === paths.backup)
        || (point === "main-remove" && op === "remove") || (point === "rename" && op === "rename")) throw Object.assign(new Error("failed"), { code: "OS-PLUG-FILE-0013" });
    };
    const outcome = await s.saveNow(); expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") throw new Error("Expected failure");
    expect(outcome.storageMayHaveChanged).toBe(true); expect(s.getSnapshot().save.lastSavedWallMs).toBeNull();
    const expectedStage = point.startsWith("temp-") && point !== "temp-write" ? "temp-read" : point.startsWith("main-readback") ? "main-readback" : point;
    expect(outcome.stage).toBe(expectedStage);
    expect(s.getSnapshot().save.mainHash).toBeNull(); expect(s.getSnapshot().save.gate.mode).toBe("blocked");
    const n = fs.mutations.length; expect((await s.saveNow()).status).toBe("blocked"); expect(fs.mutations).toHaveLength(n);
  });
  it("SG21 resolved noop rename is not a confirmed save", async () => {
    const fs = new ProbeFs(); fs.files.set(paths.main, text()); const s = session(fs); await s.init(); fs.noopRename = true;
    expect(await s.saveNow()).toMatchObject({ status: "failed", stage: "main-readback", storageMayHaveChanged: true });
    expect(s.getSnapshot().save.lastSavedWallMs).toBeNull();
  });
  it.each([-1, Number.NaN])("SG19 invalid/throwing staged profile gold=%s mutates no files", async gold => {
    const fs = new ProbeFs(); fs.files.set(paths.main, text()); const s = session(fs); await s.init(); s.profile!.gold = gold;
    const original = filesSnapshot(fs), outcome = await s.saveNow();
    expect(outcome.status).toBe("failed"); if (outcome.status === "failed") expect(outcome.storageMayHaveChanged).toBe(false);
    expect(fs.mutations).toEqual([]); expect(filesSnapshot(fs)).toEqual(original);
  });
  it("SG18 write failure does not publish imported figure or emit import success", async () => {
    const fs = new ProbeFs(); fs.files.set(paths.main, text()); const s = session(fs); await s.init();
    const old = s.profile, original = filesSnapshot(fs), imported = text("Imported", 200), preview = s.prepareImport(imported);
    if (preview.status !== "ready") throw new Error("Preview failed");
    fs.mutateHook = () => { throw new Error("write failed"); };
    const outcome = await s.importSave(imported, preview.intent);
    expect(outcome.status).toBe("failed"); expect(s.profile).toBe(old); expect(filesSnapshot(fs)).toEqual(original);
  });
  it("SG22 startup settlement cannot publish gains before a confirmed main readback", async () => {
    const fs = new ProbeFs(); const p = profile("Original", true); p.clock.lastSettledWallMs = NOW - 2000;
    fs.files.set(paths.main, serializeSave(p, 100)); const original = filesSnapshot(fs), s = session(fs);
    fs.mutateHook = () => { throw new Error("write failed"); };
    await s.init();
    expect(s.getSnapshot().phase).toBe("storage-blocked");
    expect(s.profile!.clock.lastSettledWallMs).toBe(p.clock.lastSettledWallMs);
    expect(s.profile!.clock.simulatedMs).toBe(p.clock.simulatedMs); expect(s.profile!.gold).toBe(p.gold);
    expect(s.getSnapshot().offline).toBeNull(); expect(s.lastSettlement).toBeNull();
    expect(s.getSnapshot().save.mainHash).toBeNull(); expect(filesSnapshot(fs)).toEqual(original);
  });
  it.each(["clock", "adventure", "stats"])("SG26 rejects missing %s before preview, staging or mutation", async field => {
    const fs = new ProbeFs(); fs.files.set(paths.main, text()); const s = session(fs); await s.init();
    const old = s.profile, oldBytes = serializeSave(old!, NOW), original = filesSnapshot(fs);
    const before = s.getSnapshot(), mutationStart = fs.mutations.length, runnerStart = vi.mocked(runOfflineCatchUp).mock.calls.length;
    const publications: Array<ReturnType<typeof s.getSnapshot>> = [], off = s.subscribe(() => publications.push(s.getSnapshot()));
    const imported = changedPayload(text("Bad"), p => { delete p[field]; });
    expect(parseSave(imported)).toMatchObject({ ok: false, reason: `invalid:profile-state:${field}` });
    const preview = s.prepareImport(imported);
    expect(preview).toMatchObject({ status: "rejected", reason: "invalid" }); expect(preview.status).not.toBe("ready");
    // No issued intent exists. The direct call correctly stops at confirmation,
    // before parsing/staging; it is not labelled an invalid-payload outcome.
    const direct = await s.importSave(imported);
    expect(direct).toMatchObject({ status: "rejected", reason: "confirmation" });
    off(); expect(s.profile).toBe(old); expect(serializeSave(s.profile!, NOW)).toBe(oldBytes);
    expect(filesSnapshot(fs)).toEqual(original); expect(fs.mutations.slice(mutationStart)).toEqual([]);
    expect(vi.mocked(runOfflineCatchUp).mock.calls.length).toBe(runnerStart); expect(s.lastSettlement).toBeNull();
    expect(publications).toEqual([]); expect(s.getSnapshot().save).toEqual(before.save); expect(s.getSnapshot().toast).toBe(before.toast);
    if (process.env.SAVE_INTEGRATION_TRACE_DIR) {
      const { appendFileSync } = await import("node:fs");
      appendFileSync(`${process.env.SAVE_INTEGRATION_TRACE_DIR}/sg26.jsonl`, JSON.stringify({ kind: `early-missing-${field}`, imported, preview, direct,
        original, after: filesSnapshot(fs), oldProfileBytes: oldBytes, afterProfileBytes: serializeSave(s.profile!, NOW), publications: publications.length,
        runnerCalls: vi.mocked(runOfflineCatchUp).mock.calls.length - runnerStart, mutations: fs.mutations.slice(mutationStart), gate: s.getSnapshot().save.gate }) + "\n");
    }
  });
  it.each(["unknown-zone", "stage999"])("SG26 parse-valid %s actually throws in import staging before write", async kind => {
    const fs = new ProbeFs(); fs.files.set(paths.main, text()); const s = session(fs); await s.init();
    const old = s.profile, oldBytes = serializeSave(old!, NOW), original = filesSnapshot(fs), before = s.getSnapshot();
    const mutationStart = fs.mutations.length, candidate = profile("Staged bad", true);
    const { advanceAdventure } = await import("@emberbound/game-core");
    advanceAdventure(candidate, content, candidate.adventure.run!.restMs + 50, { offline: false, contentTimeMs: NOW });
    expect(candidate.adventure.run?.phase).toBe("fight"); candidate.clock.lastSettledWallMs = NOW - 2000;
    if (kind === "unknown-zone") candidate.adventure.run!.zoneId = "__sg26_unknown_zone__";
    else candidate.adventure.run!.stageIndex = 999;
    const imported = serializeSave(candidate, 200); expect(parseSave(imported).ok).toBe(true);
    const preview = s.prepareImport(imported); expect(preview.status).toBe("ready"); if (preview.status !== "ready") throw new Error("Expected original import intent");
    const trace: Array<{ event: string; elapsed: number; now: number; phase?: string; zone?: string; stage?: number; error?: string }> = [];
    vi.mocked(runOfflineCatchUp).mockImplementation(async (p, elapsed, now) => {
      trace.push({ event: "entry", elapsed, now, phase: p.adventure.run?.phase, zone: p.adventure.run?.zoneId, stage: p.adventure.run?.stageIndex });
      const copy = cloneProfile(p);
      try {
        const summary = simulateOffline(copy, content, elapsed, now); trace.push({ event: "simulation-complete", elapsed, now });
        return { profile: copy, summary, computeMs: 1, totalMs: 1, mode: "main-thread-short" };
      } catch (error) {
        trace.push({ event: "simulation-exception", elapsed, now, error: String(error) }); throw error;
      }
    });
    const publications: Array<ReturnType<typeof s.getSnapshot>> = [], off = s.subscribe(() => publications.push(s.getSnapshot()));
    const outcome = await s.importSave(imported, preview.intent); off();
    expect(outcome).toEqual({ status: "failed", stage: "profile", storageMayHaveChanged: false });
    expect(trace.map(t => t.event)).toEqual(["entry", "simulation-exception"]); expect(trace[0]).toMatchObject({ elapsed: 2000, now: NOW, phase: "fight" });
    expect(s.getSnapshot().save.gate).toMatchObject({ mode: "blocked", reason: "profile" });
    expect(s.profile).toBe(old); expect(serializeSave(s.profile!, NOW)).toBe(oldBytes); expect(publications.every(u => u.profile === old)).toBe(true);
    expect(filesSnapshot(fs)).toEqual(original); expect(fs.mutations.slice(mutationStart)).toEqual([]); expect(s.lastSettlement).toBeNull();
    expect(s.getSnapshot().save.mainHash).toBe(before.save.mainHash); expect(s.getSnapshot().save.lastSavedWallMs).toBe(before.save.lastSavedWallMs);
    expect(s.getSnapshot().save.bytes).toBe(before.save.bytes); expect(s.getSnapshot().toast).toBe(before.toast);
    if (process.env.SAVE_INTEGRATION_TRACE_DIR) {
      const { appendFileSync } = await import("node:fs");
      appendFileSync(`${process.env.SAVE_INTEGRATION_TRACE_DIR}/sg26.jsonl`, JSON.stringify({ kind: `staged-${kind}`, imported, originalIssuedIntent: preview.intent,
        outcome, trace, original, after: filesSnapshot(fs), oldProfileBytes: oldBytes, afterProfileBytes: serializeSave(s.profile!, NOW),
        mutations: fs.mutations.slice(mutationStart), publishedProfilesUnchanged: publications.every(u => u.profile === old), gate: s.getSnapshot().save.gate }) + "\n");
    }
  });
  it("SG18/22 requires explicit exact import intent and returns confirmed receipt on success", async () => {
    const fs = new ProbeFs(); fs.files.set(paths.main, text()); const s = session(fs); await s.init();
    const imported = text("Imported");
    expect((await s.importSave(imported)).status).toBe("rejected");
    const preview = s.prepareImport(imported); if (preview.status !== "ready") throw new Error("Preview failed");
    expect((await s.importSave(imported + " ", preview.intent)).status).toBe("rejected");
    const outcome = await s.importSave(imported, preview.intent); expect(outcome.status).toBe("imported");
    if (outcome.status !== "imported") throw new Error("Import failed");
    expect(outcome.receipt.mainHash).toBe(sha256Hex(fs.files.get(paths.main)!)); expect(s.profile!.character.name).toBe("Imported");
    expect((await s.importSave(imported, preview.intent)).status).toBe("rejected");
  });
});

describe("SG03/23/24/27/28/29 ownership, retry, queues and reset", () => {
  it("SG23 queued snapshots A/B write in order; last receipt belongs to B", async () => {
    const fs = new ProbeFs(); fs.files.set(paths.main, text()); const s = session(fs); await s.init();
    s.profile!.gold = 100; const a = s.saveNow(); s.profile!.gold = 200; const b = s.saveNow();
    expect((await a).status).toBe("saved"); const result = await b; expect(result.status).toBe("saved");
    const parsed = parseSave(fs.files.get(paths.main)!); if (!parsed.ok) throw new Error("Bad save");
    expect(parsed.profile.gold).toBe(200); if (result.status === "saved") expect(s.getSnapshot().save.mainHash).toBe(result.mainHash);
  });
  it("SG13/27 reset propagates remove failure and never advertises empty/create", async () => {
    const fs = new ProbeFs(); fs.files.set(paths.main, text()); fs.files.set(paths.backup, text("Backup")); const s = session(fs); await s.init();
    expect((await s.resetSave()).status).toBe("rejected"); const preview = s.prepareReset();
    if (preview.status !== "ready") throw new Error("Preview failed");
    fs.mutateHook = (op, path) => { if (op === "remove" && path === paths.backup) throw Object.assign(new Error("failed"), { code: "OS-PLUG-FILE-0013" }); };
    expect(await s.resetSave(preview.intent)).toMatchObject({ status: "failed", stage: "reset-remove", errorCode: "OS-PLUG-FILE-0013", storageMayHaveChanged: true });
    expect(s.getSnapshot().phase).toBe("storage-blocked"); expect(s.profile).not.toBeNull(); expect(fs.files.has(paths.backup)).toBe(true);
  });
  it("SG27 successful confirmed reset verifies all slots missing before create", async () => {
    const fs = new ProbeFs(); fs.files.set(paths.main, text()); const s = session(fs); await s.init(); const preview = s.prepareReset();
    if (preview.status !== "ready") throw new Error("Preview failed");
    expect(await s.resetSave(preview.intent)).toMatchObject({ status: "reset", verifiedEmpty: true });
    expect(s.getSnapshot().phase).toBe("create"); expect(s.profile).toBeNull(); expect(fs.files.size).toBe(0);
    expect(s.getSnapshot().save.gate.slots.map(o => o.status)).toEqual(["missing", "missing", "missing"]);
  });
  it("SG23/29 an old in-flight commit cannot publish a receipt or reopen revoked state", async () => {
    const fs = new ProbeFs(); fs.files.set(paths.main, text()); const s = session(fs); await s.init();
    let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
    fs.mutateHook = async (op, path) => { if (op === "write" && path === paths.temp) await wait; };
    const save = s.saveNow(); await drainUntil(() => fs.mutations.length > 0);
    const retry = s.retryStorage(); expect(s.getSnapshot().save.gate.mode).toBe("uninspected");
    release(); expect(await save).toMatchObject({ status: "failed", stage: "stale-commit", storageMayHaveChanged: true });
    await retry; expect(s.getSnapshot().phase).toBe("storage-blocked"); expect(s.getSnapshot().save.mainHash).toBeNull();
  });
  it("SG03/29 old worker reply after newer main/refusal cannot resume clock or save", async () => {
    const fs = new ProbeFs(); const p = profile("Original", true); p.clock.lastSettledWallMs = NOW - 31 * 60000;
    fs.files.set(paths.main, serializeSave(p, 100)); const s = session(fs);
    let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(runOfflineCatchUp).mockImplementation(async input => { await wait; return { profile: cloneProfile(input), summary: simulateOffline(cloneProfile(input), content, 0, NOW), computeMs: 1, totalMs: 1, mode: "worker" }; });
    const init = s.init(); await drainUntil(() => vi.mocked(runOfflineCatchUp).mock.calls.length > 0);
    fs.files.set(paths.main, unsupported()); await s.retryStorage(); const original = filesSnapshot(fs);
    release(); await init; await s.handleForeground(); await vi.advanceTimersByTimeAsync(20000);
    expect(s.getSnapshot().save.gate.reason).toBe("unsupported"); expect(s.getSnapshot().phase).toBe("storage-blocked");
    expect(fs.mutations).toEqual([]); expect(filesSnapshot(fs)).toEqual(original); expect(requestAnimationFrame).not.toHaveBeenCalled();
  });
  it("SG24 retry reads only, invalidates confirmations, and requires separate explicit init to resume", async () => {
    const fs = new ProbeFs(); fs.files.set(paths.main, text()); const s = session(fs); await s.init();
    const preview = s.prepareReset(); if (preview.status !== "ready") throw new Error("Preview failed");
    const original = filesSnapshot(fs); await s.retryStorage(); await vi.advanceTimersByTimeAsync(20000);
    expect(fs.mutations).toEqual([]); expect(filesSnapshot(fs)).toEqual(original); expect(s.getSnapshot().phase).toBe("storage-blocked");
    expect((await s.resetSave(preview.intent)).status).toBe("rejected");
    await s.init(); expect(s.getSnapshot().phase).toBe("playing");
  });
  it.each(["compatible-change", "newer-main", "corrupt-side"])("SG28 fresh preflight blocks %s before temp write", async kind => {
    const fs = new ProbeFs(); fs.files.set(paths.main, text()); const s = session(fs); await s.init();
    if (kind === "compatible-change") fs.files.set(paths.main, text("External"));
    if (kind === "newer-main") fs.files.set(paths.main, unsupported());
    if (kind === "corrupt-side") fs.files.set(paths.backup, "bad");
    const original = filesSnapshot(fs); expect((await s.saveNow()).status).toBe("blocked");
    expect(fs.mutations).toEqual([]); expect(filesSnapshot(fs)).toEqual(original);
    expect(s.getSnapshot().save.gate.reason).toBe(kind === "compatible-change" ? "storage-changed" : kind === "newer-main" ? "unsupported" : "corrupt");
  });
  it("SG28 unavailable ownership refuses writes but retains raw read observations", async () => {
    const fs = new ProbeFs(); fs.files.set(paths.main, text());
    const s = new GameSession({ fs, ownership: async () => { throw new SaveStorageError("ownership", "save-lock", new Error("unavailable")); } }); sessions.push(s);
    await s.init(); expect(s.getSnapshot().save.gate.reason).toBe("ownership"); expect(s.readObservedSave("main")).toBe(text());
    expect((await s.createCharacter("New", "monk", "mage")).status).toBe("blocked"); expect(fs.mutations).toEqual([]);
  });
  it("SG03 queued job revoked before it starts performs no additional writes", async () => {
    const fs = new ProbeFs(); fs.files.set(paths.main, text()); const s = session(fs); await s.init();
    let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
    fs.mutateHook = async (op, path) => { if (op === "write" && path === paths.temp) await wait; };
    const first = s.saveNow(); await drainUntil(() => fs.mutations.length > 0);
    const queued = s.saveNow(), retry = s.retryStorage();
    release(); await first; expect(await queued).toMatchObject({ status: "skipped", reason: "stale-generation" }); await retry;
    expect(fs.mutations).toEqual(["write:" + paths.temp, "write:" + paths.backup, "remove:" + paths.main, "rename:" + paths.temp]);
  });
  it("SG23 import overlapping an in-flight save refuses stale intent and never publishes candidate", async () => {
    const fs = new ProbeFs(); fs.files.set(paths.main, text()); const s = session(fs); await s.init();
    const old = s.profile, imported = text("Imported"), preview = s.prepareImport(imported);
    if (preview.status !== "ready") throw new Error("Preview failed");
    let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
    fs.mutateHook = async (op, path) => { if (op === "write" && path === paths.temp) await wait; };
    const saving = s.saveNow(); await drainUntil(() => fs.mutations.length > 0);
    const importing = s.importSave(imported, preview.intent); await Promise.resolve(); release();
    expect((await saving).status).toBe("failed"); expect((await importing).status).toBe("skipped");
    expect(s.profile).toBe(old); const parsed = parseSave(fs.files.get(paths.main)!);
    if (!parsed.ok) throw new Error("Bad save"); expect(parsed.profile.character.name).toBe("Original");
  });
  it("SG23 catchup owns profile; direct dispatch cannot be lost under a pending worker", async () => {
    const fs = new ProbeFs(); const p = profile("Original", true); p.clock.lastSettledWallMs = NOW - 31 * 60000;
    fs.files.set(paths.main, serializeSave(p, 100)); const s = session(fs);
    let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(runOfflineCatchUp).mockImplementation(async input => { await wait; const copy = cloneProfile(input); return { profile: copy, summary: simulateOffline(copy, content, 0, NOW), computeMs: 1, totalMs: 1, mode: "worker" }; });
    const starting = s.init(); await drainUntil(() => vi.mocked(runOfflineCatchUp).mock.calls.length > 0);
    expect(s.dispatch({ type: "devUnlockZones" }).ok).toBe(false);
    const resetting = await s.resetSave(); expect(resetting.status).toBe("rejected");
    release(); await starting; await privateApi(s).saveChain;
    expect(s.getSnapshot().phase).toBe("playing"); expect((await s.saveNow()).status).toBe("saved");
  });
  it("SG29 a superseded retry cannot reopen the gate", async () => {
    const fs = new ProbeFs(); fs.files.set(paths.main, text()); const s = session(fs); await s.init();
    let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
    const read = fs.read.bind(fs); let held = false;
    fs.read = async path => { const value = await read(path); if (path === paths.main && !held) { held = true; await wait; } return value; };
    const first = s.retryStorage(); await drainUntil(() => held);
    fs.files.set(paths.main, unsupported()); const second = s.retryStorage(); release(); await Promise.all([first, second]);
    expect(s.getSnapshot().save.gate.reason).toBe("unsupported"); expect(fs.mutations).toEqual([]);
    expect(s.readObservedSave("main")).toBe(unsupported());
  });
});

function pending<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("SAVE-GUARD-001A-R1 observed main and revoked owners", () => {
  it.each(["unsupported", "io", "worker-failure"])("latest init completes ready on a controlled %s pause", async kind => {
    const fs = new ProbeFs(), p = profile("Original", true); p.clock.lastSettledWallMs = NOW - 31 * 60000;
    fs.files.set(paths.main, kind === "unsupported" ? unsupported() : serializeSave(p, 100));
    if (kind === "io") fs.readHook = () => { throw new SaveStorageError("read", paths.main, { code: "OS-PLUG-FILE-0013" }); };
    if (kind === "worker-failure") vi.mocked(runOfflineCatchUp).mockRejectedValue(new Error("Current worker failed"));
    const s = session(fs); let ready = false; void s.ready.then(() => { ready = true; });
    await s.init(); expect(ready).toBe(true); expect(s.getSnapshot().save.gate.mode).toBe("blocked");
    expect(["error", "storage-blocked"]).toContain(s.getSnapshot().phase);
    expect(fs.mutations).toEqual([]); expect(s.dispatch({ type: "devUnlockZones" }).ok).toBe(false);
  });
  const lateCases = ["schema5", "schema99", "inventory", "compatible", "present-to-missing", "missing-to-present"];
  it.each(["memory", "capacitor"].flatMap(adapter => lateCases.map(kind => ({ adapter, kind }))))(
    "$adapter preserves $kind observed after temp-write, with an honest partial receipt", async ({ adapter, kind }) => {
      const memory = new ProbeFs();
      const files = adapter === "capacitor" ? bridge.files : memory.files;
      const backup = text("Backup");
      files.set(paths.backup, backup);
      if (kind !== "missing-to-present") files.set(paths.main, text());
      const s = new GameSession({ fs: adapter === "capacitor" ? new CapacitorSaveFs() : memory }); sessions.push(s);
      await s.init(); expect(s.getSnapshot().phase).toBe("playing");
      const beforeMetadata = { ...s.getSnapshot().save };
      const external = kind === "present-to-missing" ? null : kind === "schema5" ? unsupported(5)
        : kind === "schema99" ? unsupported(99) : kind === "inventory" ? changedPayload(text(), p => { delete p.inventory; }) : text("External");
      const changeMain = () => { if (external === null) files.delete(paths.main); else files.set(paths.main, external); };
      if (adapter === "capacitor") bridge.writeHook = path => { if (path === paths.temp) changeMain(); };
      else memory.readHook = (path, raw) => { if (path === paths.temp) changeMain(); return raw; };
      const outcome = await s.saveNow();
      expect(outcome).toEqual({ status: "failed", stage: "main-read", storageMayHaveChanged: true });
      expect(files.get(paths.main) ?? null).toBe(external);
      expect(files.get(paths.backup)).toBe(backup);
      expect(parseSave(files.get(paths.temp)!).ok).toBe(true);
      expect(adapter === "capacitor" ? bridge.operations : memory.mutations).toEqual(adapter === "capacitor" ? ["write"] : ["write:" + paths.temp]);
      const state = s.getSnapshot();
      expect(state.phase).toBe("storage-blocked"); expect(state.save.gate.mode).toBe("blocked");
      expect(state.save.gate.reason).toBe(kind.startsWith("schema") ? "unsupported" : kind === "inventory" ? "corrupt" : "storage-changed");
      expect(s.readObservedSave("main")).toBe(external);
      expect(state.save.lastSavedWallMs).toBe(beforeMetadata.lastSavedWallMs);
      expect(state.save.mainHash).toBe(beforeMetadata.mainHash); expect(state.save.bytes).toBe(beforeMetadata.bytes);
      expect((await s.saveNow()).status).toBe("blocked");
    },
  );

  const overlaps = ["resolve", "reject"].flatMap(oldResult => ["benchmark-keep", "benchmark-preview", "import"].flatMap(action =>
    ["old-first", "new-first"].map(order => ({ oldResult, action, order }))));
  it.each(overlaps)("$oldResult revoked benchmark / $action / $order keeps only the current owner", async ({ oldResult, action, order }) => {
    const fs = new ProbeFs(); fs.files.set(paths.main, text()); const s = session(fs); await s.init();
    const old = pending<void>(), newer = pending<void>(); let calls = 0;
    vi.mocked(runOfflineCatchUp).mockImplementation(async input => {
      const call = ++calls; await (call === 1 ? old.promise : newer.promise);
      const copy = cloneProfile(input), summary = simulateOffline(copy, content, 0, NOW);
      copy.character.name = call === 1 ? "Revoked" : "NewOwner";
      return { profile: copy, summary, computeMs: 1, totalMs: 1, mode: "worker" };
    });
    const revoked = s.simulateOfflineReturn(1, true); await drainUntil(() => calls === 1);
    await s.retryStorage(); await s.init(); expect(s.getSnapshot().phase).toBe("playing");
    const loaded = s.profile;
    const imported = text("NewOwner"), preview = s.prepareImport(imported);
    if (preview.status !== "ready") throw new Error("Import preview failed.");
    const current = action === "import" ? s.importSave(imported, preview.intent)
      : s.simulateOfflineReturn(2, action === "benchmark-keep");
    await drainUntil(() => calls === 2);
    const finishOld = async () => { if (oldResult === "reject") old.reject(new Error("Old worker failed")); else old.resolve(); await revoked; };
    if (order === "old-first") {
      const before = s.getSnapshot(); await finishOld();
      expect(s.getSnapshot()).toBe(before); expect(s.profile).toBe(loaded);
      expect(s.dispatch({ type: "devUnlockZones" }).ok).toBe(false);
      expect((await s.saveNow()).status).toBe("blocked");
      expect((await s.createCharacter("Forbidden", "monk", "mage"))).toMatchObject({ status: "rejected", reason: "busy" });
      expect((s as unknown as { running: boolean }).running).toBe(false);
    }
    newer.resolve(); const outcome = await current;
    if (action === "import") expect(outcome).toMatchObject({ status: "imported", receipt: { readbackVerified: true } });
    expect(s.getSnapshot().phase).toBe("playing"); expect(s.getSnapshot().busy).toBeNull();
    expect(s.profile?.character.name).toBe(action === "benchmark-preview" ? "Original" : "NewOwner");
    if (action !== "import") expect(s.getSnapshot().offline?.kept).toBe(action === "benchmark-keep");
    if (order === "new-first") {
      const state = s.getSnapshot(), files = filesSnapshot(fs);
      const clock = s as unknown as { lastTick: number }; clock.lastTick = 12345;
      await finishOld(); expect(s.getSnapshot()).toBe(state); expect(filesSnapshot(fs)).toEqual(files); expect(clock.lastTick).toBe(12345);
    }
    expect(s.dispatch({ type: "devUnlockZones" }).ok).toBe(true);
    expect((await s.saveNow()).status).toBe("saved");
    const parsed = parseSave(fs.files.get(paths.main)!); if (!parsed.ok) throw new Error("Invalid final save.");
    expect(parsed.profile.character.name).toBe(action === "benchmark-preview" ? "Original" : "NewOwner");
  });

  it.each(["resolve", "reject"])("revoked startup %s cannot finish the newer init or unblock loading mutators", async oldResult => {
    const fs = new ProbeFs(), original = profile("Original", true); original.clock.lastSettledWallMs = NOW - 31 * 60000;
    fs.files.set(paths.main, serializeSave(original, 100)); const s = session(fs);
    const old = pending<void>(), current = pending<void>(); let calls = 0;
    vi.mocked(runOfflineCatchUp).mockImplementation(async input => {
      const call = ++calls; await (call === 1 ? old.promise : current.promise);
      const copy = cloneProfile(input), summary = simulateOffline(copy, content, 1000, NOW);
      return { profile: copy, summary, computeMs: 1, totalMs: 1, mode: "worker" };
    });
    let ready = false; void s.ready.then(() => { ready = true; });
    const first = s.init(); await drainUntil(() => calls === 1); await s.retryStorage();
    let loadingChecked = false;
    const unsubscribe = s.subscribe(() => {
      if (s.getSnapshot().phase === "loading" && s.getSnapshot().save.gate.mode === "writable" && s.profile) {
        loadingChecked = true; expect(s.dispatch({ type: "devUnlockZones" }).ok).toBe(false);
        expect(s.exportSave()).toBe("");
      }
    });
    const second = s.init(); await drainUntil(() => calls === 2); expect(loadingChecked).toBe(true);
    if (oldResult === "reject") old.reject(new Error("Revoked startup failed")); else old.resolve();
    await first; expect(ready).toBe(false); expect(s.getSnapshot().phase).toBe("catching-up");
    expect(s.dispatch({ type: "devUnlockZones" }).ok).toBe(false); expect(fs.mutations).toEqual([]);
    current.resolve(); await second; await s.ready; unsubscribe();
    expect(ready).toBe(true); expect(s.getSnapshot().phase).toBe("playing");
    expect(s.getSnapshot().offline?.summary.simulatedMs).toBe(1000);
    expect(fs.mutations).toEqual(["write:" + paths.temp, "write:" + paths.backup, "remove:" + paths.main, "rename:" + paths.temp]);
  });

  it.each(["resolve", "reject"].flatMap(oldResult => ["create", "reset"].map(action => ({ oldResult, action }))))(
    "$oldResult revoked benchmark cannot release a pending $action", async ({ oldResult, action }) => {
      const fs = new ProbeFs(); fs.files.set(paths.main, text()); const s = session(fs); await s.init();
      const old = pending<void>();
      vi.mocked(runOfflineCatchUp).mockImplementation(async input => {
        await old.promise; const copy = cloneProfile(input);
        return { profile: copy, summary: simulateOffline(copy, content, 0, NOW), computeMs: 1, totalMs: 1, mode: "worker" };
      });
      const revoked = s.simulateOfflineReturn(1, true);
      await drainUntil(() => vi.mocked(runOfflineCatchUp).mock.calls.length > 0);
      if (action === "create") fs.files.clear(); // Synthetic external empty storage, never a device reset.
      await s.retryStorage(); if (action === "reset") await s.init();
      const held = pending<void>(); let entered = false;
      fs.mutateHook = async op => { if (op === (action === "create" ? "write" : "remove") && !entered) { entered = true; await held.promise; } };
      const preview = s.prepareReset();
      const current = action === "create" ? s.createCharacter("Created", "monk", "mage")
        : preview.status === "ready" ? s.resetSave(preview.intent) : Promise.reject(new Error("Reset preview failed"));
      await drainUntil(() => entered); const state = s.getSnapshot();
      if (oldResult === "reject") old.reject(new Error("Old worker failed")); else old.resolve(); await revoked;
      expect(s.getSnapshot()).toBe(state); expect(s.dispatch({ type: "devUnlockZones" }).ok).toBe(false);
      expect((await s.createCharacter("Duplicate", "monk", "mage"))).toMatchObject({ status: "rejected", reason: "busy" });
      expect((s as unknown as { running: boolean }).running).toBe(false);
      held.resolve(); expect((await current).status).toBe(action === "create" ? "created" : "reset");
      expect(s.getSnapshot().phase).toBe(action === "create" ? "playing" : "create");
      expect(s.profile?.character.name ?? null).toBe(action === "create" ? "Created" : null);
    },
  );
});

describe("SAVE-GUARD-001A-R2 current startup ready", () => {
  it.each(["empty", "loaded", "unsupported", "io", "worker-failure"])("%s startup fulfills the same one-shot ready on its controlled endpoint", async kind => {
    const fs = new ProbeFs();
    if (kind !== "empty") {
      const p = profile("Original", kind === "worker-failure");
      if (kind === "worker-failure") p.clock.lastSettledWallMs = NOW - 31 * 60000;
      fs.files.set(paths.main, kind === "unsupported" ? unsupported() : serializeSave(p, 100));
    }
    if (kind === "io") fs.readHook = () => { throw new SaveStorageError("read", paths.main, { code: "OS-PLUG-FILE-0013" }); };
    if (kind === "worker-failure") vi.mocked(runOfflineCatchUp).mockRejectedValue(new Error("Current startup failed"));
    const s = session(fs), ready = s.ready; let completions = 0; void ready.then(() => { completions += 1; });
    await Promise.resolve(); expect(completions).toBe(0);
    await s.init(); expect(completions).toBe(1);
    expect(s.getSnapshot().phase).toBe(kind === "empty" ? "create" : kind === "loaded" ? "playing" : kind === "worker-failure" ? "error" : "storage-blocked");
    if (kind === "empty") expect((await s.createCharacter("Created", "monk", "mage")).status).toBe("created");
    await s.retryStorage(); await s.init();
    expect(s.ready).toBe(ready); expect(completions).toBe(1);
  });

  it.each(["resolve", "reject"].flatMap(oldResult => ["old-first", "current-first"].map(order => ({ oldResult, order }))))(
    "$oldResult old init / verified-empty retry and create / $order completes only current startup", async ({ oldResult, order }) => {
      const fs = new ProbeFs(), original = profile("Original", true); original.clock.lastSettledWallMs = NOW - 31 * 60000;
      fs.files.set(paths.main, serializeSave(original, 100)); const s = session(fs), ready = s.ready, old = pending<void>();
      let completions = 0; void ready.then(() => { completions += 1; });
      vi.mocked(runOfflineCatchUp).mockImplementation(async input => {
        await old.promise; const copy = cloneProfile(input); copy.character.name = "Revoked";
        return { profile: copy, summary: simulateOffline(copy, content, 0, NOW), computeMs: 1, totalMs: 1, mode: "worker" };
      });
      const first = s.init(); await drainUntil(() => vi.mocked(runOfflineCatchUp).mock.calls.length === 1);
      fs.files.clear(); // Synthetic external absence; never device data or a recovery reset.
      const inspection = pending<void>(); let held = false;
      if (order === "old-first") {
        const read = fs.read.bind(fs);
        fs.read = async path => { const raw = await read(path); if (path === paths.main && !held) { held = true; await inspection.promise; } return raw; };
      }
      const retry = s.retryStorage();
      const finishOld = async () => { if (oldResult === "reject") old.reject(new Error("Old startup failed")); else old.resolve(); await first; };
      if (order === "old-first") {
        await drainUntil(() => held); await finishOld();
        expect(completions).toBe(0); expect(s.getSnapshot().phase).toBe("storage-blocked"); expect(fs.mutations).toEqual([]);
        inspection.resolve();
      }
      await retry; expect(s.getSnapshot().phase).toBe("create"); expect(completions).toBe(1);
      expect(fs.mutations).toEqual([]); expect((s as unknown as { running: boolean }).running).toBe(false);
      const created = await s.createCharacter("Created", "monk", "mage");
      expect(created).toMatchObject({ status: "created", receipt: { readbackVerified: true } });
      const snapshot = s.getSnapshot(), files = filesSnapshot(fs);
      expect(completions).toBe(1); expect(snapshot.phase).toBe("playing"); expect(s.profile?.character.name).toBe("Created");
      if (order === "current-first") await finishOld();
      expect(s.getSnapshot()).toBe(snapshot); expect(filesSnapshot(fs)).toEqual(files); expect(s.ready).toBe(ready); expect(completions).toBe(1);
      expect((s as unknown as { running: boolean }).running).toBe(true);
    },
  );

  it.each(["resolve", "reject"])("stale empty retry and %s old worker cannot fulfill newer pending init", async oldResult => {
    const fs = new ProbeFs(), original = profile("Original", true); original.clock.lastSettledWallMs = NOW - 31 * 60000;
    fs.files.set(paths.main, serializeSave(original, 100)); const s = session(fs), old = pending<void>(), current = pending<void>();
    let calls = 0, completions = 0; void s.ready.then(() => { completions += 1; });
    vi.mocked(runOfflineCatchUp).mockImplementation(async input => {
      const call = ++calls; await (call === 1 ? old.promise : current.promise);
      const copy = cloneProfile(input); copy.character.name = call === 1 ? "Revoked" : "Current";
      return { profile: copy, summary: simulateOffline(copy, content, 0, NOW), computeMs: 1, totalMs: 1, mode: "worker" };
    });
    const first = s.init(); await drainUntil(() => calls === 1); fs.files.clear();
    const inspection = pending<void>(), read = fs.read.bind(fs); let held = false;
    fs.read = async path => { const raw = await read(path); if (path === paths.main && !held) { held = true; await inspection.promise; } return raw; };
    const retry = s.retryStorage(); await drainUntil(() => held);
    fs.files.set(paths.main, serializeSave(original, 100)); const second = s.init();
    if (oldResult === "reject") old.reject(new Error("Revoked startup failed")); else old.resolve(); await first;
    expect(completions).toBe(0); inspection.resolve(); await retry; await drainUntil(() => calls === 2);
    expect(completions).toBe(0); expect(s.getSnapshot().phase).toBe("catching-up"); expect(fs.mutations).toEqual([]);
    expect(s.dispatch({ type: "devUnlockZones" }).ok).toBe(false); expect((s as unknown as { running: boolean }).running).toBe(false);
    current.resolve(); await second; expect(completions).toBe(1); expect(s.getSnapshot().phase).toBe("playing"); expect(s.profile?.character.name).toBe("Current");
  });

  it("a synchronous Continue subscriber on the empty screen supersedes retry before ready completion", async () => {
    const fs = new ProbeFs(), original = profile("Original", true); original.clock.lastSettledWallMs = NOW - 31 * 60000;
    fs.files.set(paths.main, serializeSave(original, 100)); const s = session(fs), old = pending<void>(), current = pending<void>();
    let calls = 0, completions = 0; void s.ready.then(() => { completions += 1; });
    vi.mocked(runOfflineCatchUp).mockImplementation(async input => {
      await (++calls === 1 ? old.promise : current.promise); const copy = cloneProfile(input);
      return { profile: copy, summary: simulateOffline(copy, content, 0, NOW), computeMs: 1, totalMs: 1, mode: "worker" };
    });
    const first = s.init(); await drainUntil(() => calls === 1); fs.files.clear(); let replacement: Promise<void> | null = null;
    const unsubscribe = s.subscribe(() => { if (s.getSnapshot().phase === "create" && !replacement) { fs.files.set(paths.main, serializeSave(original, 100)); replacement = s.init(); } });
    await s.retryStorage(); await drainUntil(() => calls === 2); old.resolve(); await first;
    expect(completions).toBe(0); expect(s.getSnapshot().phase).toBe("catching-up");
    current.resolve(); await replacement; unsubscribe(); expect(completions).toBe(1); expect(s.getSnapshot().phase).toBe("playing");
  });
});

describe("SAVE-GUARD-001A-R3 completed current refusal ready", () => {
  type Refusal = "corrupt" | "io" | "ownership" | "unsupported" | "rules";
  async function firstPending() {
    const fs = new ProbeFs(), original = profile("Original", true);
    original.clock.lastSettledWallMs = NOW - 31 * 60000;
    fs.files.set(paths.main, serializeSave(original, 100));
    let denied = false;
    const ownership = async <T>(work: () => Promise<T>): Promise<T> => {
      if (denied) throw new Error("Synthetic ownership denial");
      return work();
    };
    const s = new GameSession({ fs, ownership }); sessions.push(s);
    const ready = s.ready, old = pending<void>(); let completions = 0;
    void ready.then(() => { completions += 1; });
    vi.mocked(runOfflineCatchUp).mockImplementation(async input => {
      await old.promise; const copy = cloneProfile(input); copy.character.name = "Revoked";
      return { profile: copy, summary: simulateOffline(copy, content, 1000, NOW), computeMs: 1, totalMs: 1, mode: "worker" };
    });
    const first = s.init(); await drainUntil(() => vi.mocked(runOfflineCatchUp).mock.calls.length === 1);
    const refuse = (kind: Refusal) => {
      if (kind === "corrupt") fs.files.set(paths.main, "{corrupt");
      if (kind === "io") fs.readHook = () => { throw new SaveStorageError("read", paths.main, { code: "OS-PLUG-FILE-0013" }); };
      if (kind === "ownership") denied = true;
      if (kind === "unsupported") fs.files.set(paths.main, unsupported());
      if (kind === "rules") {
        fs.files.set(paths.main, changedPayload(serializeSave(original, 100), p => { p.rulesVersion = "emberbound-rules/older"; }));
      }
    };
    const live = s as unknown as { running: boolean; lastTick: number };
    live.lastTick = 12345;
    return { fs, s, ready, old, first, refuse, live, count: () => completions };
  }
  function finishOld(context: Awaited<ReturnType<typeof firstPending>>, result: string) {
    if (result === "reject") context.old.reject(new Error("Old startup failed")); else context.old.resolve();
    return context.first;
  }

  it.each(["corrupt", "io", "ownership"].flatMap(kind => ["resolve", "reject"].flatMap(oldResult => ["during-inspection", "after-refusal"].map(order => ({ kind, oldResult, order })))))(
    "$kind / old $oldResult / $order completes only the finished current refusal", async ({ kind, oldResult, order }) => {
      const c = await firstPending(), { fs, s } = c; c.refuse(kind as Refusal);
      const files = filesSnapshot(fs), profileText = JSON.stringify(s.profile), settlement = s.lastSettlement;
      const inspection = pending<void>(), read = fs.read.bind(fs); let held = false;
      if (order === "during-inspection") fs.read = async path => {
        if (path === paths.main && !held) { held = true; await inspection.promise; }
        return read(path);
      };
      const retry = s.retryStorage();
      expect(c.count()).toBe(0); expect(c.live.running).toBe(false); expect(fs.mutations).toEqual([]);
      if (order === "during-inspection") {
        await drainUntil(() => held); await finishOld(c, oldResult);
        expect(c.count()).toBe(0); expect(s.getSnapshot().phase).toBe("storage-blocked");
        expect(fs.mutations).toEqual([]); inspection.resolve();
      }
      const gate = await retry;
      expect(gate).toMatchObject({ mode: "blocked", reason: kind, canCreate: false, canImport: false, canReset: false });
      expect(c.count()).toBe(1); expect(s.ready).toBe(c.ready);
      const snapshot = s.getSnapshot();
      if (order === "after-refusal") await finishOld(c, oldResult);
      expect(s.getSnapshot()).toBe(snapshot); expect(filesSnapshot(fs)).toEqual(files); expect(fs.mutations).toEqual([]);
      expect(JSON.stringify(s.profile)).toBe(profileText); expect(s.lastSettlement).toBe(settlement); expect(c.live.lastTick).toBe(12345);
      expect(c.live.running).toBe(false); expect(c.count()).toBe(1); expect(s.ready).toBe(c.ready);
      expect(s.dispatch({ type: "devUnlockZones" }).ok).toBe(false);
      expect((await s.createCharacter("Forbidden", "monk", "mage")).status).toBe("blocked");
      expect((await s.saveNow()).status).toBe("blocked"); expect(fs.mutations).toEqual([]);
      await s.retryStorage(); expect(c.count()).toBe(1); expect(s.ready).toBe(c.ready);
    },
  );

  it.each(["unsupported", "rules"].flatMap(kind => ["resolve", "reject"].map(oldResult => ({ kind, oldResult })) ))(
    "reachable $kind refusal completes before old $oldResult without opening storage", async ({ kind, oldResult }) => {
      const c = await firstPending(); c.refuse(kind as Refusal);
      const files = filesSnapshot(c.fs), profileText = JSON.stringify(c.s.profile), settlement = c.s.lastSettlement;
      expect(await c.s.retryStorage()).toMatchObject({ mode: "blocked", reason: kind });
      expect(c.count()).toBe(1); const snapshot = c.s.getSnapshot(); await finishOld(c, oldResult);
      expect(c.s.getSnapshot()).toBe(snapshot); expect(filesSnapshot(c.fs)).toEqual(files); expect(c.fs.mutations).toEqual([]);
      expect(JSON.stringify(c.s.profile)).toBe(profileText); expect(c.s.lastSettlement).toBe(settlement);
      expect(c.live.running).toBe(false); expect(c.live.lastTick).toBe(12345); expect(c.s.ready).toBe(c.ready); expect(c.count()).toBe(1);
    },
  );

  it.each(["resolve", "reject"])("writable paused Retry and old %s remain pending until explicit Continue", async oldResult => {
    const c = await firstPending(), files = filesSnapshot(c.fs), current = pending<void>();
    expect((await c.s.retryStorage()).mode).toBe("writable"); const snapshot = c.s.getSnapshot();
    await finishOld(c, oldResult); expect(c.count()).toBe(0); expect(c.s.getSnapshot()).toBe(snapshot);
    expect(filesSnapshot(c.fs)).toEqual(files); expect(c.fs.mutations).toEqual([]); expect(c.live.running).toBe(false);
    vi.mocked(runOfflineCatchUp).mockImplementation(async input => {
      await current.promise; const copy = cloneProfile(input); copy.character.name = "Current";
      return { profile: copy, summary: simulateOffline(copy, content, 1000, NOW), computeMs: 1, totalMs: 1, mode: "worker" };
    });
    const continued = c.s.init(); await drainUntil(() => vi.mocked(runOfflineCatchUp).mock.calls.length === 2);
    expect(c.count()).toBe(0); current.resolve(); await continued;
    expect(c.count()).toBe(1); expect(c.s.ready).toBe(c.ready); expect(c.s.profile?.character.name).toBe("Current");
  });

  it.each(["resolve", "reject"])("stale refusal inspection and old %s cannot finish a newer pending init", async oldResult => {
    const c = await firstPending(); c.refuse("corrupt");
    const read = c.fs.read.bind(c.fs), inspection = pending<void>(), current = pending<void>(); let held = false;
    c.fs.read = async path => {
      const raw = await read(path); if (path === paths.main && !held) { held = true; await inspection.promise; } return raw;
    };
    const retry = c.s.retryStorage(); await drainUntil(() => held);
    const replacement = profile("Replacement", true); replacement.clock.lastSettledWallMs = NOW - 31 * 60000;
    c.fs.files.set(paths.main, serializeSave(replacement, 500));
    vi.mocked(runOfflineCatchUp).mockImplementation(async input => {
      await current.promise; const copy = cloneProfile(input); copy.character.name = "Current";
      return { profile: copy, summary: simulateOffline(copy, content, 1000, NOW), computeMs: 1, totalMs: 1, mode: "worker" };
    });
    const second = c.s.init(); const loading = c.s.getSnapshot(); await finishOld(c, oldResult);
    expect(c.count()).toBe(0); expect(c.s.getSnapshot()).toBe(loading); inspection.resolve(); await retry;
    await drainUntil(() => vi.mocked(runOfflineCatchUp).mock.calls.length === 2);
    expect(c.count()).toBe(0); expect(c.s.getSnapshot().phase).toBe("catching-up");
    expect(c.fs.mutations).toEqual([]); expect(c.live.running).toBe(false);
    current.resolve(); await second; expect(c.count()).toBe(1); expect(c.s.profile?.character.name).toBe("Current");
  });

  it.each(["resolve", "reject"].flatMap(oldResult => ["temporary", "completed"].map(publication => ({ oldResult, publication })) ))(
    "$publication block subscriber supersedes Retry before old $oldResult can finish ready", async ({ oldResult, publication }) => {
      const c = await firstPending(); if (publication === "completed") c.refuse("corrupt");
      const current = pending<void>();
      vi.mocked(runOfflineCatchUp).mockImplementation(async input => {
        await current.promise; const copy = cloneProfile(input); copy.character.name = "Current";
        return { profile: copy, summary: simulateOffline(copy, content, 1000, NOW), computeMs: 1, totalMs: 1, mode: "worker" };
      });
      let fired = false, second: Promise<void> | undefined;
      const off = c.s.subscribe(() => {
        const snapshot = c.s.getSnapshot();
        if (!fired && snapshot.phase === "storage-blocked" && (publication === "temporary" || snapshot.save.gate.reason === "corrupt")) {
          fired = true; expect(c.count()).toBe(0);
          const replacement = profile("Replacement", true); replacement.clock.lastSettledWallMs = NOW - 31 * 60000;
          c.fs.files.set(paths.main, serializeSave(replacement, 500)); second = c.s.init();
        }
      });
      await c.s.retryStorage(); await drainUntil(() => vi.mocked(runOfflineCatchUp).mock.calls.length === 2);
      await finishOld(c, oldResult); expect(c.count()).toBe(0); expect(c.s.getSnapshot().phase).toBe("catching-up");
      expect(c.fs.mutations).toEqual([]); expect(c.live.running).toBe(false); expect(c.s.dispatch({ type: "devUnlockZones" }).ok).toBe(false);
      current.resolve(); await second; off(); expect(c.count()).toBe(1); expect(c.s.ready).toBe(c.ready);
      expect(c.s.profile?.character.name).toBe("Current"); expect(c.live.running).toBe(true);
    },
  );
});


describe("SAVE-GUARD-001A-R4 refresh generation before synchronous subscribers", () => {
  it.each(["resolve", "reject"])("stale I/O inspection and old %s cannot revoke a newer init worker", async oldResult => {
    const fs = new ProbeFs(), original = profile("Original", true);
    original.clock.lastSettledWallMs = NOW - 31 * 60000;
    fs.files.set(paths.main, serializeSave(original, 100));
    const s = new GameSession({ fs, ownership: async work => work() }); sessions.push(s);
    const ready = s.ready, old = pending<void>(), current = pending<void>(); let completions = 0;
    void ready.then(() => { completions += 1; });
    vi.mocked(runOfflineCatchUp).mockImplementation(async input => {
      await old.promise; const copy = cloneProfile(input); copy.character.name = "Revoked";
      return { profile: copy, summary: simulateOffline(copy, content, 1000, NOW), computeMs: 1, totalMs: 1, mode: "worker" };
    });
    const first = s.init(); await drainUntil(() => vi.mocked(runOfflineCatchUp).mock.calls.length === 1);
    vi.mocked(runOfflineCatchUp).mockImplementation(async input => {
      await current.promise; const copy = cloneProfile(input); copy.character.name = "Current";
      return { profile: copy, summary: simulateOffline(copy, content, 1000, NOW), computeMs: 1, totalMs: 1, mode: "worker" };
    });
    let reads = 0, inject = true, fired = false, second: Promise<void> | undefined;
    // The nested current inspection reads valid main first. Only the superseded
    // inspection's second main read fails; disable this synthetic fault before save.
    fs.readHook = (path, raw) => {
      if (path === paths.main && inject && ++reads === 2) throw new SaveStorageError("read", path, { code: "OS-PLUG-FILE-0013" });
      return raw;
    };
    const off = s.subscribe(() => {
      if (!fired && s.getSnapshot().save.gate.mode === "uninspected") {
        fired = true; const replacement = profile("Replacement", true);
        replacement.clock.lastSettledWallMs = NOW - 31 * 60000;
        fs.files.set(paths.main, serializeSave(replacement, 500)); second = s.init();
      }
    });
    const live = s as unknown as { ownerEpoch: number; running: boolean; guard: { idle: Promise<void> } };
    const retry = s.retryStorage(); await drainUntil(() => vi.mocked(runOfflineCatchUp).mock.calls.length === 2);
    const owner = live.ownerEpoch; await retry; await live.guard.idle;
    const pendingSnapshot = s.getSnapshot(), pendingOwner = live.ownerEpoch;
    const pendingReady = completions, pendingRunning = live.running, files = filesSnapshot(fs);
    if (oldResult === "reject") old.reject(new Error("Revoked startup failed")); else old.resolve(); await first;
    const oldUnchanged = s.getSnapshot() === pendingSnapshot && JSON.stringify(filesSnapshot(fs)) === JSON.stringify(files);
    const oldReady = completions, oldMutations = [...fs.mutations];
    inject = false; current.resolve(); await second; off(); await Promise.resolve();
    // Drain both workers and the inspections before any normative failure assertion.
    expect(reads).toBe(2); expect(pendingSnapshot.phase).toBe("catching-up");
    expect(pendingSnapshot.save.gate.mode).toBe("writable"); expect(pendingOwner).toBe(owner);
    expect(pendingReady).toBe(0); expect(pendingRunning).toBe(false);
    expect(oldUnchanged).toBe(true); expect(oldReady).toBe(0); expect(oldMutations).toEqual([]);
    expect(s.getSnapshot().phase).toBe("playing"); expect(s.profile?.character.name).toBe("Current");
    expect(s.profile?.clock.lastSettledWallMs).toBe(NOW); expect(s.lastSettlement).not.toBeNull();
    expect(completions).toBe(1); expect(s.ready).toBe(ready); expect(live.running).toBe(true);
    expect(fs.mutations.filter(op => op === "write:" + paths.temp)).toHaveLength(1);
    const main = fs.files.get(paths.main)!;
    expect(parseSave(main).ok).toBe(true); expect(JSON.parse(JSON.parse(main).payload).character.name).toBe("Current");
    expect(s.getSnapshot().save).toMatchObject({ lastSavedWallMs: NOW, mainHash: sha256Hex(main), bytes: new TextEncoder().encode(main).byteLength });
  });
});
