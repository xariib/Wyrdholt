import type { ForgeConfig, ForgeInput, SlotId } from "@emberbound/shared-types";
import {
  applyPendingBuild,
  isFightActive,
  leaveCurrentRun,
  startRun,
  zoneProgress,
} from "../adventure/run";
import { startBossAttempt } from "../boss/ladder";
import { activeBossAttempt } from "../boss/progress";
import type { ContentIndex } from "../content";
import { advanceGame, type AdvanceGameOptions } from "../game";
import { fuse, forgeState } from "../items/forge";
import { canUseItem, createInstance, discardIncompatiblePendingGear, findInstance, reconcileEquipment, reservedInstanceIds, upgradeClassGear } from "../items/inventory";
import { isItemLocked, setItemLock } from "../items/locks";
import { salvageItems, type BulkSalvageInput, type BulkSalvageReceipt } from "../items/bulkSalvage";
import { salvageItem, type SalvageInput, type SalvageReceipt } from "../items/salvage";
import type { Profile } from "../profile/types";

/**
 * Player commands. Every state change the player can make goes through here,
 * so a future server can validate a command log by replaying it.
 */
export type Command =
  | { type: "bulkSalvage"; input: BulkSalvageInput }
  | { type: "salvage"; input: SalvageInput }
  | { type: "setItemLock"; instanceId: number; locked: boolean }
  | { type: "forge"; input: ForgeInput }
  | { type: "devForge"; action: "unlock" | "gold" | "emptyGold" | "grant" | "reset"; slot?: SlotId; rarity?: string; count?: number }
  | { type: "startPush"; zoneId: string }
  | { type: "startFarm"; zoneId: string }
  | { type: "startBoss"; tier: number; autoPush: boolean; bossId?: string }
  | { type: "equip"; slot: SlotId; instanceId: number }
  | { type: "setActiveClass"; classId: string }
  | { type: "cancelPending" }
  | { type: "markReviewed"; instanceIds: number[] }
  | { type: "advance"; ms: number }
  /** Developer-only: adds sample items for Gear UX evaluation. */
  | { type: "devGrant"; baseIds: string[] }
  /** Developer-only: unlocks every playable zone (visual checks). Clears nothing. */
  | { type: "devUnlockZones" };

export type CommandResult = { ok: true; queued: boolean; forge?: import("@emberbound/shared-types").ForgeReceipt; salvage?: SalvageReceipt; bulkSalvage?: BulkSalvageReceipt; repeated?: boolean } | { ok: false; error: string };

const OK: CommandResult = { ok: true, queued: false };
const QUEUED: CommandResult = { ok: true, queued: true };

export function applyCommand(
  profile: Profile,
  content: ContentIndex,
  command: Command,
  options: Omit<AdvanceGameOptions, "offline"> & { offline?: boolean; forgeConfig?: ForgeConfig; allowDevForge?: boolean; authorityForgeSeed?: number },
): CommandResult {
  switch (command.type) {
    case "bulkSalvage":
      return salvageItems(profile, content, command.input);
    case "salvage":
      return salvageItem(profile, content, command.input);
    case "setItemLock": {
      const error = setItemLock(profile, command.instanceId, command.locked);
      return error ? { ok: false, error } : OK;
    }
    case "forge":
      return options.forgeConfig ? fuse(profile, content, options.forgeConfig, command.input, options.allowDevForge, options.authorityForgeSeed) : { ok: false, error: "Forge configuration unavailable." };
    case "devForge": {
      if (!options.allowDevForge || !options.forgeConfig) return { ok: false, error: "Forge DEV tools are disabled." };
      if (command.action === "gold" && !Number.isSafeInteger(profile.gold + 50000)) return { ok: false, error: "Gold counter exhausted." };
      const pool = command.action === "grant" ? content.snapshot.items.filter(i =>
        i.slot === command.slot && i.rarity === command.rarity && canUseItem(i, profile.character.activeClassId)) : [];
      const count = command.count ?? options.forgeConfig.recipes[command.rarity ?? ""]?.count ?? 1;
      if (command.action === "grant" && (!pool.length || !Number.isSafeInteger(count) || count < 1 || count > 2000
        || (profile.forge?.devItemIds?.length ?? 0) + count > 10000
        || !Number.isSafeInteger(profile.inventory.nextInstanceId + count))) return { ok: false, error: "Invalid or too large DEV grant." };
      const state = forgeState(profile);
      if (command.action === "unlock") state.devUnlocked = true;
      if (command.action === "gold") profile.gold += 50000;
      if (command.action === "emptyGold") profile.gold = 0;
      if (command.action === "grant") {
        state.devItemIds ??= [];
        for (let i = 0; i < count; i++) state.devItemIds.push(createInstance(profile, pool[i % pool.length]!.id, { isNew: true }).id);
      }
      if (command.action === "reset") {
        const reserved = reservedInstanceIds(profile), dev = new Set(state.devItemIds ?? []);
        profile.inventory.instances = profile.inventory.instances.filter(i => !dev.has(i.id) || reserved.has(i.id) || isItemLocked(profile, i.id));
        state.devItemIds = [...dev].filter(id => reserved.has(id) || isItemLocked(profile, id));
      }
      return OK;
    }
    case "advance":
      advanceGame(profile, content, command.ms, { ...options, offline: options.offline ?? false });
      return OK;
    case "startBoss": {
      const error = startBossAttempt(profile, content, command.tier, command.autoPush, command.bossId, options.contentTimeMs);
      return error ? { ok: false, error } : OK;
    }
    case "startPush":
      return startActivity(profile, content, command.zoneId, "push");
    case "startFarm":
      return startActivity(profile, content, command.zoneId, "farm");
    case "equip":
      return equip(profile, content, command.slot, command.instanceId);
    case "setActiveClass":
      return setActiveClass(profile, content, command.classId);
    case "cancelPending":
      profile.pending = null;
      return OK;
    case "markReviewed":
      for (const id of command.instanceIds) {
        const instance = findInstance(profile, id);
        if (instance) instance.isNew = false;
      }
      return OK;
    case "devGrant":
      for (const baseId of command.baseIds) {
        content.item(baseId);
        createInstance(profile, baseId, { isNew: true, provenance: { source: "dev-grant" } });
      }
      return OK;
    case "devUnlockZones":
      for (const zone of content.snapshot.zones) {
        if (zone.implemented && !zone.hidden) zoneProgress(profile, zone.id).unlocked = true;
      }
      return OK;
  }
}

