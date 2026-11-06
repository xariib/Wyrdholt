import { SLOT_ORDER, type ForgeConfig, type ForgeInput, type ForgeReceipt, type ForgeState } from "@emberbound/shared-types";
import type { ContentIndex } from "../content";
import type { Profile } from "../profile/types";
import { canonicalJson } from "../hash/canonical";
import { deriveSeed, Prng } from "../math/prng";
import { createInstance, findInstance, reservedInstanceIds } from "./inventory";
import { isItemLocked, ITEM_LOCK_SAVE_SCHEMA_VERSION } from "./locks";

export const FORGE_RULES_VERSION = "wyrdholt-forge-rules/1";
export function forgeCeiling(profile: Profile, config: ForgeConfig): number {
  if (profile.forge?.devUnlocked) return config.rarities.length - 1;
  return config.gates.reduce((cap, gate) => profile.adventure.zones[gate.zoneId]?.cleared ? Math.max(cap, config.rarities.indexOf(gate.maxRarity)) : cap, -1);
}
export function forgeState(profile: Profile): ForgeState {
  profile.schema = profile.itemLocks ? ITEM_LOCK_SAVE_SCHEMA_VERSION : 2;
  return profile.forge ??= { version: 1, nextTransactionId: 1 };
}
export function eligibleForgeIds(profile: Profile, content: ContentIndex, slot: string, rarity: string): number[] {
  const reserved = reservedInstanceIds(profile);
  const locked = new Set(profile.itemLocks?.lockedInstanceIds ?? []);
  return profile.inventory.instances.filter(i => !reserved.has(i.id) && !locked.has(i.id) && content.item(i.baseId).slot === slot && content.item(i.baseId).rarity === rarity).map(i => i.id);
}
export type ForgeResult = { ok: true; queued: false; forge: ForgeReceipt; repeated: boolean } | { ok: false; error: string };
export function fuse(profile: Profile, content: ContentIndex, config: ForgeConfig, input: ForgeInput, allowDev = false): ForgeResult {
  const fail = (error: string): ForgeResult => ({ ok: false, error });
  if (!Number.isSafeInteger(input.transactionId) || input.transactionId < 1 || !Array.isArray(input.instanceIds) || input.instanceIds.some(id => !Number.isSafeInteger(id) || id < 1)) return fail("Invalid Forge input.");
  const ids = [...input.instanceIds].sort((a, b) => a - b);
  const mode = input.mode ?? "configured";
  const inputKey = canonicalJson({ transactionId: input.transactionId, configVersion: input.configVersion,
    slot: input.slot, rarity: input.rarity, mode, instanceIds: ids });
  const next = profile.forge?.nextTransactionId ?? 1;
  if (input.transactionId < next) {
    const last = profile.forge?.lastReceipt;
    return last?.transactionId === input.transactionId && last.inputKey === inputKey ? { ok: true, queued: false, forge: last, repeated: true } : fail("This Forge action is already settled or stale.");
  }
  if (input.transactionId !== next || input.configVersion !== config.version) return fail("Forge preview expired. Review the recipe again.");
  if (!["configured", "normal", "critical"].includes(mode) || (mode !== "configured" && !allowDev)) return fail("Forced outcomes are DEV-only.");
  if (!SLOT_ORDER.includes(input.slot)) return fail("Invalid equipment slot.");
  const recipe = config.recipes[input.rarity];
  const index = config.rarities.indexOf(input.rarity), cap = forgeCeiling(profile, config);
  if (!recipe || index < 0 || index >= config.rarities.length - 1) return fail("This rarity has no fusion recipe.");
  if (cap < index + 1) return fail("Clear more Adventure content to unlock this Forge tier.");
  if (ids.length !== recipe.count || new Set(ids).size !== ids.length || ids.some(id => !Number.isSafeInteger(id))) return fail(`Select exactly ${recipe.count} different item copies.`);
  const reserved = reservedInstanceIds(profile);
  for (const id of ids) {
    const instance = findInstance(profile, id);
    if (!instance) return fail("A selected item is no longer owned.");
    if (isItemLocked(profile, id)) return fail("A selected item copy is locked. Unlock it in Gear before using it in Forge.");
    if (reserved.has(id)) return fail("Equipped and queued items cannot be consumed.");
    const item = content.item(instance.baseId);
    if (item.slot !== input.slot || item.rarity !== input.rarity) return fail("All materials must share the selected slot and rarity.");
  }
  if (!Number.isSafeInteger(recipe.gold) || recipe.gold < 0 || profile.gold < recipe.gold) return fail("Not enough Gold.");
  const seed = deriveSeed(profile.masterSeed, `${FORGE_RULES_VERSION}|${config.version}|${input.transactionId}|${input.slot}|${input.rarity}|${ids.join(",")}`);
  const rng = new Prng(seed);
  const rolled = rng.rollBp(recipe.criticalBp);
  const critical = (mode === "critical" || (mode === "configured" && rolled)) && index + 2 <= Math.min(cap, config.rarities.length - 1);
  const outputRarity = config.rarities[index + (critical ? 2 : 1)]!;
  const pool = content.snapshot.items.filter(i => i.slot === input.slot && i.rarity === outputRarity).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (!pool.length) return fail("No valid output exists for this recipe. Nothing was spent.");
  const output = pool[rng.nextInt(pool.length)]!;
  if (!Number.isSafeInteger(profile.inventory.nextInstanceId + 1) || !Number.isSafeInteger(next + 1)) return fail("Inventory counter exhausted.");
  // All validation and random resolution precede this synchronous atomic mutation.
  const selected = new Set(ids);
  profile.inventory.instances = profile.inventory.instances.filter(i => !selected.has(i.id));
  profile.gold -= recipe.gold;
  const item = createInstance(profile, output.id, { isNew: true, provenance: { source: "forge-v1" } });
  const state = forgeState(profile);
  const receipt: ForgeReceipt = { transactionId: next, inputKey, rulesVersion: FORGE_RULES_VERSION, configVersion: config.version, slot: input.slot, rarity: input.rarity, consumedIds: ids, count: recipe.count, gold: recipe.gold, seed, draws: rng.draws, critical, outputRarity, outputBaseId: item.baseId, outputInstanceId: item.id, mode };
  state.nextTransactionId++; state.lastReceipt = receipt;
  if (state.devItemIds) state.devItemIds = state.devItemIds.filter(id => !selected.has(id));
  return { ok: true, queued: false, forge: receipt, repeated: false };
}
