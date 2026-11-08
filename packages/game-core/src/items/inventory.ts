import { SLOT_ORDER, type BuildSnapshot, type ItemInstance, type SlotId } from "@emberbound/shared-types";
import { ASHEN_CROWN, ashenCrownAt } from "../boss/artifact";
import type { Profile } from "../profile/types";

/**
 * Item-instance ownership.
 *
 * - Catalog definitions (ItemDef) live in content; owned copies are ItemInstance.
 * - Instance ids come from a per-character monotonic counter, so a replayed
 *   command sequence assigns identical ids (never random ids).
 * - `profile.inventory.instances` stays sorted by id, so lookups are O(log n).
 */

export function findInstance(profile: Profile, id: number): ItemInstance | undefined {
  const list = profile.inventory.instances;
  let lo = 0;
  let hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const item = list[mid];
    if (!item) break;
    if (item.id === id) return item;
    if (item.id < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return undefined;
}

export function createInstance(
  profile: Profile,
  baseId: string,
  options: { isNew: boolean; provenance?: ItemInstance["provenance"] },
): ItemInstance {
  const id = profile.inventory.nextInstanceId;
  profile.inventory.nextInstanceId = id + 1;
  const instance: ItemInstance = { id, baseId, acquiredSeq: id, isNew: options.isNew };
  if (options.provenance) instance.provenance = options.provenance;
  // ids only grow, so appending keeps the list sorted.
  profile.inventory.instances.push(instance);
  return instance;
}

/** Instances that cannot be consumed (equipped or queued). Used by a future Forge. */
export function reservedInstanceIds(profile: Profile): Set<number> {
  const ids = new Set<number>();
  for (const slot of SLOT_ORDER) {
    const id = profile.equipment[slot];
    if (id !== undefined) ids.add(id);
    const queued = profile.pending?.equipment?.[slot];
    if (queued !== undefined && queued !== null) ids.add(queued);
  }
  return ids;
}

/** Build snapshot of the CURRENT (not pending) build. */
export function currentBuild(profile: Profile): BuildSnapshot {
  const classId = profile.character.activeClassId;
  const equipment: Partial<Record<SlotId, number>> = {};
  for (const slot of SLOT_ORDER) {
    const id = profile.equipment[slot];
    if (id !== undefined) equipment[slot] = id;
  }
  const crown = profile.ashenKing && ashenCrownAt(profile.ashenKing.highestClearedTier);
  return {
    characterLevel: profile.character.level,
    classId,
    masteryXp: profile.character.masteryXp[classId] ?? 0,
    equipment,
    artifactId: crown ? ASHEN_CROWN.id : null,
    ...(crown ? { artifactAttackBp: crown.attackBp } : {}),
  };
}

/** Equipped instances as a map, for stat resolution and replay records. */
export function equippedInstances(profile: Profile, build: BuildSnapshot): Map<number, ItemInstance> {
  const map = new Map<number, ItemInstance>();
  for (const slot of SLOT_ORDER) {
    const id = build.equipment[slot];
    if (id === undefined) continue;
    const instance = findInstance(profile, id);
    if (!instance) throw new Error(`Equipped instance ${id} is not owned`);
    map.set(id, instance);
  }
  return map;
}

/**
 * Stable string key of a build (for caching resolved stats and fights).
 * Instance ids are enough: an instance never changes its catalog item.
 * `masteryPart` lets callers key by rank (stats) or by exact XP (records).
 */
export function buildKey(build: BuildSnapshot, masteryPart: number = build.masteryXp): string {
  const e = build.equipment;
  return `${build.classId}|${build.characterLevel}|${masteryPart}|${build.artifactId ?? "-"}|${e.weapon ?? "-"}|${e.head ?? "-"}|${e.chest ?? "-"}|${e.gloves ?? "-"}|${e.boots ?? "-"}|${e.ring ?? "-"}${build.artifactAttackBp === undefined ? "" : `|${build.artifactAttackBp}`}`;
}
