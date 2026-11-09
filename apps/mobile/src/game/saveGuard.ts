import {
  DEFAULT_SAVE_PATHS, loadSaveSafely, parseSave, sha256Hex, writeSaveSafely,
  type LoadOutcome, type SaveFileAdapter,
} from "@emberbound/game-core";
import type { SaveOwnership } from "../platform/storage";
import { SaveStorageError, storageErrorCode } from "../platform/storageErrors";

export type SaveSlot = "main" | "temp" | "backup";
export type GateReason = "unsupported" | "corrupt" | "io" | "rules" | "storage-changed" | "ownership" | "profile";
export interface SlotInfo {
  slot: SaveSlot;
  status: "missing" | "valid" | "unsupported" | "corrupt" | "error";
  schema?: number;
  errorCode?: string;
}
export interface GateInfo {
  mode: "uninspected" | "verified-empty" | "writable" | "blocked";
  reason?: GateReason;
  generation: number;
  slots: readonly SlotInfo[];
  canCreate: boolean;
  canImport: boolean;
  canReset: boolean;
}
export function initialSaveGate(): GateInfo {
  return { mode: "uninspected", generation: 0, slots: [], canCreate: false, canImport: false, canReset: false };
}
export type SaveStage = "serialize" | "validate" | "preflight" | "ownership" | "temp-write" | "temp-read"
  | "main-read" | "backup-write" | "main-remove" | "rename" | "main-readback" | "postflight"
  | "stale-commit" | "reset-remove" | "reset-verify" | "profile";
export type SaveOutcome =
  | { status: "saved"; savedAtWallMs: number; bytes: number; mainHash: string; readbackVerified: true; durability: "not-verified" }
  | { status: "blocked"; reason: GateReason; generation: number }
  | { status: "failed"; stage: SaveStage; errorCode?: string; storageMayHaveChanged: boolean }
  | { status: "skipped"; reason: "no-profile" | "stale-generation" };
export interface SaveIntent {
  readonly kind: "import" | "reset";
  readonly generation: number;
  readonly snapshotHash: string;
  readonly textHash?: string;
}
export type ActionOutcome =
  | { status: "created" | "imported"; receipt: Extract<SaveOutcome, { status: "saved" }> }
  | { status: "reset"; verifiedEmpty: true; generation: number }
  | { status: "rejected"; reason: "invalid" | "busy" | "confirmation" | "not-empty"; message: string }
  | Exclude<SaveOutcome, { status: "saved" }>;

interface Observation { info: SlotInfo; raw: string | null; rulesVersion?: string }
export interface SaveInspection { gate: GateInfo; loaded?: LoadOutcome }
interface Inspection extends SaveInspection { observations: readonly Observation[] }
const slots: readonly SaveSlot[] = ["main", "temp", "backup"];
const skipped = (): Extract<SaveOutcome, { status: "skipped" }> => ({ status: "skipped", reason: "stale-generation" });

/**
 * App policy around the unchanged core reader/writer. No repair, migration or
 * normalization. Only an acknowledged, compatible snapshot permits mutation.
 */
