import { describe, expect, it } from "vitest";
import { CONTENT } from "@emberbound/game-content";
import { ContentIndex, createInstance, createProfile } from "@emberbound/game-core";
import { buildSummary } from "../src/ui/gearModel";

const content = new ContentIndex(CONTENT);
function fixture(classId: string, rank: number) {
  const profile = createProfile(content, { name: "Effects", activeClassId: classId, alternateClassId: classId === "mage" ? "monk" : "mage", masterSeed: 42, nowWallMs: 0 });
  const track = content.classDef(classId).masteryTrackId;
  profile.character.masteryXp[classId] = content.masteryTotals(track)[rank - 1]!;
  return profile;
}

describe("active effect build descriptions", () => {
  it.each(["warrior", "monk", "mage", "ranger"])("describes each unlocked %s class effect separately from equipment", classId => {
    for (const rank of [1, 5, 10, 15, 20]) {
      const summary = buildSummary(fixture(classId, rank), content);
      const techniques = content.track(content.classDef(classId).masteryTrackId).techniques.filter(t => t.unlockRank <= rank);
      expect(summary.stats.activeEffects).toEqual(techniques.map(t => ({ name: t.name, source: "class" })));
      expect(summary.classEffects.map(({ id, name }) => ({ id, name }))).toEqual(techniques.map(({ id, name }) => ({ id, name })));
      expect(summary.classEffects.every(effect => effect.description.length > 0)).toBe(true);
      if (rank < 15) expect(summary.classEffects).toEqual(techniques.map(({ id, name, description }) => ({ id, name, description })));
      expect(summary.activeEffects).toEqual([]);
    }
  });

  it("shows upgraded class values in the build without rewriting mastery content", () => {
    const catalogBefore = JSON.stringify(CONTENT.masteryTracks);
    const descriptions = (classId: string) => Object.fromEntries(buildSummary(fixture(classId, 20), content).classEffects.map(effect => [effect.name, effect.description]));
    expect(descriptions("warrior")["Bleeding Strikes"]).toContain("14% attack per stack every 1s for 5s, up to 5 stacks");
    expect(descriptions("warrior").Execute).toContain("35% health");
    expect(descriptions("monk")["Combo Strike"]).toContain("95% attack");
    expect(descriptions("monk")["Flow State"]).toContain("35% attack speed for 5s");
    expect(descriptions("mage")["Spell Echo"]).toContain("30% chance");
    expect(descriptions("mage").Wildfire).toContain("Every 3 attacks");
    expect(descriptions("ranger")["Poisoned Shots"]).toContain("for 9s, up to 6 stacks");
    expect(descriptions("ranger")["Split Arrow"]).toContain("2 other enemies");
    expect(JSON.stringify(CONTENT.masteryTracks)).toBe(catalogBefore);
  });

  it("identifies equipped sources and keeps queued and unequipped effects out", () => {
    const profile = fixture("warrior", 1);
    const worn = createInstance(profile, "bloodletter", { isNew: false });
    const queued = createInstance(profile, "kingsfall", { isNew: true });
    profile.equipment.weapon = worn.id;
    profile.pending = { equipment: { weapon: queued.id }, activeClassId: "mage" };
    const before = JSON.stringify(profile);
    const effects = buildSummary(profile, content).activeEffects;
    const item = content.item(worn.baseId);
    expect(effects.filter(e => e.source === "item")).toEqual([{
      id: `item-weapon-${worn.id}`, name: item.effect!.name, description: item.effect!.description,
      source: "item", sourceLabel: `Weapon · ${item.name}`, slot: "weapon", baseId: item.id,
    }]);
    expect(effects.some(e => e.name === "Arcane Ward")).toBe(false);
    expect(buildSummary(profile, content).classEffects.map(e => e.name)).toEqual(["Bleeding Strikes"]);
    expect(JSON.stringify(profile)).toBe(before);
  });

  it("keeps the earned promotion in the existing class effects", () => {
    const profile = fixture("warrior", 20);
    profile.schema = 5;
    profile.longTerm = { version: 1, ladders: { trial_warrior: {
      version: 1, highestClearedTier: 1, attemptCount: 1, active: null,
      lastResult: { tier: 1, outcome: "victory", enemyHp100: 0, enemyMaxHp100: 2600000 },
    } } };
    const summary = buildSummary(profile, content);
    expect(summary.stats.activeEffects.at(-1)).toEqual({ name: "Vanguard", source: "class" });
    expect(summary.classEffects.at(-1)).toEqual({ id: "promotion-warrior", name: "Vanguard", description: "+10% Attack while Warrior is active." });
    expect(summary.activeEffects).toEqual([]);
  });
});
