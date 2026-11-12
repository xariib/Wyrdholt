import { canUseItem, type ContentIndex, type Profile } from "@emberbound/game-core";
import type { ItemDef, SlotId } from "@emberbound/shared-types";

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
const fabrics: Record<HeroClass, readonly [string, string, string][]> = {
  monk: [["#b7a180", "#79674f", "#deceb0"], ["#b29b63", "#6d6344", "#ded0a1"], ["#b16b43", "#693f32", "#e4a968"], ["#6a7e98", "#394c68", "#b6c7d3"], ["#e4d9b9", "#978165", "#fff0cd"]],
  mage: [["#8b858a", "#514d5c", "#bbb0ac"], ["#747189", "#46465f", "#b0a4c2"], ["#5f699a", "#363e66", "#9cadd0"], ["#705582", "#403454", "#b697c6"], ["#424e7a", "#252b4c", "#909dc1"]],
  warrior: [["#9a8870", "#625546", "#c7b496"], ["#8c7461", "#534943", "#b5a28a"], ["#81908d", "#455558", "#becac2"], ["#657387", "#343f54", "#a8b7c9"], ["#b2a786", "#675d50", "#ece0b4"]],
  ranger: [["#878367", "#505442", "#b5b295"], ["#6e805c", "#3c503d", "#a3b58a"], ["#4e796a", "#2c4d49", "#8db49b"], ["#526574", "#303e4d", "#8da9b4"], ["#486757", "#293c37", "#a4b995"]],
};
const trims = ["#bca27a", "#b7aa7c", "#c9b584", "#d8b87b", "#f0cf80"];

/** Each named piece has its own material/ornament; class variants retain their own cut. */
export function gearSkin(item: ItemDef, classId: HeroClass): GearSkin {
  const tier = tiers[item.rarity] ?? 0;
  const family = item.id.replace(/_(monk|mage|warrior|ranger)$/, "");
  const [base, shade, light] = fabrics[classId][tier]!;
  let trim = trims[tier]!;
  if (/ember|cinder|coal|blood/.test(family)) trim = "#e99365";
  else if (/venom|viper|thorn|briar/.test(family)) trim = "#a5c483";
  else if (/storm|thunder|gale|ghost|stillwater/.test(family)) trim = "#9acedd";
  else if (/moon|seer|scribe|spell/.test(family)) trim = "#b6a5dc";
  return { id: `${classId}/${item.id}`, slot: item.slot, classId, tier, family, base, shade, light, trim };
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
