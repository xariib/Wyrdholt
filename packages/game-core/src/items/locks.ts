import type { Profile } from "../profile/types";
import { findInstance } from "./inventory";

/** Independent save domain; combat/content and historical Forge receipts stay unchanged. */
export const ITEM_LOCK_SAVE_SCHEMA_VERSION = 3;

export function isItemLocked(profile: Profile, instanceId: number): boolean {
  const ids = profile.itemLocks?.lockedInstanceIds ?? [];
  let lo = 0, hi = ids.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1, id = ids[mid]!;
    if (id === instanceId) return true;
    if (id < instanceId) lo = mid + 1; else hi = mid - 1;
  }
  return false;
}

/** Explicit desired state makes retries idempotent. Never changes review/equip state. */
export function setItemLock(profile: Profile, instanceId: number, locked: boolean): string | null {
  if (!Number.isSafeInteger(instanceId) || instanceId < 1 || typeof locked !== "boolean") return "Invalid item lock input.";
  if (!findInstance(profile, instanceId)) return "You do not own that item copy.";
  if (isItemLocked(profile, instanceId) === locked) return null;
  const state = profile.itemLocks ??= { version: 1, lockedInstanceIds: [] };
  state.lockedInstanceIds = locked
    ? [...state.lockedInstanceIds, instanceId].sort((a, b) => a - b)
    : state.lockedInstanceIds.filter(id => id !== instanceId);
  // Keep this domain even after the last unlock: old readers must never downgrade it.
  profile.schema = ITEM_LOCK_SAVE_SCHEMA_VERSION;
  return null;
}
