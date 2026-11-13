import { describe, expect, it } from "vitest";
import { CONTENT } from "@emberbound/game-content";
import { ContentIndex, createInstance, createProfile, serializeSave } from "@emberbound/game-core";
import { equippedAppearance, GEAR_SLOTS, gearSkin, HERO_CLASSES, starterAppearance, heroAttackName } from "../src/art/gearSkins";
import { attackStyle } from "../src/render/attackEffects";
import { characterOffset, unarmedApproach, UNARMED_ATTACK } from "../src/render/characterMotion";
import { attackDurations } from "../src/art/darkwood";

const content = new ContentIndex(CONTENT);
const fixture = (classId = "warrior") => createProfile(content, { name: "Skins", activeClassId: classId,
  alternateClassId: classId === "mage" ? "monk" : "mage", masterSeed: 17, nowWallMs: 0 });

describe("equipment-driven appearances", () => {
  it("covers every live class item with a named design independent of rarity", () => {
    const items = CONTENT.items.filter(i => HERO_CLASSES.includes(i.classId as typeof HERO_CLASSES[number]));
    expect(items).toHaveLength(344);
    for (const item of items) {
      const cls = item.classId as typeof HERO_CLASSES[number], skin = gearSkin(item, cls);
      expect(skin.design.shape).toBe(skin.family);
      expect(skin.design.cut).toBe(cls);
      for (const rarity of ["common", "uncommon", "rare", "epic", "legendary"] as const) {
        const alternate = gearSkin({ ...item, rarity }, cls);
        expect(alternate.design).toEqual(skin.design);
        expect([alternate.base, alternate.shade, alternate.light, alternate.trim]).toEqual([skin.base, skin.shade, skin.light, skin.trim]);
      }
    }
  });
  it("requires an authored design when a new item family is introduced", () => {
    const item = CONTENT.items.find(i => i.classId === "warrior")!;
    expect(() => gearSkin({ ...item, id: "unillustrated_item_warrior" }, "warrior")).toThrow("Missing pixel gear design");
    expect(() => gearSkin({ ...item, id: "linen_hood_warrior", slot: "boots" }, "warrior")).toThrow("Missing pixel gear design");
  });
  it.each(HERO_CLASSES)("uses fists for an unarmed %s until its queued weapon is equipped", cls => {
    const p = fixture(cls);
    const weapon = createInstance(p, CONTENT.items.find(i => i.classId === cls && i.slot === "weapon" && i.rarity === "common")!.id, { isNew: true }).id;
    p.equipment.gloves = createInstance(p, `worn_grips_${cls}`, { isNew: true }).id;
    const pinned = { ...p.equipment };
    expect(p.equipment.gloves).toBeDefined();
    expect(heroAttackName(equippedAppearance(p, content))).toBe("unarmed");
    expect(attackStyle(heroAttackName(equippedAppearance(p, content)))).toBe("fist");
    p.pending = { equipment: { weapon } };
    expect(heroAttackName(equippedAppearance(p, content))).toBe("unarmed");
    p.equipment.weapon = weapon;
    expect(heroAttackName(equippedAppearance(p, content))).toBe(cls);
    expect(heroAttackName(equippedAppearance(p, content, pinned))).toBe("unarmed");
    delete p.equipment.weapon;
    expect(heroAttackName(equippedAppearance(p, content))).toBe("unarmed");
  });
  it("closes the distance during unarmed anticipation and returns after the strike", () => {
    expect(unarmedApproach(100, 0, UNARMED_ATTACK.ms)).toBe(0);
    expect(unarmedApproach(100, 130, UNARMED_ATTACK.ms)).toBeGreaterThan(0);
    expect(unarmedApproach(100, 320, UNARMED_ATTACK.ms)).toBe(74);
    expect(unarmedApproach(100, 960, UNARMED_ATTACK.ms)).toBe(0);
    expect(unarmedApproach(12, 320, UNARMED_ATTACK.ms)).toBe(0);
  });
  it.each(HERO_CLASSES)("keeps %s grounded at rest and reaches melee contact without overshooting", cls => {
    for (const time of [0, 125, 500, 1000]) expect(characterOffset(cls, "idle", 0, time)).toEqual([0, 0]);
    for (const distance of [12, 60, 180]) {
      const contact = unarmedApproach(distance, 320, UNARMED_ATTACK.ms, cls);
      const samples = [0, 80, 160, 240, 320].map(t => unarmedApproach(distance, t, UNARMED_ATTACK.ms, cls));
      expect(samples.at(-1)).toBe(contact);
      expect(samples).toEqual([...samples].sort((a, b) => a - b));
      expect(contact).toBeGreaterThanOrEqual(0);
      expect(contact).toBeLessThan(distance);
      expect(unarmedApproach(distance, 960, UNARMED_ATTACK.ms, cls)).toBe(0);
      for (const interval of [350, 520, 700, 1000]) {
        const timing = attackDurations(UNARMED_ATTACK, interval);
        const duration = timing.reduce((a, b) => a + b, 0);
        const positions = Array.from({ length: duration + 1 }, (_, t) => unarmedApproach(distance, t, timing, cls));
        expect(positions.at(-1)).toBe(0);
        // No pose-boundary teleports, including the compressed high-speed recovery.
        expect(Math.max(...positions.slice(1).map((x, i) => Math.abs(x - positions[i]!)))).toBeLessThan(4);
      }
    }
  });
  it("retains class weight and posture when the attack style is unarmed", () => {
    const signatures = HERO_CLASSES.map(cls => [
      unarmedApproach(100, 130, UNARMED_ATTACK.ms, cls), unarmedApproach(100, 500, UNARMED_ATTACK.ms, cls),
      characterOffset(cls, "attack", 1, 120, 0, "unarmed"),
    ]);
    expect(new Set(signatures.map(s => JSON.stringify(s))).size).toBe(4);
    expect(characterOffset("mage", "attack", 1, 120, 0, "unarmed")[1]).toBe(0);
    expect(characterOffset("warrior", "attack", 1, 120, 0, "unarmed")[1]).toBe(0);
  });
  it.each(HERO_CLASSES)("starts %s with no gear and leaves saves untouched", cls => {
    const p = fixture(cls), before = serializeSave(p, 0);
    const look = equippedAppearance(p, content);
    expect(starterAppearance(cls, content)).toEqual(look);
    expect(look.slots).toEqual({});
    expect(p.equipment).toEqual({});
    expect(p.inventory.instances).toEqual([]);
    expect(heroAttackName(look)).toBe("unarmed");
    expect(serializeSave(p, 0)).toBe(before);
  });
  it("ignores stronger owned and queued gear, then changes exactly the equipped slot", () => {
    const p = fixture(), before = equippedAppearance(p, content), pinned = { ...p.equipment };
    const helm = createInstance(p, "cinder_crown_warrior", { isNew: true });
    p.pending = { equipment: { head: helm.id } };
    expect(equippedAppearance(p, content)).toEqual(before);
    p.equipment.head = helm.id;
    const after = equippedAppearance(p, content);
    expect(after.slots.head?.family).toBe("cinder_crown");
    for (const slot of GEAR_SLOTS.filter(s => s !== "head")) expect(after.slots[slot]).toEqual(before.slots[slot]);
    expect(equippedAppearance(p, content, pinned)).toEqual(before);
  });
  it("removes empty layers and never borrows gear from another class", () => {
    const p = fixture(); delete p.equipment.head; delete p.equipment.weapon;
    expect(equippedAppearance(p, content).slots.head).toBeUndefined();
    expect(equippedAppearance(p, content).slots.weapon).toBeUndefined();
    expect(equippedAppearance(p, content, p.equipment, "mage").slots).toEqual({});
  });
  it("gives duplicate copies the same skin and every named class piece a distinct identity", () => {
    const p = fixture();
    p.equipment.weapon = createInstance(p, "wayfarer_blade", { isNew: true }).id;
    const before = equippedAppearance(p, content);
    const copy = createInstance(p, "wayfarer_blade", { isNew: true }); p.equipment.weapon = copy.id;
    expect(equippedAppearance(p, content)).toEqual(before);
    const skins = CONTENT.items.filter(i => HERO_CLASSES.includes(i.classId as typeof HERO_CLASSES[number]))
      .map(i => gearSkin(i, i.classId as typeof HERO_CLASSES[number]));
    expect(new Set(skins.map(s => s.id)).size).toBe(skins.length);
  });
});
