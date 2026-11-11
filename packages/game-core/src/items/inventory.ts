import { SLOT_ORDER, type BuildSnapshot, type ItemDef, type ItemInstance, type SlotId } from "@emberbound/shared-types";
import { ASHEN_CROWN, ashenCrownAt } from "../boss/artifact";
import { promotionCleared } from "../boss/progress";
import type { ContentIndex } from "../content";
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

export function canUseItem(item: ItemDef, classId: string): boolean {
  return !item.classVariants && (item.classId === undefined || item.classId === classId);
}

export function discardIncompatiblePendingGear(profile: Profile, content: ContentIndex, classId: string): void {
  const equipment = profile.pending?.equipment;
  if (!equipment) return;
  for (const slot of SLOT_ORDER) {
    const instance = findInstance(profile, equipment[slot] ?? 0);
    if (instance && !canUseItem(content.item(instance.baseId), classId)) delete equipment[slot];
  }
}

/** Keep owned gear when changing classes, but clear slots the new class cannot wear. */
export function reconcileEquipment(profile: Profile, content: ContentIndex, upgrade = false): boolean {
  const classId = profile.character.activeClassId;
  let changed = false;
  for (const slot of SLOT_ORDER) {
    const instance = findInstance(profile, profile.equipment[slot] ?? 0);
    if (!instance) continue;
    const item = content.item(instance.baseId);
    if (canUseItem(item, classId)) continue;
    delete profile.equipment[slot];
    changed = true;
    if (slot === "weapon" && upgrade) {
      // Preserve the tier of an old equipped weapon and keep the original copy intact.
      const replacement = content.snapshot.items.find(i => i.slot === slot && i.rarity === item.rarity && i.classId === classId);
      if (!replacement) continue;
      const owned = profile.inventory.instances.find(i => i.baseId === replacement.id);
      if (owned) profile.equipment.weapon = owned.id;
      else if (Number.isSafeInteger(profile.inventory.nextInstanceId + 1)) {
        profile.equipment.weapon = createInstance(profile, replacement.id, {
          isNew: false, provenance: { source: "class-gear-upgrade" },
        }).id;
      }
    }
  }
  for (const slot of SLOT_ORDER) {
    if (profile.equipment[slot] !== undefined || !content.snapshot.starterWeapons) continue;
    const replacement = profile.inventory.instances.find(i => {
      const item = content.item(i.baseId);
      return item.slot === slot && canUseItem(item, classId);
    });
    if (replacement) {
      profile.equipment[slot] = replacement.id;
      changed = true;
    }
  }
  return changed;
}

/** Apply the catalog upgrade once at a safe fight boundary. */
export function upgradeClassGear(profile: Profile, content: ContentIndex): boolean {
  if (!content.snapshot.starterWeapons || profile.contentVersion === content.snapshot.contentVersion) return false;
  let migrated = false;
  for (const instance of profile.inventory.instances) {
    const item = content.item(instance.baseId);
    const queued = profile.pending?.equipment?.[item.slot] === instance.id && profile.equipment[item.slot] !== instance.id;
    const classId = (queued ? profile.pending?.activeClassId : undefined) ?? profile.character.activeClassId;
    const replacement = item.classVariants?.[classId];
    if (replacement) { instance.baseId = replacement; migrated = true; }
  }
  const changed = reconcileEquipment(profile, content, true) || migrated;
  discardIncompatiblePendingGear(profile, content, profile.pending?.activeClassId ?? profile.character.activeClassId);
  profile.contentVersion = content.snapshot.contentVersion;
  return changed;
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
    ...(promotionCleared(profile, classId) ? { promoted: true } as const : {}),
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
  return `${build.classId}|${build.characterLevel}|${masteryPart}|${build.artifactId ?? "-"}|${e.weapon ?? "-"}|${e.head ?? "-"}|${e.chest ?? "-"}|${e.gloves ?? "-"}|${e.boots ?? "-"}|${e.ring ?? "-"}${build.artifactAttackBp === undefined ? "" : `|${build.artifactAttackBp}`}${build.promoted ? "|promoted" : ""}`;
}
