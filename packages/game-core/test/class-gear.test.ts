import { describe, expect, it } from "vitest";
import { CONTENT, FORGE_V1 } from "@emberbound/game-content";
import {
  ContentIndex, advanceAdventure, canUseItem, cloneProfile, createInstance, createProfile,
  findInstance, fuse, isItemLocked, parseSave, partySnapshot, prepareFight, rollLoot, serializeSave, setItemLock,
  simulateOffline, startRun,
  upgradeClassGearIfSafe,
} from "@emberbound/game-core";
import { SLOT_ORDER, type ContentSnapshot } from "@emberbound/shared-types";
import legacySnapshot from "./fixtures/c2-content.json";
import { content, newProfile, run } from "./helpers";

const classes = [
  ["monk", "wayfarer_wraps", "wraps"],
  ["mage", "apprentice_staff", "staff"],
  ["warrior", "wayfarer_blade", "blade"],
  ["ranger", "trail_bow", "bow"],
] as const;

describe("class gear", () => {
  it.each(classes)("keeps all %s slot variants mechanically equal to their legacy source", classId => {
    for (const template of CONTENT.items.filter(i => i.classVariants)) {
      const variant = content.item(template.classVariants![classId]!);
      expect(variant.stats).toEqual(template.stats);
      expect(variant.effect).toEqual(template.effect);
      expect(canUseItem(template, classId)).toBe(false);
    }
  });

  it.each(classes)("restricts all six slots to %s and forges every slot for that class", classId => {
    const p = newProfile(17, classId, classId === "warrior" ? "mage" : "warrior");
    p.gold = 500_000;
    p.forge = { version: 1, nextTransactionId: 1, devUnlocked: true };
    for (const slot of SLOT_ORDER) {
      const other = CONTENT.items.find(i => i.slot === slot && i.rarity === "common" && i.classId && i.classId !== classId)!;
      const foreign = createInstance(p, other.id, { isNew: true });
      expect(run(p, { type: "equip", slot, instanceId: foreign.id })).toMatchObject({ ok: false, error: /requires/ });
      for (const mode of ["normal", "critical"] as const) {
        const instanceIds = Array.from({ length: 5 }, () => createInstance(p, other.id, { isNew: true }).id);
        const result = fuse(p, content, FORGE_V1, { configVersion: FORGE_V1.version,
          transactionId: p.forge.nextTransactionId, slot, rarity: "common", mode, instanceIds }, true);
        if (!result.ok) throw new Error(result.error);
        expect(content.item(result.forge.outputBaseId)).toMatchObject({ slot, classId });
      }
    }
  });

  it("migrates every old shared copy at a fight boundary, retaining IDs, locks, rolls and queued choices", () => {
    const variants = new Set(CONTENT.items.flatMap(i => Object.values(i.classVariants ?? {})));
    const oldContent = new ContentIndex({ ...CONTENT, contentVersion: "emberbound-content/0.6.0-class-gear",
      items: CONTENT.items.filter(i => !variants.has(i.id)).map(({ classVariants: _variants, ...item }) => item) });
    const p = createProfile(oldContent, { name: "Veteran", activeClassId: "mage", alternateClassId: "warrior", masterSeed: 17, nowWallMs: 0 });
    const ring = createInstance(p, "ember_seal", { isNew: true });
    ring.rolls = { attack: 2 }; ring.modifiers = ["test"]; ring.upgrade = { level: 2 };
    setItemLock(p, ring.id, true);
    const queued = createInstance(p, "ironbark_mantle", { isNew: true });
    p.pending = { activeClassId: "warrior", equipment: { chest: queued.id } };
    startRun(p, oldContent, "greenfields", "push", 0);
    // Start the old fight before queueing the switch.
    const pending = p.pending; p.pending = null;
    advanceAdventure(p, oldContent, 1, { contentTimeMs: 0, offline: false }); p.pending = pending;
    const before = cloneProfile(p);
    upgradeClassGearIfSafe(p, content);
    expect(p).toEqual(before);
    const fight = prepareFight(p, oldContent, p.adventure.run!, { contentTimeMs: 0, recordEvents: true });
    const loaded = parseSave(serializeSave(p, 0));
    if (!loaded.ok) throw new Error(loaded.reason);
    simulateOffline(loaded.profile, content, fight.summary.durationMs - loaded.profile.adventure.run!.elapsedMs, 1);
    const migrated = loaded.profile;
    expect(findInstance(migrated, ring.id)).toMatchObject({ ...ring, baseId: "ember_seal_mage" });
    expect(isItemLocked(migrated, ring.id)).toBe(true);
    expect(migrated.character.activeClassId).toBe("warrior");
    expect(migrated.equipment.chest).toBe(queued.id);
    expect(findInstance(migrated, queued.id)?.baseId).toBe("ironbark_mantle_warrior");
    for (const instance of migrated.inventory.instances) expect(content.item(instance.baseId).classVariants).toBeUndefined();
    const inventory = cloneProfile(migrated).inventory;
    upgradeClassGearIfSafe(migrated, new ContentIndex({ ...CONTENT, contentVersion: "emberbound-content/0.8.0-test" }));
    expect(migrated.inventory).toEqual(inventory);
    expect(migrated.schema).toBe(before.schema);
  });
  it.each(classes)("gives %s the correct starter and loot across all five weapon rarities", (classId, starter, icon) => {
    const p = newProfile(17, classId, classId === "warrior" ? "mage" : "warrior");
    expect(p.inventory.instances).toHaveLength(6);
    expect(findInstance(p, p.equipment.weapon!)?.baseId).toBe(starter);

    const seen = new Set<string>();
    for (const table of ["greenfields_farm", "greenfields_boss", "greenfields_cache", "darkwood_cache", "ashen_cache"]) {
      for (let seed = 0; seed < 1_000; seed++) {
        const drop = rollLoot(p, content, table, 20, seed, { source: "test" });
        if (!drop) continue;
        const item = content.item(drop.baseId);
        expect(canUseItem(item, classId)).toBe(true);
        expect(item.classId).toBe(classId);
        if (item.slot === "weapon") {
          expect(item.icon).toBe(icon);
          seen.add(item.rarity);
        }
      }
    }
    expect([...seen].sort()).toEqual([...FORGE_V1.rarities].sort());
    for (const slot of SLOT_ORDER) {
      const equipped = findInstance(p, p.equipment[slot]!)!;
      expect(content.item(equipped.baseId).classId).toBe(classId);
      for (const rarity of FORGE_V1.rarities) {
        expect(content.snapshot.items.some(i => i.classId === classId && i.slot === slot && i.rarity === rarity)).toBe(true);
      }
    }
  });

  it.each(classes)("forges only %s weapons, including critical outcomes", classId => {
    const p = newProfile(17, classId, classId === "warrior" ? "mage" : "warrior");
    p.gold = 50_000;
    p.forge = { version: 1, nextTransactionId: 1, devUnlocked: true };
    const material = classId === "warrior" ? "apprentice_staff" : "wayfarer_blade";
    for (const mode of ["normal", "critical"] as const) {
      const instanceIds = Array.from({ length: 5 }, () => createInstance(p, material, { isNew: true }).id);
      const result = fuse(p, content, FORGE_V1, {
        configVersion: FORGE_V1.version, transactionId: p.forge.nextTransactionId,
        slot: "weapon", rarity: "common", mode, instanceIds,
      }, true);
      if (!result.ok) throw new Error(result.error);
      expect(content.item(result.forge.outputBaseId).classId).toBe(classId);
    }
  });

  it("validates equip against the next class and releases incompatible queued copies", () => {
    const p = newProfile(17, "mage", "warrior");
    const sword = createInstance(p, "briar_edge", { isNew: true });
    const robe = createInstance(p, "spellweave_robe", { isNew: true });
    const staff = p.equipment.weapon;
    const mageHead = p.equipment.head;
    const before = cloneProfile(p);
    expect(run(p, { type: "equip", slot: "weapon", instanceId: sword.id })).toMatchObject({ ok: false, error: /requires Warrior/ });
    expect(p).toEqual(before);
    expect(run(p, { type: "equip", slot: "chest", instanceId: robe.id }).ok).toBe(true);

    startRun(p, content, "greenfields", "push", 0);
    advanceAdventure(p, content, 1, { contentTimeMs: 0, offline: false });
    const fight = prepareFight(p, content, p.adventure.run!, { contentTimeMs: 0, recordEvents: true });
    run(p, { type: "setActiveClass", classId: "warrior" });
    expect(run(p, { type: "equip", slot: "weapon", instanceId: sword.id })).toEqual({ ok: true, queued: true });
    run(p, { type: "setActiveClass", classId: "mage" });
    expect(p.pending?.equipment?.weapon).toBeUndefined();
    run(p, { type: "setActiveClass", classId: "warrior" });
    expect(p.equipment.weapon).toBe(staff);

    advanceAdventure(p, content, fight.summary.durationMs, { contentTimeMs: 0, offline: false });
    expect(p.character.activeClassId).toBe("warrior");
    expect(p.equipment.weapon).toBe(sword.id);
    expect(p.equipment.head).toBeUndefined();
    expect(p.equipment.chest).toBeUndefined();
    expect(findInstance(p, robe.id)).toBe(robe);
    expect(run(p, { type: "setActiveClass", classId: "mage" }).ok).toBe(true);
    expect(p.equipment.weapon).toBe(staff);
    expect(p.equipment.head).toBe(mageHead);
  });

  it("keeps an old fight and its locked sword, then upgrades the equipped weapon once", () => {
    const legacy = new ContentIndex(legacySnapshot as ContentSnapshot);
    const p = createProfile(legacy, { name: "Legacy Mage", activeClassId: "mage", alternateClassId: "monk", masterSeed: 17, nowWallMs: 0 });
    const sword = createInstance(p, "bloodletter", { isNew: false });
    p.equipment.weapon = sword.id;
    setItemLock(p, sword.id, true);
    startRun(p, legacy, "greenfields", "push", 0);
    advanceAdventure(p, legacy, 1, { contentTimeMs: 0, offline: false });
    const loaded = parseSave(serializeSave(p, 0));
    if (!loaded.ok) throw new Error(loaded.reason);
    const saved = loaded.profile;
    simulateOffline(saved, content, 1, 1);
    const borrowed = partySnapshot(content, "legacy-mage", 0, saved);
    expect(borrowed.itemInstances.find(i => i.id === borrowed.build.equipment.weapon)?.baseId).toBe("coalheart_staff");
    expect(saved.equipment.weapon).toBe(sword.id);

    const fight = prepareFight(saved, content, saved.adventure.run!, { contentTimeMs: 0, recordEvents: false });
    simulateOffline(saved, content, fight.summary.durationMs - saved.adventure.run!.elapsedMs, 2);
    expect(findInstance(saved, saved.equipment.weapon!)?.baseId).toBe("coalheart_staff");
    expect(findInstance(saved, sword.id)?.baseId).toBe("bloodletter");
    expect(isItemLocked(saved, sword.id)).toBe(true);
    const inventory = cloneProfile(saved).inventory;
    simulateOffline(saved, content, 0, 2);
    expect(saved.inventory).toEqual(inventory);
    expect(saved.schema).toBe(p.schema);
  });
});
