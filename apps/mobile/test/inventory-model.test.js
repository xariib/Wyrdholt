import { describe, expect, it } from "vitest";
import { SLOT_ORDER } from "@emberbound/shared-types";
import { CONTENT } from "@emberbound/game-content";
import { ContentIndex, canUseItem, createInstance, createProfile, previewSalvage, setItemLock } from "@emberbound/game-core";
import { classInventory, gearDifferences, groupsForSlot, slotViews, totalNew } from "../src/ui/gearModel";
import { EMPTY_INVENTORY_FILTERS, filterInventoryGroups, inventoryGroups, inventoryPage, inventorySelectionCounts } from "../src/ui/inventoryModel";

const content = new ContentIndex(CONTENT);
function fixture() {
  const p = createProfile(content, { name: "Inventory", activeClassId: "monk", alternateClassId: "mage", masterSeed: 1042, nowWallMs: 0 });
  p.inventory.instances = []; p.equipment = {};
  const ids = [];
  for (const item of content.snapshot.items.filter(i => canUseItem(i, p.character.activeClassId))) {
    ids.push(createInstance(p, item.id, { isNew: true }).id);
    ids.push(createInstance(p, item.id, { isNew: false }).id);
  }
  for (const slot of SLOT_ORDER) {
    const instances = p.inventory.instances.filter(i => content.item(i.baseId).slot === slot);
    p.equipment[slot] = instances[0].id;
    p.pending ??= { equipment: {} };
    p.pending.equipment[slot] = instances[1].id;
    setItemLock(p, instances[2].id, true);
  }
  return { p, ids };
}

describe("new gear differences", () => {
  it("shows the gains and trade-offs against equipped gear in the right units", () => {
    const ring = gearDifferences(content.item("copper_band"), content.item("amber_ring"));
    expect(ring.stats.map(({ label, value }) => [label, value])).toEqual([
      ["Attack", "+2"], ["Health", "+10"], ["Crit chance", "−1 pp"],
    ]);
    const gloves = gearDifferences(content.item("worn_grips"), content.item("duelist_gloves"));
    expect(gloves.stats.find(row => row.key === "rate")?.value).toBe("+0.03/s");
  });

  it("distinguishes gaining, losing and keeping an effect", () => {
    const crown = content.item("crown_of_thorns"), hood = content.item("linen_hood");
    expect(gearDifferences(null, crown).gainedEffect).toEqual(crown.effect);
    expect(gearDifferences(crown, hood).lostEffect).toEqual(crown.effect);
    expect(gearDifferences(crown, crown)).toEqual({ stats: [], gainedEffect: null, lostEffect: null });
  });
});

