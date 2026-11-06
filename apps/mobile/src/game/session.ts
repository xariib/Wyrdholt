import { CONTENT, DEV_SAMPLE_ITEMS, FORGE_V1 } from "@emberbound/game-content";
import {
  ContentIndex,
  FightCache,
  RULES_VERSION,
  advanceAdventure,
  applyCommand,
  canonicalJson,
  createProfile,
  heroStatsFor,
  parseSave,
  prepareFight,
  serializeSave,
  cloneProfile,
  type AdventureEvent,
  type Command,
  type CommandResult,
  type OfflineSummary,
  type PreparedFight,
  type Profile,
  type RunResult,
  type RunState,
  type SaveFileAdapter,
} from "@emberbound/game-core";
import type { FightRecord, ForgeInput } from "@emberbound/shared-types";
import { perfMonitor } from "../platform/perfMonitor";
import { randomSeed, DEV_TOOLS } from "../platform/device";
import { CapacitorSaveFs, storageDescription, withStorageOwnership, type SaveOwnership } from "../platform/storage";
import { SaveGuard, initialSaveGate, type GateInfo, type SaveOutcome, type ActionOutcome, type SaveIntent, type SaveSlot } from "./saveGuard";
export type { GateInfo, SaveOutcome, ActionOutcome, SaveIntent, SaveSlot } from "./saveGuard";
import { runOfflineCatchUp } from "./offlineRunner";
import { resumeAfterDefeat, settlementTelemetry, type SettlementTelemetry } from "./settlement";
import { buildState, recordAttempt } from "./attempts";

/**
 * GameSession owns the authoritative profile on the client and the
 * simulation clock. It is framework-agnostic:
 * - React subscribes to coarse UI snapshots (bumped on meaningful changes only).
 * - The PixiJS renderer subscribes to per-frame CombatFrames and only reads them.
 * Neither can change combat outcomes; all changes go through game-core commands.
 */

export type SessionPhase = "loading" | "create" | "catching-up" | "playing" | "error" | "storage-blocked";

export interface Toast {
  id: number;
  text: string;
  tone: "info" | "loot" | "success" | "warning";
}

export interface UiState {
  version: number;
  phase: SessionPhase;
  profile: Profile | null;
  offline: OfflineView | null;
  runResult: RunResult | null;
  toast: Toast | null;
  /** Shown on the create screen (e.g. an outdated test-build save was set aside). */
  notice: string | null;
  save: { lastSavedWallMs: number | null; bytes: number; mainHash: string | null; storage: string; loadedFrom: string; problems: string[]; gate: GateInfo };
  error: string | null;
  busy: string | null;
}

export interface OfflineView {
  summary: OfflineSummary;
  computeMs: number;
  totalMs: number;
  mode: string;
  kept: boolean;
  /** Notable finds resolved from the simulated profile (works for discarded benchmarks too). */
  notable: { instanceId: number; baseId: string }[];
  /** Before/after measurement of the settlement (shown in the summary and its developer details). */
  telemetry: SettlementTelemetry;
  /** The profile after the settlement (attempt history lookups). */
  profileAfter: Profile;
}

function notableFrom(profile: Profile, summary: OfflineSummary): OfflineView["notable"] {
  const out: OfflineView["notable"] = [];
  for (const id of summary.notableInstanceIds) {
    const inst = profile.inventory.instances.find((i) => i.id === id);
    if (inst) out.push({ instanceId: id, baseId: inst.baseId });
  }
  return out;
}

export interface CombatFrame {
  activity: Profile["adventure"]["activity"];
  run: RunState | null;
  /** Fight currently resolving (phase = fight). */
  fight: PreparedFight | null;
  /** Most recent fight that finished (shown during rests and after a defeat). */
  lastFight: PreparedFight | null;
  /** Playback position inside `fight`, in simulation ms. */
  elapsedMs: number;
  heroMaxHp100: number;
  /** HP the hero carries into the current/next stage (x100, null = full). */
  carriedHp100: number | null;
  frameId: number;
}

type Listener = () => void;
type FrameListener = (frame: CombatFrame) => void;

const AUTOSAVE_MS = 10_000;
const SHOW_OFFLINE_SUMMARY_MS = 60_000;
/** Absences up to this length are settled on the main thread (see OfflineRunOptions). */
const MAIN_THREAD_CATCH_UP_MS = 30 * 60_000;
const MAX_FRAME_STEP_MS = 5_000;

