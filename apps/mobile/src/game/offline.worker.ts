/// <reference lib="webworker" />
/**
 * Offline catch-up worker: runs game-core off the main thread so the UI stays
 * responsive (P3). Same pure code as the main thread and the Node tools.
 */
import { CONTENT } from "@emberbound/game-content";
import { ContentIndex, simulateOffline, type Profile } from "@emberbound/game-core";

export interface OfflineRequest {
  id: number;
  profile: Profile;
  elapsedMs: number;
  contentTimeMs: number;
}

const content = new ContentIndex(CONTENT);

self.onmessage = (event: MessageEvent<OfflineRequest>) => {
  const { id, profile, elapsedMs, contentTimeMs } = event.data;
  try {
    const started = performance.now();
    const summary = simulateOffline(profile, content, elapsedMs, contentTimeMs);
    const computeMs = performance.now() - started;
    self.postMessage({ id, ok: true, profile, summary, computeMs });
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error) });
  }
};
