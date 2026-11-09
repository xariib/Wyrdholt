import { describe, expect, it } from "vitest";
import { FORGE_V1 } from "@emberbound/game-content";
import {
  ContentIndex, advanceAdventure, canUseItem, cloneProfile, createInstance, createProfile,
  findInstance, fuse, isItemLocked, parseSave, partySnapshot, prepareFight, rollLoot, serializeSave, setItemLock,
  simulateOffline, startRun,
} from "@emberbound/game-core";
import type { ContentSnapshot } from "@emberbound/shared-types";
import legacySnapshot from "./fixtures/c2-content.json";
import { content, newProfile, run } from "./helpers";

const classes = [
  ["monk", "wayfarer_wraps", "wraps"],
  ["mage", "apprentice_staff", "staff"],
  ["warrior", "wayfarer_blade", "blade"],
  ["ranger", "trail_bow", "bow"],
] as const;

describe("class gear", () => {
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
        if (item.slot === "weapon") {
          expect(item.classId).toBe(classId);
          expect(item.icon).toBe(icon);
          seen.add(item.rarity);
        }
      }
    }
    expect([...seen].sort()).toEqual([...FORGE_V1.rarities].sort());
    expect(content.snapshot.items.filter(i => i.classId === classId && i.slot !== "weapon")).toHaveLength(2);
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
    const sharedHead = p.equipment.head;
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
    expect(p.equipment).toMatchObject({ weapon: sword.id, head: sharedHead });
    expect(p.equipment.chest).toBeUndefined();
    expect(findInstance(p, robe.id)).toBe(robe);
    expect(run(p, { type: "setActiveClass", classId: "mage" }).ok).toBe(true);
    expect(p.equipment.weapon).toBe(staff);
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
