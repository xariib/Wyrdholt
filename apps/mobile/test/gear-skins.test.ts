import { describe, expect, it } from "vitest";
import { CONTENT } from "@emberbound/game-content";
import { ContentIndex, createInstance, createProfile, serializeSave } from "@emberbound/game-core";
import { equippedAppearance, GEAR_SLOTS, gearSkin, HERO_CLASSES, starterAppearance, heroAttackName } from "../src/art/gearSkins";
import { attackStyle } from "../src/render/attackEffects";
import { unarmedApproach } from "../src/render/characterMotion";

const content = new ContentIndex(CONTENT);
const fixture = (classId = "warrior") => createProfile(content, { name: "Skins", activeClassId: classId,
  alternateClassId: classId === "mage" ? "monk" : "mage", masterSeed: 17, nowWallMs: 0 });

describe("equipment-driven appearances", () => {
  it.each(HERO_CLASSES)("uses fists for an unarmed %s until its queued weapon is equipped", cls => {
    const p = fixture(cls), weapon = p.equipment.weapon!;
    delete p.equipment.weapon;
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
    expect(unarmedApproach(100, 0, 0, 120)).toBe(-2);
    expect(unarmedApproach(100, 0, 60, 120)).toBeGreaterThan(0);
    expect(unarmedApproach(100, 1, 120, 120)).toBe(74);
    expect(unarmedApproach(100, 3, 400, 120)).toBe(0);
    expect(unarmedApproach(12, 1, 120, 120)).toBe(0);
  });
  it.each(HERO_CLASSES)("starts %s in simple, class-specific gear and leaves saves untouched", cls => {
    const p = fixture(cls), before = serializeSave(p, 0);
    const look = equippedAppearance(p, content);
    expect(starterAppearance(cls, content)).toEqual(look);
    expect(Object.keys(look.slots)).toEqual([...GEAR_SLOTS]);
    for (const s of Object.values(look.slots)) expect(s).toMatchObject({ classId: cls, tier: 0 });
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
    const p = fixture(), before = equippedAppearance(p, content);
    const copy = createInstance(p, "wayfarer_blade", { isNew: true }); p.equipment.weapon = copy.id;
    expect(equippedAppearance(p, content)).toEqual(before);
    const skins = CONTENT.items.filter(i => HERO_CLASSES.includes(i.classId as typeof HERO_CLASSES[number]))
      .map(i => gearSkin(i, i.classId as typeof HERO_CLASSES[number]));
    expect(new Set(skins.map(s => s.id)).size).toBe(skins.length);
  });
});