describe("combined inventory view", () => {
  it("shows only the active class across slots, inventory and badges until a switch settles", () => {
    const { p } = fixture();
    for (const item of content.snapshot.items.filter(i => !canUseItem(i, "monk"))) createInstance(p, item.id, { isNew: true });
    const savedItems = structuredClone(p.inventory);
    for (const classId of ["warrior", "mage", "ranger", "monk"]) {
      p.character.activeClassId = classId;
      p.pending = { activeClassId: classId === "mage" ? "warrior" : "mage", equipment: {} };
      const expected = p.inventory.instances.filter(i => canUseItem(content.item(i.baseId), classId));
      const ids = inventoryGroups(p, content).flatMap(g => g.ids).sort((a, b) => a - b);
      expect(ids).toEqual(expected.map(i => i.id));
      expect(classInventory(p, content)).toEqual(expected);
      expect(totalNew(p, content)).toBe(expected.filter(i => i.isNew).length);
      for (const slot of SLOT_ORDER) {
        expect(groupsForSlot(p, content, slot).flatMap(g => g.ids).sort((a, b) => a - b))
          .toEqual(expected.filter(i => content.item(i.baseId).slot === slot).map(i => i.id));
        const view = slotViews(p, content).find(v => v.slot === slot);
        expect(view.newCount).toBe(expected.filter(i => i.isNew && content.item(i.baseId).slot === slot).length);
        if (view.equipped) expect(canUseItem(view.equipped.item, classId)).toBe(true);
      }
    }
    expect(p.inventory).toEqual(savedItems);
  });
  it("groups every owned copy once in all six slots with correct protections", () => {
    const { p, ids } = fixture(), before = structuredClone(p);
    const groups = inventoryGroups(p, content);
    expect(new Set(groups.map(g => g.item.slot))).toEqual(new Set(SLOT_ORDER));
    expect(groups.flatMap(g => g.ids).sort((a, b) => a - b)).toEqual(ids);
    for (const g of groups) {
      expect(g.totalCount).toBe(2); expect(g.newCount).toBe(1);
      expect(g.lockedCount).toBe(g.ids.filter(id => p.itemLocks.lockedInstanceIds.includes(id)).length);
      expect(g.eligibleCount).toBe(g.ids.filter(id => previewSalvage(p, content, id).ok).length);
    }
    expect(p).toEqual(before);
  });

  for (const slot of SLOT_ORDER) for (const rarity of ["common", "uncommon", "rare", "epic", "legendary"]) {
    it(`intersects name/effect, NEW and eligibility for ${slot}/${rarity}`, () => {
      const { p } = fixture(); const groups = inventoryGroups(p, content);
      const item = content.snapshot.items.find(i => i.slot === slot && i.rarity === rarity && i.classId === "monk");
      const search = `  ${item.name.toUpperCase()} ${item.effect?.name ?? ""}  `;
      for (const salvage of ["", "eligible", "protected"]) {
        const filtered = filterInventoryGroups(groups, { search, slot, rarityId: rarity, newOnly: true, salvage });
        const expected = p.inventory.instances.filter(i => i.baseId === item.id && i.isNew
          && (!salvage || previewSalvage(p, content, i.id).ok === (salvage === "eligible"))).map(i => i.id);
        expect(filtered.flatMap(g => g.ids)).toEqual(expected);
      }
    });
  }

  it("flags exact duplicates among the visible copies without flagging equipped or modified gear", () => {
    const { p } = fixture();
    const equipped = p.inventory.instances.find(i => i.id === p.equipment.weapon);
    const duplicate = createInstance(p, equipped.baseId, { isNew: true });
    const rolled = createInstance(p, equipped.baseId, { isNew: true });
    rolled.rolls = { attack: 2 };

    const groups = inventoryGroups(p, content);
    const group = groups.find(g => g.baseId === equipped.baseId);
    expect(group.copies.find(copy => copy.id === equipped.id).equippedDuplicate).toBe(false);
    const [visible] = filterInventoryGroups([group], { ...EMPTY_INVENTORY_FILTERS, newOnly: true });
    expect(visible.copies.filter(copy => copy.equippedDuplicate).map(copy => copy.id)).toEqual([duplicate.id]);
    expect(visible.ids).toContain(rolled.id);
  });

  it("searches effect descriptions with multiple case-insensitive terms", () => {
    const { p } = fixture(); const groups = inventoryGroups(p, content);
    const words = " ATTACK speed ";
    const expected = groups.filter(g => {
      const text = `${g.item.name} ${g.item.effect?.name ?? ""} ${g.item.effect?.description ?? ""}`.toLowerCase();
      return text.includes("attack") && text.includes("speed");
    });
    expect(expected.length).toBeGreaterThan(0);
    expect(filterInventoryGroups(groups, { ...EMPTY_INVENTORY_FILTERS, search: words }).map(g => g.baseId)).toEqual(expected.map(g => g.baseId));
  });

  it("NEW and eligibility must match one copy, not two different copies of a type", () => {
    const { p } = fixture(); const group = inventoryGroups(p, content).find(g => g.lockedCount);
    const rows = filterInventoryGroups([group], { ...EMPTY_INVENTORY_FILTERS, newOnly: true, salvage: "eligible" });
    expect(rows).toEqual([]);
  });

  it("filters and pagination preserve manual IDs including stale/missing selections", () => {
    const { p, ids } = fixture(); const groups = inventoryGroups(p, content);
    const selected = new Set([groups.find(g => g.item.slot === "weapon").ids[0], groups.find(g => g.item.slot === "ring").ids[0], 99999]); const before = [...selected];
    const filtered = filterInventoryGroups(groups, { ...EMPTY_INVENTORY_FILTERS, slot: "weapon" });
    expect(inventorySelectionCounts(selected, filtered)).toEqual({ total: 3, matching: 1, hidden: 2 });
    for (const page of [0, 1, 999]) expect(inventoryPage(groups, page).rows.length).toBeLessThanOrEqual(20);
    expect([...selected]).toEqual(before);
    expect(inventorySelectionCounts(selected, filterInventoryGroups(groups, { ...EMPTY_INVENTORY_FILTERS, search: "no such gear" }))).toEqual({ total: 3, matching: 0, hidden: 3 });
    expect(inventoryPage([], 99)).toEqual({ page: 0, pages: 1, rows: [] });
    expect(inventoryPage(groups, 99).page).toBe(Math.ceil(groups.length / 20) - 1);
  });

  it("6000 copies stay complete through pagination and intersected filters", () => {
    const { p } = fixture();
    p.inventory.instances = []; p.equipment = {}; delete p.pending; delete p.itemLocks;
    const items = content.snapshot.items.filter(i => canUseItem(i, p.character.activeClassId));
    for (let n = 0; n < 6000; n++) createInstance(p, items[n % items.length].id, { isNew: n % 2 === 0 });
    const groups = inventoryGroups(p, content), selected = new Set(p.inventory.instances.filter((_, n) => n % 100 === 0).map(i => i.id));
    expect(groups.reduce((n, g) => n + g.totalCount, 0)).toBe(6000);
    const result = filterInventoryGroups(groups, { ...EMPTY_INVENTORY_FILTERS, slot: "ring", newOnly: true, salvage: "eligible" });
    expect(result.flatMap(g => g.ids)).toEqual(groups.filter(g => g.item.slot === "ring").flatMap(g => g.copies.filter(c => c.isNew).map(c => c.id)));
    const pages = Array.from({ length: Math.ceil(groups.length / 20) }, (_, n) => inventoryPage(groups, n).rows).flat();
    expect(pages).toEqual(groups); expect(selected.size).toBe(60);
  });
});
