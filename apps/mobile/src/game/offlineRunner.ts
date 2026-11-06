import { CONTENT } from "@emberbound/game-content";
import { ContentIndex, cloneProfile, simulateOffline, type OfflineSummary, type Profile } from "@emberbound/game-core";

export interface OfflineRunResult {
  profile: Profile;
  summary: OfflineSummary;
  /** Simulation time inside the worker (or main thread). */
  computeMs: number;
  /** Button-to-result time, including worker messaging. */
  totalMs: number;
  mode: OfflineRunMode;
}

/**
 * - worker: computed in the offline Web Worker (P3 benchmark must show this)
 * - main-thread-short: a short absence settled directly, skipping worker start-up (F6)
 * - main-thread-fallback: the worker could not be created or failed
 */
export type OfflineRunMode = "worker" | "main-thread-short" | "main-thread-fallback";

export interface OfflineRunOptions {
  /** Content already built on the main thread (avoids building a second index). */
  content?: ContentIndex;
  /**
   * Absences up to this length are settled on the main thread. Their compute is a few
   * tens of ms, while waiting for a cold worker costs hundreds of ms on slow phones.
   */
  mainThreadUpToMs?: number;
}

let worker: Worker | null = null;
let workerBroken = false;
let seq = 0;
let fallbackContent: ContentIndex | null = null;

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;
  try {
    const created = new Worker(new URL("./offline.worker.ts", import.meta.url), { type: "module" });
    worker = created;
    created.addEventListener("error", () => {
      if (worker !== created) return; // Ignore an already retired worker's late error.
      workerBroken = true;
      worker = null;
    });
    return worker;
  } catch {
    workerBroken = true;
    return null;
  }
}

/**
 * Run offline catch-up in a Web Worker. Falls back to the main thread when the
 * environment blocks workers (the fallback path is reported in the overlay).
 */
export async function runOfflineCatchUp(
  profile: Profile,
  elapsedMs: number,
  contentTimeMs: number,
  options: OfflineRunOptions = {},
): Promise<OfflineRunResult> {
  const started = performance.now();
  const short = options.mainThreadUpToMs !== undefined && elapsedMs <= options.mainThreadUpToMs;
  const w = short ? null : getWorker();
  if (w) {
    let timedOut = false;
    try {
      const id = (seq += 1);
      const reply = await new Promise<{ ok: boolean; profile?: Profile; summary?: OfflineSummary; computeMs?: number; error?: string }>(
        (resolve, reject) => {
          const cleanup = () => {
            clearTimeout(timeout);
            w.removeEventListener("message", onMessage);
            w.removeEventListener("error", onError);
          };
          const timeout = setTimeout(() => { timedOut = true; cleanup(); reject(new Error("worker timeout")); }, 60_000);
          const onMessage = (event: MessageEvent) => {
            if (event.data?.id !== id) return;
            cleanup();
            resolve(event.data);
          };
          const onError = (event: ErrorEvent) => {
            cleanup();
            reject(new Error(event.message || "worker error"));
          };
          w.addEventListener("message", onMessage);
          w.addEventListener("error", onError, { once: true });
          try { w.postMessage({ id, profile, elapsedMs, contentTimeMs }); }
          catch (error) { cleanup(); reject(error); }
        },
      );
      if (reply.ok && reply.profile && reply.summary) {
        return {
          profile: reply.profile,
          summary: reply.summary,
          computeMs: reply.computeMs ?? 0,
          totalMs: performance.now() - started,
          mode: "worker",
        };
      }
      throw new Error(reply.error ?? "worker failed");
    } catch {
      // Background suspension can exhaust a deadline without a broken runtime.
      // Fall back for this job, then allow one fresh worker on the next request.
      // Real worker/load errors retain the existing session-long fallback policy.
      workerBroken = !timedOut;
      w.terminate();
      worker = null;
    }
  }
  // Main thread: short absences by choice, or as the worker fallback.
  // Yield once so the busy indicator can paint.
  await new Promise((r) => setTimeout(r, short ? 0 : 30));
  const content = options.content ?? (fallbackContent ??= new ContentIndex(CONTENT));
  const copy = cloneProfile(profile);
  const computeStart = performance.now();
  const summary = simulateOffline(copy, content, elapsedMs, contentTimeMs);
  const computeMs = performance.now() - computeStart;
  return {
    profile: copy,
    summary,
    computeMs,
    totalMs: performance.now() - started,
    mode: short ? "main-thread-short" : "main-thread-fallback",
  };
}

/** Warm the worker at startup so the first catch-up does not pay module loading. */
export function prewarmOfflineWorker(): void {
  getWorker();
}
