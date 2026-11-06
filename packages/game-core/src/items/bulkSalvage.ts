import type { ContentIndex } from "../content";
import type { Profile } from "../profile/types";
import { previewSalvage, type SalvageReceipt } from "./salvage";

/** BULK-SALVAGE-009: explicit IDs, all-or-nothing; rewards remain SALVAGE-008. */
export const BULK_SALVAGE_RULES_VERSION = "wyrdholt-bulk-salvage-rules/1-test";
export interface BulkSalvageInput {
  rulesVersion: string;
  copies: SalvageReceipt[];
  expectedGold: number;
}
export interface BulkSalvageReceipt {
  rulesVersion: string;
  copies: SalvageReceipt[];
  gold: number;
}
export type BulkSalvageResult = { ok: true; queued: false; bulkSalvage: BulkSalvageReceipt } | { ok: false; error: string };

/** Quotes only the IDs passed by the player. Never filters invalid IDs or fills gaps. */
export function previewBulkSalvage(profile: Profile, content: ContentIndex, instanceIds: number[]): BulkSalvageResult {
  if (!Array.isArray(instanceIds) || !instanceIds.length || instanceIds.length > profile.inventory.instances.length) {
    return { ok: false, error: "Select owned copies to salvage." };
  }
  const seen = new Set<number>(), copies: SalvageReceipt[] = [];
  let gold = 0;
  for (const id of instanceIds) {
    if (seen.has(id)) return { ok: false, error: "Duplicate copy IDs. Nothing was salvaged." };
    seen.add(id);
    const result = previewSalvage(profile, content, id);
    if (!result.ok) return result;
    copies.push(result.salvage); gold += result.salvage.gold;
    if (!Number.isSafeInteger(gold)) return { ok: false, error: "Salvage reward counter exhausted." };
  }
  return { ok: true, queued: false, bulkSalvage: { rulesVersion: BULK_SALVAGE_RULES_VERSION, copies, gold } };
}

/** Every validation finishes before either inventory or Gold is changed. */
export function salvageItems(profile: Profile, content: ContentIndex, input: BulkSalvageInput): BulkSalvageResult {
  if (!input || input.rulesVersion !== BULK_SALVAGE_RULES_VERSION || !Array.isArray(input.copies)
    || !Number.isSafeInteger(input.expectedGold) || input.copies.some(c => !c || typeof c !== "object")) {
    return { ok: false, error: "Bulk salvage preview expired. Review the selected copies again." };
  }
  const result = previewBulkSalvage(profile, content, input.copies.map(c => c.instanceId));
  if (!result.ok) return result;
  const quote = result.bulkSalvage;
  if (input.expectedGold !== quote.gold || input.copies.some((c, i) => {
    const current = quote.copies[i]!;
    return c.baseId !== current.baseId || c.rulesVersion !== current.rulesVersion || c.gold !== current.gold;
  })) return { ok: false, error: "A salvage quote changed. Nothing was salvaged. Review the selected copies again." };
  if (!Number.isSafeInteger(profile.gold) || profile.gold < 0 || !Number.isSafeInteger(profile.gold + quote.gold)) {
    return { ok: false, error: "Gold counter exhausted. Nothing was salvaged." };
  }
  const ids = new Set(quote.copies.map(c => c.instanceId));
  profile.inventory.instances = profile.inventory.instances.filter(i => !ids.has(i.id));
  profile.gold += quote.gold;
  if (profile.forge?.devItemIds) profile.forge.devItemIds = profile.forge.devItemIds.filter(id => !ids.has(id));
  return result;
}
