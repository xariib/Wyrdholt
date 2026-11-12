import { describe, expect, it } from "vitest";
import { cloneProfile, createInstance, parseSave, rollLoot, serializeSave, simulateOffline, upgradeClassGearIfSafe } from "@emberbound/game-core";
import { content, newProfile, run, withLegacyStarterGear } from "./helpers";

const classes = ["monk", "mage", "warrior", "ranger"];
describe("empty character starts", () => {
  it.each(classes)("creates and reloads %s with no items in any slot or inventory", cls => {
    const p = newProfile(17, cls, cls === "mage" ? "monk" : "mage");
    const loaded = parseSave(serializeSave(p, 0));
    expect(loaded).toMatchObject({ ok: true, profile: { equipment: {}, inventory: { instances: [], nextInstanceId: 1 } } });
    expect(p.equipment).toEqual({});
    expect(p.inventory.instances).toEqual([]);
    expect(run(p, { type: "setActiveClass", classId: p.character.alternateClassId }).ok).toBe(true);
    expect(p.equipment).toEqual({});
    expect(p.inventory.instances).toEqual([]);
  });
  it.each(classes)("lets unarmed %s earn its first rewards without automatic equipment", cls => {
    for (const seed of [1, 17, 71]) {
      const p = newProfile(seed, cls, cls === "mage" ? "monk" : "mage");
      expect(run(p, { type: "startFarm", zoneId: "greenfields" }).ok).toBe(true);
      simulateOffline(p, content, 120_000, 120_000);
      expect(p.stats.victories, `${cls} seed ${seed}`).toBeGreaterThan(0);
      expect(p.character.xp).toBeGreaterThan(0);
      expect(p.gold).toBeGreaterThan(0);
      expect(p.equipment).toEqual({});
      expect(p.inventory.instances.every(i => i.provenance?.source !== "starter")).toBe(true);
    }
  });
  it.each(classes)("keeps earned %s loot unequipped until the player chooses it", cls => {
    const p = newProfile(17, cls, cls === "mage" ? "monk" : "mage");
    const drop = rollLoot(p, content, "greenfields_cache", 1, 17, { source: "test-reward" })!;
    expect(drop.id).toBe(1);
    expect(p.inventory.instances).toHaveLength(1);
    expect(p.equipment).toEqual({});
    const slot = content.item(drop.baseId).slot;
    expect(run(p, { type: "equip", slot, instanceId: drop.id }).ok).toBe(true);
    expect(p.equipment[slot]).toBe(drop.id);
  });
  it.each(classes)("preserves existing %s gear and deliberate empty slots across the content update", cls => {
    const p = withLegacyStarterGear(newProfile(17, cls, cls === "mage" ? "monk" : "mage"));
    p.contentVersion = "emberbound-content/0.7.0-all-class-gear";
    delete p.equipment.weapon;
    createInstance(p, `copper_band_${cls}`, { isNew: true });
    const before = cloneProfile(p);
    upgradeClassGearIfSafe(p, content);
    expect(p.equipment).toEqual(before.equipment);
    expect(p.inventory).toEqual(before.inventory);
    expect(p.contentVersion).toBe(content.snapshot.contentVersion);
    const oldSave = parseSave(serializeSave(before, 0)), updatedSave = parseSave(serializeSave(p, 0));
    expect(oldSave.ok && updatedSave.ok).toBe(true);
    if (!oldSave.ok || !updatedSave.ok) throw new Error("Save did not reload");
    expect(updatedSave.profile.equipment).toEqual(oldSave.profile.equipment);
    expect(updatedSave.profile.inventory).toEqual(oldSave.profile.inventory);
  });
});