export class SaveGuard {
  private info = initialSaveGate();
  private snapshot: Inspection | null = null;
  private tail: Promise<void> = Promise.resolve();
  private readonly intents = new Set<SaveIntent>();
  constructor(
    private readonly fs: SaveFileAdapter,
    private readonly rulesVersion: string,
    private readonly own: SaveOwnership,
    private readonly changed: (info: GateInfo) => void,
  ) {}
  get gate(): GateInfo { return this.info; }
  get idle(): Promise<void> { return this.tail; }
  observed(slot: SaveSlot): string | null {
    return this.snapshot?.observations.find(o => o.info.slot === slot)?.raw ?? null;
  }
  private queue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
  private publish(mode: GateInfo["mode"], reason?: GateReason, snapshot = this.snapshot): void {
    if (snapshot) this.snapshot = snapshot;
    this.info = {
      mode, reason, generation: this.info.generation,
      slots: Object.freeze((this.snapshot?.observations ?? []).map(o => Object.freeze({ ...o.info }))),
      canCreate: mode === "verified-empty", canImport: mode === "verified-empty" || mode === "writable",
      canReset: mode === "writable",
    };
    this.info = Object.freeze(this.info);
    this.changed(this.info);
  }
  block(reason: GateReason, snapshot = this.snapshot): Extract<SaveOutcome, { status: "blocked" }> {
    this.info = { ...this.info, generation: this.info.generation + 1 };
    this.intents.clear();
    this.publish("blocked", reason, snapshot);
    return { status: "blocked", reason, generation: this.info.generation };
  }
  private blocked(): Extract<SaveOutcome, { status: "blocked" }> {
    return { status: "blocked", reason: this.info.reason ?? "ownership", generation: this.info.generation };
  }
  private snapshotHash(snapshot = this.snapshot): string {
    return sha256Hex(JSON.stringify(snapshot?.observations.map(o => [o.info.slot, o.info.status, o.raw]) ?? []));
  }
  prepareIntent(kind: SaveIntent["kind"], text?: string): SaveIntent | null {
    if (!(kind === "import" ? this.info.canImport : this.info.canReset)) return null;
    const intent = Object.freeze({
      kind, generation: this.info.generation, snapshotHash: this.snapshotHash(),
      ...(kind === "import" ? { textHash: sha256Hex(text ?? "") } : {}),
    });
    this.intents.add(intent);
    return intent;
  }
  acceptsIntent(intent: SaveIntent | undefined, kind: SaveIntent["kind"], text?: string): boolean {
    return !!intent && this.intents.has(intent) && intent.kind === kind
      && intent.generation === this.info.generation && intent.snapshotHash === this.snapshotHash()
      && (kind !== "import" || intent.textHash === sha256Hex(text ?? ""));
  }

  private observation(slot: SaveSlot, raw: string | null): Observation {
    if (raw === null) return { info: { slot, status: "missing" }, raw };
    let schema: number | undefined;
    try { const value: unknown = JSON.parse(raw); if (typeof value === "object" && value !== null && "schema" in value && typeof value.schema === "number") schema = value.schema; }
    catch { /* The core parser reports malformed JSON. */ }
    try {
      const parsed = parseSave(raw);
      return {
        info: { slot, schema, status: parsed.ok ? "valid" : parsed.reason === "newer-schema" || parsed.reason === "unsupported-schema" ? "unsupported" : "corrupt" },
        raw, ...(parsed.ok ? { rulesVersion: parsed.profile.rulesVersion } : {}),
      };
    } catch { return { info: { slot, status: "corrupt", schema }, raw }; }
  }
  private async inspect(): Promise<Inspection> {
    const observations: Observation[] = [];
    for (const slot of slots) {
      let raw: string | null;
      try { raw = await this.fs.read(DEFAULT_SAVE_PATHS[slot]); }
      catch (error) {
        observations.push({ info: { slot, status: "error", errorCode: storageErrorCode(error) }, raw: null });
        continue;
      }
      observations.push(this.observation(slot, raw));
    }
    const statuses = observations.map(o => o.info.status);
    let reason: GateReason | undefined = statuses.includes("error") ? "io"
      : statuses.includes("unsupported") ? "unsupported" : statuses.includes("corrupt") ? "corrupt" : undefined;
    let loaded: LoadOutcome | undefined;
    if (!reason) {
      const adapter: SaveFileAdapter = {
        read: async path => observations.find(o => DEFAULT_SAVE_PATHS[o.info.slot] === path)?.raw ?? null,
        write: async () => { throw new Error("Read-only inspection."); },
        remove: async () => { throw new Error("Read-only inspection."); },
        rename: async () => { throw new Error("Read-only inspection."); },
      };
      loaded = await loadSaveSafely(adapter);
      const main = observations.find(o => o.info.slot === "main");
      if ((main?.info.status === "valid" && main.rulesVersion !== this.rulesVersion)
        || (loaded.status === "loaded" && loaded.result.profile.rulesVersion !== this.rulesVersion)) reason = "rules";
    }
    const mode: GateInfo["mode"] = reason ? "blocked" : loaded?.status === "empty" ? "verified-empty" : "writable";
    return { observations, loaded, gate: { mode, reason, generation: this.info.generation, slots: observations.map(o => o.info), canCreate: mode === "verified-empty", canImport: mode !== "blocked", canReset: mode === "writable" } };
  }
  /** Revocation is immediate; the read-only job waits for an in-flight commit. */
  refresh(): Promise<SaveInspection> {
    this.info = { ...this.info, generation: this.info.generation + 1 };
    this.intents.clear();
    // Subscribers may synchronously start a newer refresh during publication.
    const generation = this.info.generation;
    this.publish("uninspected");
    return this.queue(async () => {
      let inspected: Inspection;
      try { inspected = await this.own(() => this.inspect()); }
      catch {
        // Still expose successfully observed text when write ownership is unavailable.
        inspected = await this.inspect();
        if (generation === this.info.generation) this.publish("blocked", inspected.gate.reason ?? "ownership", inspected);
        return { gate: this.info };
      }
      if (generation !== this.info.generation) return { gate: this.info };
      this.publish(inspected.gate.mode, inspected.gate.reason, inspected);
      return { gate: this.info, loaded: inspected.loaded };
    });
  }
  private async preflight(generation: number): Promise<Exclude<SaveOutcome, { status: "saved" }> | null> {
    if (generation !== this.info.generation) return skipped();
    if (!this.info.canImport) return this.blocked();
    const fresh = await this.inspect();
    if (generation !== this.info.generation) return skipped();
    if (fresh.gate.mode === "blocked") return this.block(fresh.gate.reason!, fresh);
    if (this.snapshotHash(fresh) !== this.snapshotHash()) return this.block("storage-changed", fresh);
    return null;
  }
  private failure(stage: SaveStage, error: unknown, storageMayHaveChanged: boolean): Extract<SaveOutcome, { status: "failed" }> {
    this.block(stage === "serialize" || stage === "validate" || stage === "profile" ? "profile" : stage === "ownership" ? "ownership" : "io");
    return { status: "failed", stage, errorCode: storageErrorCode(error), storageMayHaveChanged };
  }

