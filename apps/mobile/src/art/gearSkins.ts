import { canUseItem, type ContentIndex, type Profile } from "@emberbound/game-core";
import type { ItemDef, SlotId } from "@emberbound/shared-types";
import { namedGearDesign, type GearDesign } from "./gearDesigns";

/** Cosmetic data only: never stored in a save or used by the simulation. */
export const GEAR_SLOTS = ["weapon", "head", "chest", "gloves", "boots", "ring"] as const;
export const HERO_CLASSES = ["monk", "mage", "warrior", "ranger"] as const;
export type HeroClass = typeof HERO_CLASSES[number];
export function isHeroClass(name: string): name is HeroClass { return (HERO_CLASSES as readonly string[]).includes(name); }
export interface GearSkin {
  id: string;
  slot: SlotId;
  classId: HeroClass;
  tier: number;
  family: string;
  base: string;
  shade: string;
  light: string;
  trim: string;
  design: GearDesign;
}
export interface HeroAppearance {
  classId: HeroClass;
  key: string;
  slots: Partial<Record<SlotId, GearSkin>>;
}

/** The worn weapon selects basic-attack presentation; gloves alone are not a weapon. */
export function heroAttackName(appearance?: HeroAppearance): HeroClass | "unarmed" {
  return appearance?.slots.weapon?.classId ?? "unarmed";
}
const tiers: Record<string, number> = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 };
/** Every named item has an authored class cut; rarity never selects its artwork. */
export function gearSkin(item: ItemDef, classId: HeroClass): GearSkin {
  const tier = tiers[item.rarity] ?? 0;
  const family = item.id.replace(/_(monk|mage|warrior|ranger)$/, "");
  const design = namedGearDesign(family, classId, item.slot);
  return { id: classId + "/" + item.id, slot: item.slot, classId, tier, family, design, base: design.base, shade: design.shade, light: design.light, trim: design.trim };
}

export function bareAppearance(classId: HeroClass): HeroAppearance { return { classId, key: `${classId}:bare`, slots: {} }; }

/** Class selection shows the actual starter outfit, never an endgame costume. */
export function starterAppearance(classId: HeroClass, content: ContentIndex): HeroAppearance {
  const slots: HeroAppearance["slots"] = {};
  for (const id of [content.snapshot.starterWeapons?.[classId], ...content.snapshot.starterItems]) {
    const base = id ? content.items.get(id) : undefined;
    const item = base?.classVariants?.[classId] ? content.items.get(base.classVariants[classId]!) : base;
    if (item && (!item.classId || item.classId === classId)) slots[item.slot] = gearSkin(item, classId);
  }
  return { classId, slots, key: `${classId}:${GEAR_SLOTS.map(s => slots[s]?.id ?? "-").join("|")}` };
}

/** Resolve equipped copies only. Inventory, queued equips, and the strongest owned item do not dress the hero. */
export function equippedAppearance(profile: Profile, content: ContentIndex,
  equipment = profile.equipment, classId = profile.character.activeClassId): HeroAppearance {
  const hero = isHeroClass(classId) ? classId : "monk";
  const slots: HeroAppearance["slots"] = {};
  for (const slot of GEAR_SLOTS) {
    const instance = profile.inventory.instances.find(i => i.id === equipment[slot]);
    const item = instance && content.items.get(instance.baseId);
    if (!item || item.slot !== slot || !canUseItem(item, classId)) continue;
    slots[slot] = gearSkin(item, hero);
  }
  return { classId: hero, slots, key: `${hero}:${GEAR_SLOTS.map(s => slots[s]?.id ?? "-").join("|")}` };
}
