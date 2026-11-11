import type { ContentIndex } from "../content";
import type { Profile } from "../profile/types";
import { HUNT_SAVE_SCHEMA_VERSION } from "../rules/version";

/** Only settled Farm time in cleared territory earns discoveries. No wall clock reads. */
export function discoverHunts(profile: Profile, content: ContentIndex, zoneId: string, ms: number): void {
  const config = content.snapshot.hunts;
  const candidates = [...content.hunts.values()].filter(h => h.zoneId === zoneId);
  if (!config || ms <= 0 || !candidates.length || !profile.adventure.zones[zoneId]?.cleared) return;
  const first = !profile.hunts;
  const state = profile.hunts ??= { version: 1, progressMs: 0, nextDiscoveryId: 1, completed: 0, queue: [], active: null, lastResult: null };
  state.progressMs = Math.min(state.progressMs, config.intervalMs - 1);
  profile.schema = Math.max(profile.schema, HUNT_SAVE_SCHEMA_VERSION);
  // A first discovery teaches the feature on the first return after a full zone clear.
  let remaining = ms;
  if (first) add();
  while (remaining > 0 && state.queue.length < config.capacity && state.nextDiscoveryId < Number.MAX_SAFE_INTEGER) {
    const step = Math.min(remaining, config.intervalMs - state.progressMs);
    state.progressMs += step;
    remaining -= step;
    if (state.progressMs === config.intervalMs) {
      state.progressMs = 0;
      add();
    }
  }
  function add(): void {
    const hunt = candidates[(state.nextDiscoveryId - 1) % candidates.length]!;
    state.queue.push({ id: state.nextDiscoveryId++, huntId: hunt.id, step: 0, slot: null, route: null, hp100: null });
  }
}

export function activeHuntAttempt(profile: Profile) { return profile.hunts?.active ?? null; }