export class GameSession {
  readonly content = new ContentIndex(CONTENT);
  readonly rulesVersion = RULES_VERSION;
  private readonly fs: SaveFileAdapter;
  private readonly guard: SaveGuard;
  private ownerEpoch = 0;
  private actionOwner: number | null = null;
  // A current init can end in refusal, which itself revokes the save owner.
  // Startup completion belongs to the request, not that revoked save epoch.
  private initRequest = 0;
  private readonly cache = new FightCache(6);
  private ui: UiState = {
    version: 0,
    phase: "loading",
    profile: null,
    offline: null,
    runResult: null,
    toast: null,
    notice: null,
    save: { lastSavedWallMs: null, bytes: 0, mainHash: null, storage: storageDescription(), loadedFrom: "-", problems: [], gate: initialSaveGate() },
    error: null,
    busy: null,
  };
  private readonly listeners = new Set<Listener>();
  private readonly frameListeners = new Set<FrameListener>();
  private raf = 0;
  private running = false;
  private lastTick = 0;
  private carryMs = 0;
  private frameId = 0;
  private lastFight: PreparedFight | null = null;
  private currentFightKey = "";
  private saveChain: Promise<void> = Promise.resolve();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private lastAutosave = 0;
  private toastSeq = 0;
  private catchingUp = false;
  private foreground = true;
  private foregroundTask: Promise<void> | null = null;
  private itemActionTask: Promise<CommandResult> | null = null;
  private catchUpTask: Promise<void> | null = null;
  private catchUpThroughWallMs = 0;
  /** What the most recent kept offline settlement changed (developer progress check). */
  lastSettlement: SettlementTelemetry | null = null;

  constructor(options: { fs?: SaveFileAdapter; ownership?: SaveOwnership } = {}) {
    this.fs = options.fs ?? new CapacitorSaveFs();
    this.guard = new SaveGuard(this.fs, RULES_VERSION, options.ownership ?? withStorageOwnership, (gate) => {
      if (gate.mode === "blocked" || gate.mode === "uninspected") {
        this.ownerEpoch += 1;
        this.actionOwner = null;
        this.pauseLive();
        this.catchingUp = false;
        this.catchUpTask = null;
        this.foregroundTask = null;
      }
      this.bump({
        save: { ...this.ui.save, gate },
        ...(gate.mode === "blocked" ? { phase: "storage-blocked", busy: null, error: `Save access blocked (${gate.reason}). Automatic changes are paused.` } : {}),
      });
    });
  }
  private pauseLive(): void {
    this.stopClock();
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
  }
  private canSettle(): boolean {
    return this.guard.gate.mode === "writable" && this.actionOwner === null
      && (this.ui.phase === "loading" || this.ui.phase === "playing" || this.ui.phase === "catching-up");
  }
  private canPlay(): boolean {
    return this.canSettle() && this.ui.phase !== "loading";
  }
  private blockedResult(): Extract<SaveOutcome, { status: "blocked" }> {
    return { status: "blocked", reason: this.guard.gate.reason ?? "ownership", generation: this.guard.gate.generation };
  }
  private track<T>(work: Promise<T>): Promise<T> {
    this.saveChain = work.then(() => undefined, () => undefined);
    return work;
  }
  private acknowledge(receipt: Extract<SaveOutcome, { status: "saved" }>): void {
    this.bump({ save: { ...this.ui.save, lastSavedWallMs: receipt.savedAtWallMs, bytes: receipt.bytes, mainHash: receipt.mainHash } });
  }
  private beginAction(): number {
    this.ownerEpoch += 1;
    this.actionOwner = this.ownerEpoch;
    this.pauseLive();
    return this.ownerEpoch;
  }
  private finishAction(epoch: number, preserveLiveTime = false): void {
    if (epoch !== this.ownerEpoch || this.actionOwner !== epoch) return;
    const lastTick = this.lastTick, carryMs = this.carryMs;
    this.actionOwner = null;
    this.startClock();
    // Locks/salvage only suspend mutation while saving. Keep outstanding frame time;
    // the next frame advances it, or uses normal wall-clock catch-up for a long gap.
    // Background/foreground still owns its usual settlement when no clock starts.
    if (preserveLiveTime && this.running) {
      this.lastTick = lastTick;
      this.carryMs = carryMs;
    }
  }

