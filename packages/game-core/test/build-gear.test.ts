import { describe, expect, it } from "vitest";
import { CONTENT, FORGE_V1 } from "@emberbound/game-content";
import {
  ArraySink, ContentIndex, buildEncounter, canUseItem, combineRuleEffects, createInstance,
  currentBuild, equippedInstances, fuse, parseSave, resolveHeroStats, rollLoot,
  serializeSave, setItemLock, simulateFight,
} from "@emberbound/game-core";
import { SLOT_ORDER, type ItemDef } from "@emberbound/shared-types";
import { content, newProfile, run, setLevel, setMastery } from "./helpers";

const classes = ["monk", "mage", "warrior", "ranger"];
const styles = ["precision", "tempo", "bulwark"];
const added = CONTENT.items.filter(item => /^(precision|tempo|bulwark)_/.test(item.id));
const sourceId = (item: ItemDef) => item.id.replace(/^(precision|tempo|bulwark)_/, "");

function loadout(classId: string, style: string) {
  const profile = newProfile(42, classId, classId === "mage" ? "monk" : "mage");
  setLevel(profile, 18); setMastery(profile, classId, 20);
  for (const item of added.filter(item => item.classId === classId && item.rarity === "legendary" && item.id.startsWith(`${style}_`))) {
    const copy = createInstance(profile, item.id, { isNew: true });
    expect(run(profile, { type: "equip", slot: item.slot, instanceId: copy.id }).ok).toBe(true);
  }
  const build = currentBuild(profile);
  return { profile, hero: resolveHeroStats(content, build, equippedInstances(profile, build)) };
}

