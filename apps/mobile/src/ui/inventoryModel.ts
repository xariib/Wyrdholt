import { SLOT_ORDER, type SlotId } from "@emberbound/shared-types";
import { isItemLocked, previewSalvage, type ContentIndex, type Profile } from "@emberbound/game-core";
import { filterGearGroups, type GearFilters, type ItemGroup } from "./gearModel";

export interface InventoryFilters extends GearFilters {
  slot: SlotId | "";
  salvage: "" | "eligible" | "protected";
}
export const EMPTY_INVENTORY_FILTERS: InventoryFilters = { search: "", slot: "", rarityId: "", newOnly: false, salvage: "" };
export const INVENTORY_PAGE_SIZE = 20;

export interface InventoryGroup extends ItemGroup {
  copies: { id: number; isNew: boolean; salvageEligible: boolean }[];
  totalCount: number;
  lockedCount: number;
  eligibleCount: number;
}

/** One grouped overview of ownership. Quotes stay authoritative in the existing core. */
export function inventoryGroups(profile: Profile, content: ContentIndex): InventoryGroup[] {
  const groups = new Map<string, InventoryGroup>();
  for (const instance of profile.inventory.instances) {
    const item = content.item(instance.baseId);
    let group = groups.get(item.id);
    if (!group) {
      group = { baseId: item.id, item, ids: [], copies: [], totalCount: 0, newCount: 0,
        lockedCount: 0, eligibleCount: 0, equippedHere: false, queuedHere: false };
      groups.set(item.id, group);
    }
    const salvageEligible = previewSalvage(profile, content, instance.id).ok;
    group.ids.push(instance.id);
    group.copies.push({ id: instance.id, isNew: instance.isNew, salvageEligible });
    group.totalCount++;
    if (instance.isNew) group.newCount++;
    if (isItemLocked(profile, instance.id)) group.lockedCount++;
    if (salvageEligible) group.eligibleCount++;
    if (profile.equipment[item.slot] === instance.id) group.equippedHere = true;
    if (profile.pending?.equipment?.[item.slot] === instance.id) group.queuedHere = true;
  }
  return [...groups.values()].sort((a, b) =>
    SLOT_ORDER.indexOf(a.item.slot) - SLOT_ORDER.indexOf(b.item.slot)
    || content.rarity(b.item.rarity).order - content.rarity(a.item.rarity).order
    || a.item.name.localeCompare(b.item.name)
    || a.baseId.localeCompare(b.baseId));
}

/** NEW/eligibility intersect on the SAME copy; no ownership or selection mutation. */
export function filterInventoryGroups(groups: InventoryGroup[], filters: InventoryFilters): InventoryGroup[] {
  const matchingTypes = new Set(filterGearGroups(groups, filters).map(g => g.baseId));
  return groups.flatMap(group => {
    if (!matchingTypes.has(group.baseId) || (filters.slot && group.item.slot !== filters.slot)) return [];
    const copies = group.copies.filter(copy => (!filters.newOnly || copy.isNew)
      && (!filters.salvage || (filters.salvage === "eligible" ? copy.salvageEligible : !copy.salvageEligible)));
    if (!copies.length) return [];
    return [{ ...group, copies, ids: copies.map(copy => copy.id), newCount: copies.filter(copy => copy.isNew).length }];
  });
}

/** Counts include every matching page and keep stale/missing selected IDs visible as hidden. */
export function inventorySelectionCounts(ids: ReadonlySet<number>, visible: InventoryGroup[]) {
  let matching = 0;
  for (const group of visible) for (const id of group.ids) if (ids.has(id)) matching++;
  return { total: ids.size, matching, hidden: ids.size - matching };
}

export function inventoryPage<T>(rows: T[], requested: number) {
  const pages = Math.max(1, Math.ceil(rows.length / INVENTORY_PAGE_SIZE));
  const page = Math.max(0, Math.min(requested, pages - 1));
  return { page, pages, rows: rows.slice(page * INVENTORY_PAGE_SIZE, (page + 1) * INVENTORY_PAGE_SIZE) };
}
