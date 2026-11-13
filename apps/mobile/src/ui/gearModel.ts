import { SLOT_ORDER, type ItemDef, type ItemInstance, type SlotId } from "@emberbound/shared-types";
import { canUseItem, canonicalJson, findInstance, heroStatsFor, type ContentIndex, type Profile } from "@emberbound/game-core";

import { pct, rate } from "./format";
import { activeEffectDetails, classEffectDetails } from "./activeEffects";

export interface SlotView {
  slot: SlotId;
  equipped: { instance: ItemInstance; item: ItemDef } | null;
  queued: { instance: ItemInstance; item: ItemDef } | null;
  newCount: number;
}

export interface ItemGroup {
  baseId: string;
  item: ItemDef;
  ids: number[];
  newCount: number;
  equippedHere: boolean;
  queuedHere: boolean;
}

export interface GearFilters {
  search: string;
  rarityId: string;
  newOnly: boolean;
}

/** View-only filtering: retain grouped copies, identities and the existing order. */
export function filterGearGroups(groups: ItemGroup[], filters: GearFilters): ItemGroup[] {
  const terms = filters.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return groups.filter((group) => {
    if (filters.rarityId && group.item.rarity !== filters.rarityId) return false;
    if (filters.newOnly && group.newCount === 0) return false;
    const text = [group.item.name, group.item.effect?.name, group.item.effect?.description, ...group.item.tags].join(" ").toLowerCase();
    return terms.every((term) => text.includes(term));
  });
}

export function slotViews(profile: Profile, content: ContentIndex): SlotView[] {
  const newBySlot = new Map<SlotId, number>();
  for (const inst of profile.inventory.instances) {
    if (!inst.isNew || !canUseItem(content.item(inst.baseId), profile.character.activeClassId)) continue;
    const slot = content.item(inst.baseId).slot;
    newBySlot.set(slot, (newBySlot.get(slot) ?? 0) + 1);
  }
  return SLOT_ORDER.map((slot) => {
    const id = profile.equipment[slot];
    const instance = id !== undefined ? findInstance(profile, id) : undefined;
    const qid = profile.pending?.equipment?.[slot];
    const queuedInstance = qid !== undefined && qid !== null ? findInstance(profile, qid) : undefined;
    return {
      slot,
      equipped: instance && canUseItem(content.item(instance.baseId), profile.character.activeClassId) ? { instance, item: content.item(instance.baseId) } : null,
      queued: queuedInstance && canUseItem(content.item(queuedInstance.baseId), profile.character.activeClassId) ? { instance: queuedInstance, item: content.item(queuedInstance.baseId) } : null,
      newCount: newBySlot.get(slot) ?? 0,
    };
  });
}

/** Copies with the same catalog definition and instance bonuses play identically. */
export function isEquippedDuplicate(candidate: ItemInstance, equipped: ItemInstance | undefined): boolean {
  return !!equipped && candidate.id !== equipped.id && candidate.baseId === equipped.baseId
    && itemBonuses(candidate) === itemBonuses(equipped);
}

function itemBonuses({ rolls, modifiers, upgrade, seasonal }: ItemInstance): string {
  return canonicalJson({ rolls, modifiers, upgrade, seasonal });
}

/** Keep other classes' copies and NEW state in the save, outside the active view. */
export function classInventory(profile: Profile, content: ContentIndex): ItemInstance[] {
  return profile.inventory.instances.filter(i => canUseItem(content.item(i.baseId), profile.character.activeClassId));
}

export function totalNew(profile: Profile, content: ContentIndex): number {
  return classInventory(profile, content).filter(i => i.isNew).length;
}