  write(
    produce: () => string,
    options: { isCurrent?: () => boolean; emptyOnly?: boolean; newOwner?: boolean; intent?: SaveIntent; importText?: string } = {},
  ): Promise<SaveOutcome> {
    const generation = this.info.generation;
    return this.queue(async () => {
      if (generation !== this.info.generation || options.isCurrent?.() === false) return skipped();
      if (!this.info.canImport) return this.blocked();
      if (options.emptyOnly && !this.info.canCreate) return this.blocked();
      let stage: SaveStage = "ownership", mayHaveChanged = false, owner = generation;
      const observedDuringWrite: { changedMain: Observation | null; temp: Observation | null } = { changedMain: null, temp: null };
      try {
        return await this.own(async (): Promise<SaveOutcome> => {
          stage = "preflight";
          const denied = await this.preflight(owner);
          if (denied) return denied;
          if (options.isCurrent?.() === false) return skipped();
          if (options.intent && !this.acceptsIntent(options.intent, "import", options.importText)) return skipped();
          const acknowledged = this.snapshot;
          if (!acknowledged) throw new Error("No acknowledged save snapshot.");
          const expectedMain = acknowledged.observations.find(o => o.info.slot === "main")!.raw;
          stage = "serialize";
          const staged = produce();
          stage = "validate";
          const parsed = parseSave(staged);
          if (!parsed.ok || parsed.profile.rulesVersion !== this.rulesVersion) throw new Error("Staged save rejected.");
          // Recovery orders the slots by timestamp and prefers main on a tie.
          // A clock rollback must not make a successful write older than its backup.
          const previous = acknowledged.loaded?.status === "loaded" ? acknowledged.loaded.result.envelope.savedAtWallMs : -Infinity;
          const savedAtWallMs = Math.max(parsed.envelope.savedAtWallMs, previous);
          const text = savedAtWallMs === parsed.envelope.savedAtWallMs ? staged : JSON.stringify({ ...parsed.envelope, savedAtWallMs });
          if (options.newOwner || options.intent) {
            this.info = { ...this.info, generation: this.info.generation + 1 };
            owner = this.info.generation;
            this.intents.clear();
            this.publish(this.info.mode);
          }
          const wrapped: SaveFileAdapter = {
            read: async path => {
              stage = path === DEFAULT_SAVE_PATHS.temp ? "temp-read" : "main-read";
              const raw = await this.fs.read(path);
              if (path === DEFAULT_SAVE_PATHS.temp) observedDuringWrite.temp = this.observation("temp", raw);
              if (path === DEFAULT_SAVE_PATHS.main && raw !== expectedMain) {
                // safeWrite's current-main read is later than preflight. Refuse the
                // observed change before backup/remove/rename; temp may be written.
                // This does not promise CAS against a later, unobserved writer.
                observedDuringWrite.changedMain = this.observation("main", raw);
                throw new Error("Current main differs from the acknowledged snapshot.");
              }
              return raw;
            },
            write: async (path, data) => { stage = path === DEFAULT_SAVE_PATHS.temp ? "temp-write" : "backup-write"; mayHaveChanged = true; await this.fs.write(path, data); },
            remove: async path => { stage = "main-remove"; mayHaveChanged = true; await this.fs.remove(path); },
            rename: async (from, to) => { stage = "rename"; mayHaveChanged = true; await this.fs.rename(from, to); },
          };
          await writeSaveSafely(wrapped, text);
          stage = "main-readback";
          if (await this.fs.read(DEFAULT_SAVE_PATHS.main) !== text) throw new Error("Main readback differs.");
          stage = "postflight";
          const after = await this.inspect();
          if (owner !== this.info.generation) {
            return { status: "failed", stage: "stale-commit", storageMayHaveChanged: true };
          }
          if (after.gate.mode !== "writable" || after.observations[0]?.raw !== text) {
            const code = after.observations.find(o => o.info.errorCode)?.info.errorCode;
            throw new SaveStorageError("read", DEFAULT_SAVE_PATHS.main, { code });
          }
          this.publish("writable", undefined, after);
          if (options.isCurrent?.() === false) return { status: "failed", stage: "stale-commit", storageMayHaveChanged: true };
          return { status: "saved", savedAtWallMs, bytes: new TextEncoder().encode(text).length, mainHash: sha256Hex(text), readbackVerified: true, durability: "not-verified" };
        });
      } catch (error) {
        const changedMain = observedDuringWrite.changedMain;
        if (changedMain) {
          if (owner === this.info.generation && this.snapshot) {
            const observations = this.snapshot.observations.map(o => o.info.slot === "main" ? changedMain
              : o.info.slot === "temp" && observedDuringWrite.temp ? observedDuringWrite.temp : o);
            this.block(changedMain.info.status === "unsupported" ? "unsupported"
              : changedMain.info.status === "corrupt" ? "corrupt" : "storage-changed",
            { ...this.snapshot, observations, loaded: undefined });
          }
          return { status: "failed", stage: "main-read", storageMayHaveChanged: mayHaveChanged };
        }
        if (owner !== this.info.generation) return { status: "failed", stage: mayHaveChanged ? "stale-commit" : stage, errorCode: storageErrorCode(error), storageMayHaveChanged: mayHaveChanged };
        return this.failure(stage, error, mayHaveChanged);
      }
    });
  }
  reset(intent: SaveIntent, isCurrent: () => boolean): Promise<ActionOutcome> {
    const generation = this.info.generation;
    return this.queue(async () => {
      if (generation !== this.info.generation || !isCurrent()) return skipped();
      if (!this.info.canReset) return this.blocked();
      if (!this.acceptsIntent(intent, "reset")) return { status: "rejected", reason: "confirmation", message: "Reset confirmation is stale." };
      let stage: SaveStage = "ownership", mayHaveChanged = false, owner = generation;
      try {
        return await this.own(async (): Promise<ActionOutcome> => {
          stage = "preflight";
          const denied = await this.preflight(owner);
          if (denied) return denied;
          if (!isCurrent()) return skipped();
          this.info = { ...this.info, generation: this.info.generation + 1 };
          owner = this.info.generation;
          this.intents.clear();
          this.publish("writable");
          stage = "reset-remove";
          for (const slot of slots) { mayHaveChanged = true; await this.fs.remove(DEFAULT_SAVE_PATHS[slot]); }
          stage = "reset-verify";
          const after = await this.inspect();
          if (owner !== this.info.generation || !isCurrent()) return { status: "failed", stage: "stale-commit", storageMayHaveChanged: true };
          if (after.gate.mode !== "verified-empty") {
            const unreadable = after.observations.find(o => o.info.status === "error");
            if (unreadable) throw new SaveStorageError("read", DEFAULT_SAVE_PATHS[unreadable.info.slot], { code: unreadable.info.errorCode });
            throw new Error("Reset did not verify empty.");
          }
          this.publish("verified-empty", undefined, after);
          return { status: "reset", verifiedEmpty: true, generation: this.info.generation };
        });
      } catch (error) {
        if (owner !== this.info.generation) return { status: "failed", stage: "stale-commit", storageMayHaveChanged: mayHaveChanged };
        return this.failure(stage, error, mayHaveChanged);
      }
    });
  }
}