function startActivity(profile: Profile, content: ContentIndex, zoneId: string, kind: "push" | "farm"): CommandResult {
  if (activeBossAttempt(profile)) return { ok: false, error: "Adventure resumes when the challenge attempt ends." };
  const zone = content.zones.get(zoneId);
  if (!zone || zone.hidden) return { ok: false, error: "Unknown zone." };
  if (!zone.implemented) return { ok: false, error: `${zone.name} is not playable in this build.` };
  const zp = zoneProgress(profile, zoneId);
  if (!zp.unlocked) return { ok: false, error: `${zone.name} is locked.` };
  const adv = profile.adventure;

  if (kind === "push") {
    if (zp.cleared) return { ok: false, error: `${zone.name} is already cleared. Farm it instead.` };
    if (adv.activity === "push" && adv.run?.zoneId === zoneId) return OK;
  } else {
    const mode = zp.cleared ? "farm" : "trail";
    if (adv.activity === "farm" && adv.run?.zoneId === zoneId && adv.run.mode === mode) return OK;
  }

  // An explicit activity change ends the old attempt cleanly, then applies queued changes.
  leaveCurrentRun(profile);
  applyPendingBuild(profile, content);
  const cfg = content.snapshot.config;
  if (kind === "push") startRun(profile, content, zoneId, "push", cfg.restMs);
  else startRun(profile, content, zoneId, zp.cleared ? "farm" : "trail", cfg.restMs);
  adv.lastResult = null;
  return OK;
}

function equip(profile: Profile, content: ContentIndex, slot: SlotId, instanceId: number): CommandResult {
  const instance = findInstance(profile, instanceId);
  if (!instance) return { ok: false, error: "You do not own that item." };
  const item = content.item(instance.baseId);
  if (item.slot !== slot) return { ok: false, error: `${item.name} does not fit the ${slot} slot.` };
  const fighting = isFightActive(profile);
  const classId = (fighting ? profile.pending?.activeClassId : undefined) ?? profile.character.activeClassId;
  if (!canUseItem(item, classId)) return { ok: false, error: `${item.name} requires ${content.classDef(item.classId!).name}.` };
  instance.isNew = false;
  if (fighting) {
    // Build snapshot rule: the running fight keeps its build.
    const pending = profile.pending ?? {};
    const equipment = { ...(pending.equipment ?? {}) };
    if (profile.equipment[slot] === instanceId) delete equipment[slot];
    else equipment[slot] = instanceId;
    pending.equipment = equipment;
    profile.pending = pending;
    return QUEUED;
  }
  profile.equipment[slot] = instanceId;
  if (profile.pending?.equipment) delete profile.pending.equipment[slot];
  return OK;
}

function setActiveClass(profile: Profile, content: ContentIndex, classId: string): CommandResult {
  const c = profile.character;
  if (classId !== c.activeClassId && classId !== c.alternateClassId) {
    return { ok: false, error: "That class is not learned." };
  }
  if (isFightActive(profile)) {
    const pending = profile.pending ?? {};
    if (classId === c.activeClassId) delete pending.activeClassId;
    else pending.activeClassId = classId;
    profile.pending = pending;
    discardIncompatiblePendingGear(profile, content, classId);
    return QUEUED;
  }
  upgradeClassGear(profile, content);
  if (classId !== c.activeClassId) {
    c.alternateClassId = c.activeClassId;
    c.activeClassId = classId;
    reconcileEquipment(profile, content);
  }
  if (profile.pending) delete profile.pending.activeClassId;
  discardIncompatiblePendingGear(profile, content, classId);
  return OK;
}
