import { SLOT_ORDER, type FightRecord, type HuntRoute, type SlotId } from "@emberbound/shared-types";
import { applyPendingBuild, heroStatsFor, leaveCurrentRun, offlineFallback, startRun, type PreparedFight } from "../adventure/run";
import { activeBossAttempt } from "../boss/progress";
import type { ContentIndex } from "../content";
import { canonicalJson } from "../hash/canonical";
import { sha256Hex } from "../hash/sha256";
import { canUseItem, createInstance, currentBuild, equippedInstances } from "../items/inventory";
import { deriveSeed, Prng } from "../math/prng";
import type { Profile } from "../profile/types";
import { checkRecordCompatibility, executeRecord, ReplayMismatchError } from "../replay/replay";
import { HUNT_RULES_VERSION } from "../rules/version";
import type { HuntAttempt, HuntDiscovery, HuntResult } from "./types";

export function huntSeed(masterSeed: number, discoveryId: number, step: number, label = "fight"): number {
  return deriveSeed(masterSeed, `hunt/${discoveryId}/step/${step}/${label}`);
}
export type HuntFightCache = WeakMap<FightRecord, PreparedFight>;

export function prepareHuntFight(content: ContentIndex, attempt: HuntAttempt, recordEvents: boolean, cache?: HuntFightCache): PreparedFight | null {
  const record = attempt.record;
  const cached = cache?.get(record);
  if (cached && (!recordEvents || cached.events !== null)) return cached;
  try { checkRecordCompatibility(content, record); }
  catch (error) { if (error instanceof ReplayMismatchError) return null; throw error; }
  const fight = { ...executeRecord(content, record, { recordEvents }), record, key: sha256Hex(canonicalJson(record)) };
  cache?.set(record, fight);
  return fight;
}

/** Starts one encounter only. A route choice and every retry require a player command. */
export function startHunt(profile: Profile, content: ContentIndex, id: number, slot?: SlotId, route?: HuntRoute): string | null {
  const state = profile.hunts;
  const discovery = state?.queue.find(h => h.id === id);
  const hunt = discovery && content.hunts.get(discovery.huntId);
  if (!state || !discovery || !hunt || !profile.adventure.zones[hunt.zoneId]?.cleared) return "This Hunt is not available.";
  if (state.active || activeBossAttempt(profile)) return "Finish the current fight first.";
  if (state.queue.some(h => h.id !== id && h.slot !== null)) return "Finish your current Hunt before starting another.";
  if (slot !== undefined && !(SLOT_ORDER as readonly string[]).includes(slot)) return "Choose a gear slot.";
  if (discovery.slot === null && slot === undefined) return "Choose your gear reward first.";
  if (discovery.slot !== null && slot !== undefined && slot !== discovery.slot) return "This Hunt's reward slot is already chosen.";
  if (route !== undefined && (!["direct", "raid", "weakness"].includes(route) || discovery.step !== 1 || discovery.route !== null)) return "This route is not available.";
  if (discovery.step === 1 && discovery.route === null && route === undefined) return "Choose a route first.";
  if (!Number.isSafeInteger(profile.inventory.nextInstanceId + 1)) return "The inventory counter is full.";
  if (discovery.step === 0 && !Number.isSafeInteger(profile.gold + content.zone(hunt.zoneId).cache.gold)) return "The Gold counter is full.";
  leaveCurrentRun(profile);
  profile.adventure.lastResult = null;
  applyPendingBuild(profile, content);
  discovery.slot ??= slot!;
  if (route !== undefined) { discovery.route = route; if (route === "direct") discovery.step = 2; }
  const build = currentBuild(profile);
  const record: FightRecord = {
    format: "emberbound-fight-record/4", rulesVersion: HUNT_RULES_VERSION,
    contentVersion: content.snapshot.contentVersion, contentHash: content.huntHash,
    seed: huntSeed(profile.masterSeed, discovery.id, discovery.step), build,
    itemInstances: JSON.parse(JSON.stringify([...equippedInstances(profile, build).values()])),
    encounter: { zoneId: hunt.zoneId, stageIndex: discovery.step },
    hunt: { huntId: hunt.id, discoveryId: discovery.id, step: discovery.step, route: discovery.route },
    startHp100: discovery.hp100 === null ? null : Math.min(discovery.hp100, heroStatsFor(profile, content).maxHp100),
    activeRuleIds: [],
  };
  state.active = { record, elapsedMs: 0 };
  return null;
}

