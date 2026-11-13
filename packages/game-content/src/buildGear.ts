import { SLOT_ORDER, type ItemDef, type StatBlock } from "@emberbound/shared-types";

const classes = { monk: "Monk", mage: "Mage", warrior: "Warrior", ranger: "Ranger" };
const tiers = [
  { rarity: "rare", rank: 1, name: "Briar" },
  { rarity: "epic", rank: 2, name: "Storm" },
  { rarity: "legendary", rank: 3, name: "Dawn" },
] as const;
const styles = ["precision", "tempo", "bulwark"] as const;
const labels = { precision: "Precision", tempo: "Tempo", bulwark: "Bulwark" };
const tags = { precision: ["PRECISION", "CRIT"], tempo: ["TEMPO", "FAST ATTACKS"], bulwark: ["BULWARK", "SUSTAIN"] };
const slots = { weapon: "Weapon", head: "Headpiece", chest: "Vest", gloves: "Grips", boots: "Stride", ring: "Band" };
const weapons = { monk: "Wraps", mage: "Staff", warrior: "Sword", ranger: "Bow" };

/** Same-tier specializations. No item gets all three stat packages.
 * Effects, encounter gates and weapon families stay with their original source.
 * New stat values are provisional build-choice tuning, separate from progression.
 */
export function createBuildGear(catalog: readonly ItemDef[]): ItemDef[] {
  const items: ItemDef[] = [];
  for (const [classId, className] of Object.entries(classes)) {
    for (const { rarity, rank, name } of tiers) for (const slot of SLOT_ORDER) {
      const source = catalog.find(item => item.classId === classId && item.rarity === rarity && item.slot === slot && !item.classVariants);
      if (!source) throw new Error(`Missing build gear source: ${classId}/${rarity}/${slot}`);
      for (const style of styles) {
        const attack = source.stats.attack ?? 0;
        const packages: Record<typeof styles[number], StatBlock> = {
          precision: { attack: attack + 2 * rank, critBp: (source.stats.critBp ?? 0) + 300 * rank },
          tempo: { attack: Math.max(0, attack - rank), attackRateMilli: (source.stats.attackRateMilli ?? 0) + 60 * rank },
          bulwark: { attack: Math.max(0, attack - 2 * rank), hp: (source.stats.hp ?? 0) + 10 * rank, armor: (source.stats.armor ?? 0) + 2 * rank },
        };
        items.push({
          ...source,
          id: `${style}_${source.id}`,
          name: `${className}'s ${name} ${labels[style]} ${slot === "weapon" ? weapons[classId as keyof typeof weapons] : slots[slot]}`,
          stats: packages[style],
          effect: source.effect ? {
            ...source.effect,
            mechanics: source.effect.mechanics.map(mechanic => ({ ...mechanic, id: `${style}_${source.id}_${mechanic.id}` })),
          } : undefined,
          // The original effect still belongs to this slot; it never stacks with
          // its source because only one copy can be equipped in that slot.
          tags: [...new Set([...tags[style], ...source.tags.filter(tag => !["CRIT", "FAST ATTACKS", "SUSTAIN"].includes(tag))])],
        });
      }
    }
  }
  return items;
}
