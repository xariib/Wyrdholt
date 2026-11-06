import type { ItemDef, ItemInstance } from "@emberbound/shared-types";
import type { ContentIndex } from "../content";
import { createInstance } from "../items/inventory";
import { BP, mulDivFloor } from "../math/fixed";
import { Prng } from "../math/prng";
import type { Profile } from "../profile/types";

const eligibleCache = new WeakMap<ContentIndex, Map<string, ItemDef[]>>();

function eligibleItems(content: ContentIndex, rarityId: string, encounterLevel: number): ItemDef[] {
  let byKey = eligibleCache.get(content);
  if (!byKey) {
    byKey = new Map();
    eligibleCache.set(content, byKey);
  }
  const key = `${rarityId}|${encounterLevel}`;
  let list = byKey.get(key);
  if (!list) {
    list = content.snapshot.items.filter((i) => i.rarity === rarityId && i.minEncounterLevel <= encounterLevel);
    byKey.set(key, list);
  }
  return list;
}

/**
 * One loot roll. Order of draws: drop chance, rarity, item.
 * The table's maxRarity is enforced in code; unavailable rarities fall back downward.
 */
export function rollLoot(
  profile: Profile,
  content: ContentIndex,
  tableId: string,
  encounterLevel: number,
  seed: number,
  provenance: NonNullable<ItemInstance["provenance"]>,
  /** Share of the table's drop chance (basis points, default 100%). */
  chanceScaleBp: number = BP,
): ItemInstance | null {
  const table = content.lootTable(tableId);
  const rng = new Prng(seed);
  if (!rng.rollBp(mulDivFloor(table.dropChanceBp, chanceScaleBp, BP))) return null;
  const cap = content.rarity(table.maxRarity).order;
  const rarities = content.raritiesByOrder;
  const weights = rarities.map((r) => (r.order <= cap ? (table.weights[r.id] ?? 0) : 0));
  let index = rng.pickWeighted(weights);
  if (index < 0) return null;
  for (; index >= 0; index -= 1) {
    const rarity = rarities[index];
    if (!rarity) continue;
    const candidates = eligibleItems(content, rarity.id, encounterLevel);
    if (candidates.length === 0) continue;
    const item = candidates[rng.nextInt(candidates.length)];
    if (!item) continue;
    return createInstance(profile, item.id, { isNew: true, provenance });
  }
  return null;
}