/** Identical catalog items share one card with a copy count (LOOT_FORGE behaviour). */
export function groupsForSlot(profile: Profile, content: ContentIndex, slot: SlotId): ItemGroup[] {
  const groups = new Map<string, ItemGroup>();
  const equippedId = profile.equipment[slot];
  const queuedId = profile.pending?.equipment?.[slot];
  for (const inst of profile.inventory.instances) {
    const item = content.item(inst.baseId);
    if (item.slot !== slot || !canUseItem(item, profile.character.activeClassId)) continue;
    let g = groups.get(inst.baseId);
    if (!g) {
      g = { baseId: inst.baseId, item, ids: [], newCount: 0, equippedHere: false, queuedHere: false };
      groups.set(inst.baseId, g);
    }
    g.ids.push(inst.id);
    if (inst.isNew) g.newCount += 1;
    if (inst.id === equippedId) g.equippedHere = true;
    if (inst.id === queuedId) g.queuedHere = true;
  }
  return [...groups.values()].sort((a, b) => {
    if (a.equippedHere !== b.equippedHere) return a.equippedHere ? -1 : 1;
    if ((a.newCount > 0) !== (b.newCount > 0)) return a.newCount > 0 ? -1 : 1;
    const ra = content.rarity(a.item.rarity).order;
    const rb = content.rarity(b.item.rarity).order;
    return rb - ra || a.item.name.localeCompare(b.item.name);
  });
}

/** The instance to equip from a group: never the one already equipped. */
export function pickInstance(profile: Profile, group: ItemGroup, slot: SlotId): number {
  const equippedId = profile.equipment[slot];
  return group.ids.find((id) => id !== equippedId) ?? group.ids[0]!;
}

export interface StatRow {
  key: string;
  label: string;
  current: number;
  candidate: number;
  format: (v: number) => string;
}

export function statRows(current: ItemDef | null, candidate: ItemDef, format: {
  pct: (bp: number) => string;
  rate: (m: number, signed?: boolean) => string;
}): StatRow[] {
  const c = current?.stats ?? {};
  const n = candidate.stats;
  const rows: StatRow[] = [
    { key: "attack", label: "Attack", current: c.attack ?? 0, candidate: n.attack ?? 0, format: (v) => `+${v}` },
    { key: "hp", label: "Health", current: c.hp ?? 0, candidate: n.hp ?? 0, format: (v) => `+${v}` },
    { key: "armor", label: "Armor", current: c.armor ?? 0, candidate: n.armor ?? 0, format: (v) => `+${v}` },
    {
      key: "rate",
      label: "Attack rate",
      current: c.attackRateMilli ?? 0,
      candidate: n.attackRateMilli ?? 0,
      format: (v) => format.rate(v, true),
    },
    { key: "crit", label: "Crit chance", current: c.critBp ?? 0, candidate: n.critBp ?? 0, format: (v) => `+${format.pct(v)}` },
  ];
  return rows.filter((r) => r.current !== 0 || r.candidate !== 0);
}

export function gearDifferences(current: ItemDef | null, candidate: ItemDef) {
  const stats = statRows(current, candidate, { pct, rate })
    .filter(row => row.candidate !== row.current)
    .map(row => {
      const delta = row.candidate - row.current;
      const amount = Math.abs(delta);
      const value = row.key === "crit" ? `${amount / 100} pp` : row.key === "rate" ? `${amount / 1000}/s` : String(amount);
      return { key: row.key, label: row.label, delta, value: `${delta > 0 ? "+" : "−"}${value}` };
    });
  const wornEffect = current?.effect ?? null;
  const newEffect = candidate.effect ?? null;
  // Mechanic IDs identify event sources; a new source ID alone is no effect change.
  const effectValue = (effect: ItemDef["effect"] | null) => effect ? {
    ...effect, mechanics: effect.mechanics.map(({ id: _sourceId, ...parameters }) => parameters),
  } : null;
  const effectChanged = canonicalJson(effectValue(wornEffect)) !== canonicalJson(effectValue(newEffect));
  return {
    stats,
    gainedEffect: effectChanged ? newEffect : null,
    lostEffect: effectChanged ? wornEffect : null,
  };
}

export function buildSummary(profile: Profile, content: ContentIndex) {
  const stats = heroStatsFor(profile, content);
  const tags = new Set<string>();
  for (const slot of SLOT_ORDER) {
    const id = profile.equipment[slot];
    if (id === undefined) continue;
    const inst = findInstance(profile, id);
    if (inst) for (const t of content.item(inst.baseId).tags) tags.add(t);
  }
  return { stats, tags: [...tags], activeEffects: activeEffectDetails(profile, content), classEffects: classEffectDetails(content, stats) };
}
