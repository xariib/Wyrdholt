import type { ContentIndex } from "../content";
import type { Profile } from "../profile/types";
import { findInstance, reservedInstanceIds } from "./inventory";
import { isItemLocked } from "./locks";

/** SALVAGE-008 approved test rule; independent of combat and Forge tuning. */
export const SALVAGE_RULES_VERSION = "wyrdholt-salvage-rules/1-test";
const GOLD_BY_RARITY: Readonly<Record<string, number>> = Object.freeze({
  common: 5, uncommon: 15, rare: 50, epic: 100, legendary: 200,
});

export interface SalvageInput {
  instanceId: number;
  rulesVersion: string;
  expectedGold: number;
}
export interface SalvageReceipt {
  instanceId: number;
  baseId: string;
  rulesVersion: string;
  gold: number;
}
export type SalvageResult = { ok: true; queued: false; salvage: SalvageReceipt } | { ok: false; error: string };

/** Read-only quote. The command repeats these checks against the current profile. */
export function previewSalvage(profile: Profile, content: ContentIndex, instanceId: number): SalvageResult {
  if (!Number.isSafeInteger(instanceId) || instanceId < 1) return { ok: false, error: "Invalid item copy." };
  const instance = findInstance(profile, instanceId);
  if (!instance) return { ok: false, error: "This item copy is no longer owned." };
  if (isItemLocked(profile, instanceId)) return { ok: false, error: "Locked copies cannot be salvaged. Unlock this copy first." };
  if (reservedInstanceIds(profile).has(instanceId)) return { ok: false, error: "Equipped and queued copies cannot be salvaged." };
  const rarity = content.item(instance.baseId).rarity;
  const gold = Object.hasOwn(GOLD_BY_RARITY, rarity) ? GOLD_BY_RARITY[rarity] : undefined;
  if (gold === undefined) return { ok: false, error: "This rarity has no salvage reward." };
  return { ok: true, queued: false, salvage: { instanceId, baseId: instance.baseId, rulesVersion: SALVAGE_RULES_VERSION, gold } };
}

/** Exact monotone ownership IDs make retries safe: a consumed ID is never reused. */
export function salvageItem(profile: Profile, content: ContentIndex, input: SalvageInput): SalvageResult {
  if (!input || input.rulesVersion !== SALVAGE_RULES_VERSION || !Number.isSafeInteger(input.expectedGold)) {
    return { ok: false, error: "Salvage preview expired. Review this copy again." };
  }
  const quote = previewSalvage(profile, content, input.instanceId);
  if (!quote.ok) return quote;
  if (input.expectedGold !== quote.salvage.gold) return { ok: false, error: "Salvage reward changed. Review this copy again." };
  if (!Number.isSafeInteger(profile.gold) || profile.gold < 0 || !Number.isSafeInteger(profile.gold + quote.salvage.gold)) {
    return { ok: false, error: "Gold counter exhausted. Nothing was salvaged." };
  }
  // All checks precede the synchronous inventory/Gold mutation. No new save domain.
  profile.inventory.instances = profile.inventory.instances.filter(i => i.id !== input.instanceId);
  profile.gold += quote.salvage.gold;
  if (profile.forge?.devItemIds) profile.forge.devItemIds = profile.forge.devItemIds.filter(id => id !== input.instanceId);
  return quote;
}