describe("same-tier build choices", () => {
  it.each(classes)("gives %s three distinct stat choices in every Rare+ slot, without a dominant package", classId => {
    for (const rarity of ["rare", "epic", "legendary"]) for (const slot of SLOT_ORDER) {
      const choices = added.filter(item => item.classId === classId && item.rarity === rarity && item.slot === slot);
      expect(choices).toHaveLength(3);
      for (const choice of choices) {
        expect(canUseItem(choice, classId)).toBe(true);
        expect(canUseItem(choice, classId === "mage" ? "monk" : "mage")).toBe(false);
        expect(choice.minEncounterLevel).toBe(content.item(sourceId(choice)).minEncounterLevel);
        for (const other of choices.filter(item => item !== choice)) {
          // Each alternative must give up at least one stat to every other option.
          expect(Object.entries(other.stats).some(([key, value]) => value! > (choice.stats[key as keyof typeof choice.stats] ?? 0))).toBe(true);
        }
      }
    }
  });

  it("preserves existing effect parameters and IDs, with unique IDs for every new effect", () => {
    expect(added).toHaveLength(216);
    const ids: string[] = [];
    for (const item of added) {
      const source = content.item(sourceId(item));
      expect(item.icon).toBe(source.icon);
      expect(item.effect?.description).toBe(source.effect?.description);
      const withoutIds = (definition: ItemDef) => definition.effect?.mechanics.map(({ id: _id, ...parameters }) => parameters);
      expect(withoutIds(item)).toEqual(withoutIds(source));
      ids.push(...(item.effect?.mechanics.map(mechanic => mechanic.id) ?? []));
    }
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(CONTENT.items.map(item => item.id)).size).toBe(CONTENT.items.length);
  });

  it.each(classes)("resolves %s builds in core and makes Tempo attack more often in deterministic fights", classId => {
    const precision = loadout(classId, "precision").hero;
    const tempo = loadout(classId, "tempo").hero;
    const bulwark = loadout(classId, "bulwark").hero;
    expect(precision.attack100).toBeGreaterThan(tempo.attack100);
    expect(precision.critBp).toBeGreaterThan(tempo.critBp);
    expect(tempo.attackRateMilli).toBeGreaterThan(precision.attackRateMilli);
    expect(bulwark.maxHp100).toBeGreaterThan(precision.maxHp100);
    expect(bulwark.armor).toBeGreaterThan(precision.armor);
    const effects = combineRuleEffects(content, []);
    const enemies = buildEncounter(content, "ashen_mountains", 0, effects).enemies.slice(0, 1)
      .map(enemy => ({ ...enemy, maxHp100: 100_000_000, hitDamage100: 100 }));
    const counts = [precision, tempo, bulwark].map(hero => {
      const input = { seed: 42, hero, effects, enemies, startHp100: null, config: { ...CONTENT.config, maxFightMs: 20_000 } };
      const sink = new ArraySink();
      const summary = simulateFight(input, sink);
      const repeated = new ArraySink();
      expect(simulateFight(input, repeated)).toEqual(summary);
      expect(repeated.events).toEqual(sink.events);
      return sink.events.filter(event => event.type === "hit" && event.src === "hero" && event.via === "basic").length;
    });
    expect(counts[1]).toBeGreaterThan(counts[0]!);
    expect(counts[1]).toBeGreaterThan(counts[2]!);
  });

  it.each(classes)("drops every %s specialization through loot while enforcing encounter gates", classId => {
    for (const [rarity, level] of [["rare", 5], ["epic", 9], ["legendary", 13]] as const) {
      const testContent = new ContentIndex({ ...CONTENT, lootTables: [...CONTENT.lootTables, { id: "builds", dropChanceBp: 10_000, weights: { [rarity]: 1 }, maxRarity: rarity }] });
      const profile = newProfile(42, classId, classId === "mage" ? "monk" : "mage");
      const seen = new Set<string>();
      const fallback = rollLoot(profile, testContent, "builds", level - 1, 42, { source: "test" });
      if (fallback) expect(testContent.rarity(testContent.item(fallback.baseId).rarity).order).toBeLessThan(testContent.rarity(rarity).order);
      for (let seed = 0; seed < 512; seed++) {
        const drop = rollLoot(profile, testContent, "builds", level, seed, { source: "test" })!;
        expect(canUseItem(testContent.item(drop.baseId), classId)).toBe(true);
        seen.add(drop.baseId);
      }
      for (const item of added.filter(item => item.classId === classId && item.rarity === rarity)) expect(seen.has(item.id), item.id).toBe(true);
    }
  });

  it.each(classes)("forges all three %s weapon specializations through the existing recipe", classId => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 64; seed++) {
      const profile = newProfile(42, classId, classId === "mage" ? "monk" : "mage");
      profile.gold = 10_000;
      profile.forge = { version: 1, nextTransactionId: 1, devUnlocked: true };
      const material = CONTENT.items.find(item => item.classId === classId && item.slot === "weapon" && item.rarity === "uncommon")!;
      const instanceIds = Array.from({ length: 5 }, () => createInstance(profile, material.id, { isNew: true }).id);
      const result = fuse(profile, content, FORGE_V1, { configVersion: FORGE_V1.version, transactionId: 1,
        slot: "weapon", rarity: "uncommon", mode: "normal", instanceIds }, true, seed);
      if (!result.ok) throw new Error(result.error);
      seen.add(result.forge.outputBaseId);
    }
    for (const style of styles) expect([...seen].some(id => id.startsWith(`${style}_`))).toBe(true);
  });

  it("round-trips mixed gear, queued changes and locks without changing the save schema", () => {
    const { profile } = loadout("mage", "precision");
    const schema = profile.schema;
    const boots = added.find(item => item.classId === "mage" && item.slot === "boots" && item.rarity === "rare" && item.id.startsWith("tempo_"))!;
    const copy = createInstance(profile, boots.id, { isNew: true });
    setItemLock(profile, copy.id, true);
    profile.pending = { equipment: { boots: copy.id } };
    const parsed = parseSave(serializeSave(profile, 0));
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(parsed.profile).toEqual(profile);
    // The existing explicit player lock advances schema; gear itself does not.
    expect(schema).toBe(1);
    expect(parsed.profile.schema).toBe(3);
  });
});