  // ------------------------------------------------------------------ store

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): UiState => this.ui;

  onFrame(listener: FrameListener): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  private bump(patch: Partial<UiState> = {}): void {
    this.ui = { ...this.ui, ...patch, version: this.ui.version + 1 };
    for (const l of this.listeners) l();
  }

  get profile(): Profile | null {
    return this.ui.profile;
  }

  // -------------------------------------------------------------- lifecycle

  private resolveReady: () => void = () => undefined;
  /**
   * Resolves once startup has finished (save loaded and time away settled, or the
   * create-character screen is shown). Heavy optional work such as loading PixiJS
   * waits for this so it cannot delay the first interactive screen (F6).
   */
  readonly ready: Promise<void> = new Promise((resolve) => {
    this.resolveReady = resolve;
  });

  private completeStartup(request: number): void {
    if (request !== this.initRequest) return;
    if (this.ui.phase === "create" || this.ui.phase === "playing"
      || this.ui.phase === "storage-blocked" || this.ui.phase === "error") this.resolveReady();
  }

  async init(): Promise<void> {
    const request = ++this.initRequest;
    this.pauseLive();
    this.bump({ phase: "loading", profile: null, busy: null, error: null, offline: null, runResult: null });
    const inspection = this.track(this.guard.refresh());
    const epoch = this.ownerEpoch;
    try {
      const inspected = await inspection;
      if (epoch !== this.ownerEpoch) return;
      const loaded = inspected.loaded;
      perfMonitor.mark("saveLoaded");
      if (inspected.gate.mode === "blocked") return;
      if (loaded?.status === "loaded") {
        const profile = loaded.result.profile;
        this.bump({
          profile,
          save: { ...this.ui.save, loadedFrom: loaded.source, problems: loaded.problems },
        });
        await this.catchUp(Date.now(), "startup");
        if (epoch !== this.ownerEpoch) return;
        perfMonitor.mark("catchUpDone");
        this.startClock();
      } else if (inspected.gate.mode === "verified-empty") {
        this.bump({
          phase: "create",
          save: {
            ...this.ui.save,
            loadedFrom: "none",
            problems: [],
          },
        });
      }
    } catch (error) {
      if (epoch !== this.ownerEpoch) return;
      this.guard.block("profile");
      this.bump({ phase: "error", error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (request === this.initRequest) {
        perfMonitor.markStartup();
        this.completeStartup(request);
      }
    }
  }

  async createCharacter(name: string, activeClassId: string, alternateClassId: string): Promise<ActionOutcome> {
    if (this.actionOwner !== null || this.catchingUp || this.ui.phase === "loading") return { status: "rejected", reason: "busy", message: "Another character operation is pending." };
    if (!this.guard.gate.canCreate) return this.guard.gate.mode === "writable"
      ? { status: "rejected", reason: "not-empty", message: "Existing saves cannot be replaced by character creation." } : this.blockedResult();
    const request = this.initRequest;
    const epoch = this.beginAction();
    try {
      const now = Date.now();
      const profile = createProfile(this.content, {
        name,
        activeClassId,
        alternateClassId,
        masterSeed: randomSeed(),
        nowWallMs: now,
      });
      applyCommand(profile, this.content, { type: "startPush", zoneId: "greenfields" }, { contentTimeMs: now });
      const receipt = await this.track(this.guard.write(() => serializeSave(profile, now), {
        emptyOnly: true, newOwner: true, isCurrent: () => epoch === this.ownerEpoch,
      }));
      if (receipt.status !== "saved") return receipt;
      if (epoch !== this.ownerEpoch) return { status: "skipped", reason: "stale-generation" };
      this.acknowledge(receipt);
      this.bump({ profile, phase: "playing", notice: null, error: null });
      this.completeStartup(request);
      return { status: "created", receipt };
    } catch (error) {
      return { status: "rejected", reason: "invalid", message: error instanceof Error ? error.message : String(error) };
    } finally {
      this.finishAction(epoch);
    }
  }

  /** App went to the background: stop the clock and persist immediately. */
  handleBackground(): void {
    this.foreground = false;
    this.stopClock();
    perfMonitor.pause();
    const profile = this.profile;
    if (!profile || this.catchingUp || !this.canPlay()) return;
    profile.clock.lastSettledWallMs = Date.now();
    void this.saveNow();
  }

  /** App returned: settle the time spent away with offline rules, then resume. */
  async handleForeground(): Promise<void> {
    this.foreground = true;
    if (this.itemActionTask) await this.itemActionTask;
    if (!this.profile || this.ui.phase === "create" || !this.canPlay()) return;
    // Capacitor and document visibility may report the same resume. Share the work;
    // a later background event still wins when the asynchronous worker resolves.
    // Even coalesced callers must register their return time with the settlement owner.
    const work = this.catchUp(Date.now(), "resume");
    if (!this.foregroundTask) {
      const epoch = this.ownerEpoch;
      const task = work.then(() => {
        if (epoch !== this.ownerEpoch) return;
        this.startClock();
        if (this.foreground && this.ui.phase === "playing") perfMonitor.start();
      }).finally(() => { if (this.foregroundTask === task) this.foregroundTask = null; });
      this.foregroundTask = task;
    }
    await this.foregroundTask;
  }

  private catchUp(nowWallMs: number, reason: "startup" | "resume"): Promise<void> {
    if (!this.canSettle()) return Promise.resolve();
    if (this.catchUpTask) {
      this.catchUpThroughWallMs = Math.max(this.catchUpThroughWallMs, nowWallMs);
      return this.catchUpTask;
    }
    // The DEV benchmark is a separate owner; never spin while it holds the profile.
    if (this.catchingUp) return Promise.resolve();
    this.catchUpThroughWallMs = nowWallMs;
    const epoch = this.ownerEpoch;
    const task = (async () => {
      do {
        const target = this.catchUpThroughWallMs;
        await this.settleCatchUp(target, reason);
        if (!this.profile || !this.canSettle() || epoch !== this.ownerEpoch) break;
        // A later return arrived while the worker was pending. Settle only the tail,
        // from the newly committed profile, before any caller resumes the live clock.
      } while (this.profile.clock.lastSettledWallMs < this.catchUpThroughWallMs);
    })().catch(error => {
      if (epoch !== this.ownerEpoch) return;
      this.guard.block("profile");
      this.bump({ phase: "error", busy: null, error: `Offline catch-up failed: ${String(error)}` });
    }).finally(() => { if (this.catchUpTask === task) this.catchUpTask = null; });
    this.catchUpTask = task;
    return task;
  }

  private async settleCatchUp(nowWallMs: number, reason: "startup" | "resume"): Promise<void> {
    const profile = this.profile;
    if (!profile || this.catchingUp || !this.canSettle()) return;
    const epoch = this.ownerEpoch;
    const working = cloneProfile(profile);
    const elapsed = Math.max(0, nowWallMs - profile.clock.lastSettledWallMs);
    // A character left standing after a defeat (e.g. the app was closed on the result
    // screen, or a save from the C1 playtest build) farms safely instead of idling.
    const failed = profile.adventure.lastResult;
    const resumed = resumeAfterDefeat(working, this.content, nowWallMs);
    const resumedFrom =
      resumed && failed
        ? `${failed.mode} ${this.content.zone(failed.zoneId).name} failed at stage ${failed.stage}; started ${resumed.mode} ${this.content.zone(resumed.zoneId).name}`
        : null;
    if (elapsed < 1_000 || working.adventure.activity === "idle") {
      working.clock.lastSettledWallMs = Math.max(profile.clock.lastSettledWallMs, nowWallMs);
      this.bump({ profile: working, phase: "playing" });
      return;
    }
    this.catchingUp = true;
    // Short absences settle in a few ms; skip the busy screen (one less full render, F6).
    if (elapsed > MAIN_THREAD_CATCH_UP_MS) {
      this.bump({ phase: "catching-up", busy: reason === "startup" ? "Returning to your adventure…" : "Catching up…" });
    }
    try {
      const result = await runOfflineCatchUp(working, elapsed, nowWallMs, {
        content: this.content,
        mainThreadUpToMs: MAIN_THREAD_CATCH_UP_MS,
      });
      if (this.profile !== profile || epoch !== this.ownerEpoch || !this.canSettle()) return;
      result.profile.clock.lastSettledWallMs = Math.max(profile.clock.lastSettledWallMs, nowWallMs);
      perfMonitor.recordCatchUp({
        kind: "return",
        simulatedMs: result.summary.simulatedMs,
        totalMs: Math.round(result.totalMs),
        computeMs: Math.round(result.computeMs),
        mode: result.mode,
      });
      this.cache.clearFights();
      this.lastFight = null;
      const telemetry = settlementTelemetry(this.content, profile, result.profile, result.summary, resumedFrom);
      const push = result.summary.push;
      if (push.status !== "none" && push.zoneId) {
        // The offline Push runs at the start of the absence, with the build the player left.
        const total = this.content.zone(push.zoneId).stages.length;
        recordAttempt(
          result.profile,
          this.content,
          { zoneId: push.zoneId, cleared: push.status === "cleared", stage: push.stage, stagesTotal: total, enemyHp100: push.enemyHp100, enemyMaxHp100: push.enemyMaxHp100 },
          "offline",
          profile.clock.lastSettledWallMs,
          buildState(profile, this.content),
        );
      }
      // Keep the simulated replacement private until the actual main is read back.
      const receipt = await this.track(this.guard.write(() => serializeSave(result.profile, Date.now()), {
        isCurrent: () => epoch === this.ownerEpoch && this.profile === profile,
      }));
      if (receipt.status !== "saved" || epoch !== this.ownerEpoch || this.profile !== profile) return;
      this.acknowledge(receipt);
      this.lastSettlement = telemetry;
      const show = elapsed >= SHOW_OFFLINE_SUMMARY_MS || result.summary.push.status !== "none";
      this.bump({
        profile: result.profile,
        phase: "playing",
        busy: null,
        offline: show
          ? {
              summary: result.summary,
              computeMs: result.computeMs,
              totalMs: result.totalMs,
              mode: result.mode,
              kept: true,
              notable: notableFrom(result.profile, result.summary),
              telemetry,
              profileAfter: result.profile,
            }
          : this.ui.offline,
      });
      // Publication follows the receipt; a failed write leaves the old profile paused.
    } catch (error) {
      if (epoch !== this.ownerEpoch) return;
      this.guard.block("profile");
      this.bump({ phase: "error", busy: null, error: `Offline catch-up failed: ${String(error)}` });
    } finally {
      if (epoch === this.ownerEpoch) this.catchingUp = false;
    }
  }

  // ------------------------------------------------------------------ clock

  private startClock(): void {
    if (this.running || !this.profile || !this.foreground || this.catchingUp || this.ui.phase !== "playing" || !this.canPlay()) return;
    this.running = true;
    this.lastTick = performance.now();
    this.carryMs = 0;
    const loop = (now: number): void => {
      if (!this.running) return;
      this.tick(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private stopClock(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private tick(now: number): void {
    const profile = this.profile;
    if (!profile || this.catchingUp || !this.canPlay()) return;
    let dt = now - this.lastTick;
    this.lastTick = now;
    if (dt > MAX_FRAME_STEP_MS) {
      // The page was frozen without a visibility event: settle by wall clock instead.
      this.stopClock();
      void this.catchUp(Date.now(), "resume").then(() => this.startClock());
      return;
    }
    if (dt < 0) dt = 0;
    this.carryMs += dt;
    const step = Math.floor(this.carryMs);
    this.carryMs -= step;

    const events: AdventureEvent[] = [];
    const wallNow = Date.now();
    if (step > 0) {
      advanceAdventure(profile, this.content, step, {
        offline: false,
        contentTimeMs: wallNow,
        recordEvents: true,
        cache: this.cache,
        onEvent: (e) => events.push(e),
      });
      profile.clock.lastSettledWallMs = wallNow;
    }
    if (events.length > 0) this.handleEvents(events);
    this.emitFrame(wallNow);
    if (now - this.lastAutosave > AUTOSAVE_MS) {
      this.lastAutosave = now;
      void this.saveNow();
    }
  }

  private emitFrame(wallNow: number): void {
    const profile = this.profile;
    if (!profile || this.frameListeners.size === 0) return;
    const run = profile.adventure.run;
    let fight: PreparedFight | null = null;
    if (run && run.phase === "fight" && profile.adventure.activity !== "idle") {
      fight = prepareFight(profile, this.content, run, { contentTimeMs: wallNow, recordEvents: true, cache: this.cache });
      if (fight.key !== this.currentFightKey) this.currentFightKey = fight.key;
    }
    const frame: CombatFrame = {
      activity: profile.adventure.activity,
      run,
      fight,
      lastFight: this.lastFight,
      elapsedMs: run?.elapsedMs ?? 0,
      heroMaxHp100: heroStatsFor(profile, this.content, this.cache).maxHp100,
      carriedHp100: run?.hp100 ?? null,
      frameId: (this.frameId += 1),
    };
    for (const l of this.frameListeners) l(frame);
  }

  private handleEvents(events: AdventureEvent[]): void {
    const profile = this.profile;
    if (!profile) return;
    let toast: Toast | null = null;
    let lootToast: Toast | null = null;
    let runResult: RunResult | null = this.ui.runResult;
    for (const e of events) {
      switch (e.type) {
        case "fightSettled": {
          const key = this.currentFightKey;
          const cached = key ? this.cache.peek(key) : undefined;
          if (cached) this.lastFight = cached;
          // Only notable (Rare+) finds get a toast; everything else just updates the Gear badge.
          const notable = e.itemIds
            .map((id) => profile.inventory.instances.find((i) => i.id === id))
            .filter((i) => i !== undefined)
            .map((i) => this.content.item(i.baseId))
            .filter((item) => this.content.rarity(item.rarity).notable);
          if (notable.length > 0) {
            lootToast = this.makeToast(
              `Found ${notable.map((item) => `${item.name} (${this.content.rarity(item.rarity).name})`).join(", ")}`,
              "loot",
            );
          }
          if (e.levelsGained > 0) toast = this.makeToast(`Level up! Character Level ${profile.character.level}`, "success");
          if (e.buildChanged) toast = this.makeToast("Queued build change applied", "info");
          break;
        }
        case "zoneCleared": {
          const zone = this.content.zone(e.zoneId);
          const unlocked = e.unlockedZoneIds.map((id) => this.content.zone(id).name).join(", ");
          toast = this.makeToast(
            e.firstClear ? `${zone.name} cleared!${unlocked ? ` ${unlocked} unlocked.` : ""}` : `${zone.name} cleared again`,
            "success",
          );
          break;
        }
        case "runEnded":
          if (e.result.kind !== "cleared") runResult = e.result;
          if (e.result.mode === "push") {
            const r = e.result;
            recordAttempt(
              profile,
              this.content,
              { zoneId: r.zoneId, cleared: r.kind === "cleared", stage: r.stage, stagesTotal: r.stagesTotal, enemyHp100: r.enemyHp100, enemyMaxHp100: r.enemyMaxHp100 },
              "online",
              Date.now(),
            );
          }
          break;
        default:
          break;
      }
    }
    if (profile.adventure.activity === "idle") {
      // Never stand still after a defeat: farm safe content while the player decides.
      const resumed = resumeAfterDefeat(profile, this.content, Date.now());
      if (resumed) {
        const name = this.content.zone(resumed.zoneId).name;
        toast = this.makeToast(resumed.mode === "trail" ? `Farming the ${name} trail while you decide` : `Farming ${name} while you decide`, "info");
      }
    }
    // A simultaneous level-up, queued equip or zone clear must not hide the actual drop.
    this.bump({ toast: lootToast ?? toast ?? this.ui.toast, runResult });
    this.scheduleSave();
  }

  private makeToast(text: string, tone: Toast["tone"]): Toast {
    this.toastSeq += 1;
    return { id: this.toastSeq, text, tone };
  }

  // --------------------------------------------------------------- commands

  /** Stage the entire fusion; publish only after guarded main-file readback. */
  forge(input: ForgeInput): Promise<CommandResult> {
    return this.saveItemCommand({ type: "forge", input });
  }

  /** The visible lock state is committed only after durable readback, like Forge. */
  setItemLock(instanceId: number, locked: boolean): Promise<CommandResult> {
    return this.saveItemCommand({ type: "setItemLock", instanceId, locked });
  }

  /** Removal and reward become visible together, only after durable main readback. */
  salvage(input: import("@emberbound/game-core").SalvageInput): Promise<CommandResult> {
    return this.saveItemCommand({ type: "salvage", input });
  }

  bulkSalvage(input: import("@emberbound/game-core").BulkSalvageInput): Promise<CommandResult> {
    // Capture confirmation before the deferred save task or caller can change it.
    return this.saveItemCommand({ type: "bulkSalvage", input: input && { ...input, copies: Array.isArray(input.copies) ? input.copies.map(c => c && { ...c }) : input.copies } });
  }

  private saveItemCommand(command: Extract<Command, { type: "forge" | "setItemLock" | "salvage" | "bulkSalvage" }>): Promise<CommandResult> {
    if (this.itemActionTask || !this.canPlay() || this.catchingUp || !this.foreground || !this.profile) {
      return Promise.resolve({ ok: false, error: "Wait for the current activity or save recovery to finish." });
    }
    const forging = command.type === "forge";
    const salvaging = command.type === "salvage" || command.type === "bulkSalvage";
    const actionName = forging ? "Fusion" : salvaging ? "Salvage" : "Item lock";
    const profile = this.profile;
    const epoch = this.beginAction();
    const work = async (): Promise<CommandResult> => {
      try {
        const candidate = cloneProfile(profile);
        const result = applyCommand(candidate, this.content, command, {
          contentTimeMs: Date.now(), forgeConfig: FORGE_V1, allowDevForge: DEV_TOOLS,
        });
        if (!result.ok) return result;
        this.bump({ busy: forging ? "Forging…" : salvaging ? "Saving salvage…" : "Saving item lock…" });
        const receipt = await this.track(this.guard.write(() => serializeSave(candidate, Date.now()), {
          isCurrent: () => epoch === this.ownerEpoch && this.profile === profile,
        }));
        if (receipt.status !== "saved" || epoch !== this.ownerEpoch || this.profile !== profile) {
          return { ok: false, error: `${actionName} was not confirmed saved. Use save recovery, then review your items before retrying.` };
        }
        this.acknowledge(receipt);
        if (epoch !== this.ownerEpoch || this.profile !== profile) return { ok: false, error: "The save owner changed. Reload your saved adventure." };
        this.bump({ profile: candidate });
        return result;
      } catch {
        if (epoch === this.ownerEpoch) this.guard.block("profile");
        return { ok: false, error: `${actionName} could not be saved. Use save recovery before retrying.` };
      } finally {
        if (epoch === this.ownerEpoch) this.bump({ busy: null });
        this.finishAction(epoch, !forging);
      }
    };
    // Defer work until the ticket is installed: synchronous store subscribers
    // cannot start another item action during the busy publication.
    const task = Promise.resolve().then(work).finally(() => {
      if (this.itemActionTask === task) this.itemActionTask = null;
    });
    this.itemActionTask = task;
    return task;
  }

  dispatch(command: Command): CommandResult {
    if (command.type === "forge") return { ok: false, error: "Use the saved Forge confirmation flow." };
    if (command.type === "salvage" || command.type === "bulkSalvage") return { ok: false, error: "Use the saved salvage confirmation flow." };
    if (command.type === "setItemLock") return { ok: false, error: "Use the saved item lock flow." };
    if (!this.canPlay() || this.catchingUp) return { ok: false, error: "Save access or settlement is paused; no command was applied." };
    const profile = this.profile;
    if (!profile) return { ok: false, error: "No character." };
    const result = applyCommand(profile, this.content, command, { contentTimeMs: Date.now(), forgeConfig: FORGE_V1, allowDevForge: DEV_TOOLS });
    const patch: Partial<UiState> = {};
    if (!result.ok) {
      patch.toast = this.makeToast(result.error, "warning");
    } else {
      if (command.type === "startPush" || command.type === "startFarm") patch.runResult = null;
      if (result.queued) patch.toast = this.makeToast("Queued — applies when this fight ends", "info");
    }
    this.bump(patch);
    this.scheduleSave();
    return result;
  }

  dismissOffline(): void {
    this.bump({ offline: null });
  }

  dismissRunResult(): void {
    this.bump({ runResult: null });
  }

  clearToast(id: number): void {
    if (this.ui.toast?.id === id) this.bump({ toast: null });
  }

  // ---------------------------------------------------------------- saving

  private scheduleSave(delayMs = 1_500): void {
    if (this.saveTimer || !this.canPlay()) return;
    const epoch = this.ownerEpoch;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (epoch === this.ownerEpoch) void this.saveNow();
    }, delayMs);
  }

  saveNow(): Promise<SaveOutcome> {
    if (!this.canPlay()) return Promise.resolve(this.blockedResult());
    const profile = this.profile;
    if (!profile) return Promise.resolve({ status: "skipped", reason: "no-profile" });
    const epoch = this.ownerEpoch;
    const now = Date.now();
    let copy: Profile;
    try { copy = cloneProfile(profile); }
    catch {
      this.guard.block("profile");
      return Promise.resolve({ status: "failed", stage: "serialize", storageMayHaveChanged: false });
    }
    return this.track(this.guard.write(() => serializeSave(copy, now), { isCurrent: () => epoch === this.ownerEpoch }))
      .then(receipt => {
        if (receipt.status === "saved" && epoch === this.ownerEpoch) this.acknowledge(receipt);
        if (receipt.status === "failed") this.bump({ toast: this.makeToast(`Save failed (${receipt.stage}).`, "warning") });
        return receipt;
      });
  }

  // ------------------------------------------------------------ dev tools

  grantSampleGear(): void {
    this.dispatch({ type: "devGrant", baseIds: [...DEV_SAMPLE_ITEMS] });
  }

  /** Visual checks of later zones. Spoils a pacing playtest (zones open early). */
  unlockAllZones(): void {
    this.dispatch({ type: "devUnlockZones" });
  }

  /** P3 benchmark. keep=false measures without changing the character. */
  async simulateOfflineReturn(hours: number, keep: boolean): Promise<void> {
    const profile = this.profile;
    if (!profile || this.catchingUp || !this.canPlay()) return;
    const epoch = this.beginAction();
    this.catchingUp = true;
    this.bump({ busy: `Simulating ${hours}h offline…` });
    try {
      const copy = cloneProfile(profile);
      const result = await runOfflineCatchUp(copy, hours * 3_600_000, Date.now());
      if (epoch !== this.ownerEpoch || this.profile !== profile || this.guard.gate.mode !== "writable") return;
      perfMonitor.recordCatchUp({
        kind: "benchmark",
        simulatedMs: result.summary.simulatedMs,
        totalMs: Math.round(result.totalMs),
        computeMs: Math.round(result.computeMs),
        mode: result.mode,
      });
      const patch: Partial<UiState> = {
        busy: null,
        offline: {
          summary: result.summary,
          computeMs: result.computeMs,
          totalMs: result.totalMs,
          mode: result.mode,
          kept: keep,
          notable: notableFrom(result.profile, result.summary),
          telemetry: settlementTelemetry(this.content, profile, result.profile, result.summary, null),
          profileAfter: result.profile,
        },
      };
      if (keep) {
        result.profile.clock.lastSettledWallMs = Date.now();
        const receipt = await this.track(this.guard.write(() => serializeSave(result.profile, Date.now()), {
          newOwner: true, isCurrent: () => epoch === this.ownerEpoch,
        }));
        if (receipt.status !== "saved" || epoch !== this.ownerEpoch) return;
        this.acknowledge(receipt);
        this.lastSettlement = patch.offline!.telemetry;
        patch.profile = result.profile;
        this.cache.clearFights();
        this.lastFight = null;
      }
      this.bump(patch);
    } catch (error) {
      if (epoch !== this.ownerEpoch) return;
      // Never leave the busy screen up if the benchmark fails.
      this.bump({ busy: null, toast: this.makeToast(`Catch-up benchmark failed: ${String(error)}`, "warning") });
    } finally {
      if (epoch === this.ownerEpoch) {
        this.catchingUp = false;
        this.lastTick = performance.now();
        this.finishAction(epoch);
      }
    }
  }

  currentFightRecord(): FightRecord | null {
    const profile = this.profile;
    const run = profile?.adventure.run;
    if (!profile || !run) return this.lastFight?.record ?? null;
    return prepareFight(profile, this.content, run, { contentTimeMs: Date.now(), recordEvents: false, cache: this.cache }).record;
  }

  /**
   * Developer tool: replace the character with a pasted save (e.g. a playtest export) to
   * reproduce its exact state. Time since the save's last settlement is caught up normally.
   */
  prepareImport(text: string): { status: "ready"; intent: SaveIntent } | Exclude<ActionOutcome, { status: "created" | "imported" | "reset" }> {
    if (!this.guard.gate.canImport) return this.blockedResult();
    try {
      const parsed = parseSave(text.trim());
      if (!parsed.ok || parsed.profile.rulesVersion !== RULES_VERSION) return { status: "rejected", reason: "invalid", message: "Import is not compatible with this build." };
      const intent = this.guard.prepareIntent("import", text);
      return intent ? { status: "ready", intent } : this.blockedResult();
    } catch { return { status: "rejected", reason: "invalid", message: "Import could not be decoded." }; }
  }

  async importSave(text: string, replaceIntent?: SaveIntent): Promise<ActionOutcome> {
    if (!this.guard.gate.canImport) return this.blockedResult();
    if (this.actionOwner !== null || this.catchingUp || this.ui.phase === "loading") return { status: "rejected", reason: "busy", message: "Another character operation is pending." };
    if (!this.guard.acceptsIntent(replaceIntent, "import", text)) return { status: "rejected", reason: "confirmation", message: "Preview and confirm this exact import first." };
    const epoch = this.beginAction();
    try {
      const parsed = parseSave(text.trim());
      if (!parsed.ok || parsed.profile.rulesVersion !== RULES_VERSION) return { status: "rejected", reason: "invalid", message: "Import is not compatible with this build." };
      const candidate = cloneProfile(parsed.profile);
      const now = Date.now();
      resumeAfterDefeat(candidate, this.content, now);
      const elapsed = Math.max(0, now - candidate.clock.lastSettledWallMs);
      // Stage even a zero-duration simulation: consumer exceptions stop the import.
      // This delegates to existing simulation; it is not a new Profile validator.
      const result = await runOfflineCatchUp(candidate, elapsed, now, { content: this.content, mainThreadUpToMs: MAIN_THREAD_CATCH_UP_MS });
      if (epoch !== this.ownerEpoch) return { status: "skipped", reason: "stale-generation" };
      result.profile.clock.lastSettledWallMs = Math.max(result.profile.clock.lastSettledWallMs, now);
      const receipt = await this.track(this.guard.write(() => serializeSave(result.profile, now), {
        intent: replaceIntent, importText: text, isCurrent: () => epoch === this.ownerEpoch,
      }));
      if (receipt.status !== "saved") return receipt;
      if (epoch !== this.ownerEpoch) return { status: "skipped", reason: "stale-generation" };
      this.cache.clearFights();
      this.lastFight = null;
      this.lastSettlement = null;
      this.acknowledge(receipt);
      this.bump({ profile: result.profile, phase: "playing", runResult: null, offline: null, notice: null, error: null });
      return { status: "imported", receipt };
    } catch {
      if (epoch !== this.ownerEpoch) return { status: "skipped", reason: "stale-generation" };
      this.guard.block("profile");
      return { status: "failed", stage: "profile", storageMayHaveChanged: false };
    } finally {
      this.finishAction(epoch);
    }
  }

  exportSave(): string {
    return this.profile && this.canPlay() ? serializeSave(this.profile, Date.now()) : "";
  }

  profileFingerprint(): string {
    return this.profile ? canonicalJson({ gold: this.profile.gold, xp: this.profile.character.xp }) : "";
  }

  prepareReset(): { status: "ready"; intent: SaveIntent } | Extract<ActionOutcome, { status: "blocked" }> {
    const intent = this.guard.prepareIntent("reset");
    return intent ? { status: "ready", intent } : this.blockedResult();
  }

  async resetSave(resetIntent?: SaveIntent): Promise<ActionOutcome> {
    if (!this.guard.gate.canReset) return this.blockedResult();
    if (this.actionOwner !== null || this.catchingUp || this.ui.phase === "loading") return { status: "rejected", reason: "busy", message: "Another character operation is pending." };
    if (!this.guard.acceptsIntent(resetIntent, "reset")) return { status: "rejected", reason: "confirmation", message: "Confirm this exact storage generation first." };
    // The check above narrows the runtime capability, not the optional TS parameter.
    if (!resetIntent) return { status: "rejected", reason: "confirmation", message: "Reset confirmation is required." };
    const epoch = this.beginAction();
    try {
      const result = await this.track(this.guard.reset(resetIntent, () => epoch === this.ownerEpoch));
      if (result.status !== "reset") return result;
      if (epoch !== this.ownerEpoch) return { status: "skipped", reason: "stale-generation" };
      this.cache.clearFights();
      this.lastFight = null;
      this.lastSettlement = null;
      this.bump({ profile: null, phase: "create", offline: null, runResult: null, error: null, notice: null,
        save: { ...this.ui.save, lastSavedWallMs: null, bytes: 0, mainHash: null, loadedFrom: "none" } });
      return result;
    } finally { this.finishAction(epoch); }
  }

  /** No clock, catch-up or auto-save is started by this read-only retry. */
  async retryStorage(): Promise<GateInfo> {
    const request = ++this.initRequest;
    this.pauseLive();
    this.bump({ phase: "storage-blocked", busy: null });
    if (request !== this.initRequest) return this.guard.gate;
    const inspection = this.track(this.guard.refresh());
    const generation = this.guard.gate.generation;
    const epoch = this.ownerEpoch;
    const result = await inspection;
    // A completed refusal revokes its save owner once in the guard publication.
    const completedEpoch = epoch + (result.gate.mode === "blocked" ? 1 : 0);
    if (request !== this.initRequest || generation !== result.gate.generation
      || completedEpoch !== this.ownerEpoch) return this.guard.gate;
    if (result.gate.mode === "blocked") {
      this.completeStartup(request);
      return result.gate;
    }
    this.bump({
      phase: result.gate.mode === "verified-empty" ? "create" : "storage-blocked",
      error: null,
      notice: result.gate.mode === "writable" ? "Compatible saves verified. Continue explicitly to load and resume." : null,
    });
    // Showing a verified create screen completes initial startup; a compatible
    // paused retry still requires Continue, and a stale retry cannot finish it.
    if (result.gate.mode === "verified-empty") this.completeStartup(request);
    return result.gate;
  }
  readObservedSave(slot: SaveSlot): string | null {
    return this.guard.observed(slot);
  }
}

export const session = new GameSession();