function targetedReward(profile: Profile, content: ContentIndex, discovery: HuntDiscovery, record: FightRecord): number {
  const hunt = content.hunts.get(discovery.huntId)!;
  const zone = content.zone(hunt.zoneId);
  const table = content.lootTable(zone.cacheLootTableId ?? zone.bossLootTableId);
  const cap = content.rarity(table.maxRarity).order;
  const rng = new Prng(huntSeed(profile.masterSeed, discovery.id, discovery.step, "reward"));
  const rarities = content.raritiesByOrder;
  let index = rng.pickWeighted(rarities.map(r => r.order <= cap ? table.weights[r.id] ?? 0 : 0));
  for (; index >= 0; index--) {
    const candidates = content.snapshot.items.filter(item => item.slot === discovery.slot && item.rarity === rarities[index]!.id
      && item.minEncounterLevel <= hunt.boss.level && canUseItem(item, record.build.classId));
    if (!candidates.length) continue;
    const item = createInstance(profile, candidates[rng.nextInt(candidates.length)]!.id, { isNew: true, provenance: { source: "hunt", zoneId: hunt.zoneId } });
    profile.stats.itemsFound++;
    return item.id;
  }
  throw new Error("No eligible Hunt reward");
}

/** Settles at most the manually entered encounter, then farms safely with remaining time. */
export function advanceHunt(profile: Profile, content: ContentIndex, deltaMs: number, options: {
  recordEvents?: boolean; huntCache?: HuntFightCache; onHuntResult?: (result: HuntResult) => void;
}): number {
  const state = profile.hunts;
  const attempt = state?.active;
  if (!state || !attempt) return deltaMs;
  const ref = attempt.record.hunt!;
  const discovery = state.queue.find(h => h.id === ref.discoveryId)!;
  const fight = prepareHuntFight(content, attempt, options.recordEvents === true, options.huntCache);
  const elapsed = fight ? Math.min(deltaMs, Math.max(0, fight.summary.durationMs - attempt.elapsedMs)) : 0;
  attempt.elapsedMs += elapsed;
  profile.clock.simulatedMs += elapsed;
  if (fight && attempt.elapsedMs < fight.summary.durationMs) return 0;
  const outcome = fight?.summary.outcome ?? "interrupted";
  const result: HuntResult = {
    discoveryId: discovery.id, huntId: discovery.huntId, step: discovery.step, outcome, itemIds: [], gold: 0,
    enemyHp100: fight?.summary.enemies.reduce((sum, e) => sum + e.hp100, 0) ?? 0,
    enemyMaxHp100: fight?.summary.enemies.reduce((sum, e) => sum + e.maxHp100, 0) ?? 0,
  };
  if (fight) {
    profile.stats.fights++;
    if (outcome === "victory") {
      profile.stats.victories++;
      if (discovery.step === 2 || discovery.step === 1 && discovery.route === "raid") {
        result.itemIds.push(targetedReward(profile, content, discovery, attempt.record));
      } else if (discovery.step === 0) {
        result.gold = content.zone(attempt.record.encounter.zoneId).cache.gold;
        profile.gold += result.gold;
      }
      discovery.hp100 = fight.summary.hero.hp100;
      if (discovery.step === 2) { state.queue = state.queue.filter(h => h.id !== discovery.id); state.completed++; }
      else discovery.step++;
    } else { profile.stats.defeats++; discovery.hp100 = null; }
  } else { discovery.hp100 = null; }
  state.active = null;
  state.lastResult = result;
  applyPendingBuild(profile, content);
  const fallback = offlineFallback(profile, content, { mode: "push", zoneId: attempt.record.encounter.zoneId });
  if (fallback) startRun(profile, content, fallback.zoneId, fallback.mode, content.snapshot.config.restMs);
  options.onHuntResult?.(result);
  return deltaMs - elapsed;
}
