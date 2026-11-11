import { describe, expect, it } from "vitest";
import { CONTENT, FORGE_V1 } from "@emberbound/game-content";
import {
  ArraySink, ContentIndex, NULL_SINK, RULES_VERSION, buildEncounter, cloneProfile,
  combineRuleEffects, createInstance, createProfile, currentBuild, encodeProfile, equippedInstances,
  fuse, goldenMatches, parseSave, prepareFight, replayFight, resolveHeroStats,
  runSelfTest, serializeSave, simulateFight, simulateOffline, startRun,
  type FightInput, type GoldenFile,
} from "@emberbound/game-core";
import type { ContentSnapshot } from "@emberbound/shared-types";
import C2_CONTENT from "./fixtures/c2-content.json";
import C2_GOLDEN from "./fixtures/c2-golden.json";
import { content, newProfile, setLevel, setMastery } from "./helpers";

const added = CONTENT.items.filter(item => item.effect && C2_CONTENT.items.some(old => old.id === item.id && !old.effect));
const classes = ["monk", "mage", "warrior", "ranger"];
function equipped(cls: string, ids: string[]) {
  const p = newProfile(6006, cls, cls === "monk" ? "mage" : "monk");
  setLevel(p, 18); setMastery(p, cls, 20);
  for (const id of ids) { const i = createInstance(p, id, { isNew: true }); p.equipment[content.item(id).slot] = i.id; }
  return p;
}
function fight(cls: string, ids: string[], seed = 42): FightInput {
  const p = equipped(cls, ids), build = currentBuild(p);
  const hero = resolveHeroStats(content, build, equippedInstances(p, build));
  const effects = combineRuleEffects(content, []);
  // Long controlled fight with real damage: healing/retaliation/wards can trigger.
  const enemies = buildEncounter(content, "ashen_mountains", 9, effects).enemies
    .map(e => ({ ...e, maxHp100: 4_000_000, hitDamage100: 2_500 }));
  return { seed, hero, effects, enemies, startHp100: Math.floor(hero.maxHp100 * 0.7), config: content.snapshot.config };
}
function recorded(input: FightInput) { const sink = new ArraySink(); return { summary: simulateFight(input, sink), events: sink.events }; }

describe("C3 item effects", () => {
  it("adds exactly ten effects while preserving stats, previous effects and all other tuning", () => {
    expect(added).toHaveLength(10);
    expect(CONTENT.items.filter(i => ["epic", "legendary"].includes(i.rarity)).every(i => i.effect?.mechanics.length)).toBe(true);
    const { contentVersion: _old, items: oldItems, ...oldRest } = C2_CONTENT;
    const { contentVersion: _new, items: newItems, soloBosses: _c4, longTerm: _c5, social: _coop, starterWeapons, ...newRest } = CONTENT;
    expect([starterWeapons?.warrior, ...newRest.starterItems]).toEqual(oldRest.starterItems);
    expect({ ...newRest, starterItems: oldRest.starterItems }).toEqual(oldRest);
    for (const old of oldItems) {
      const { classId: _class, ...item } = newItems.find(i => i.id === old.id)!;
      expect({ ...item, effect: old.effect, tags: old.tags }).toEqual({ ...old, effect: old.effect });
      if (old.effect) expect(item.effect).toEqual(old.effect);
    }
    expect(RULES_VERSION).toBe("emberbound-rules/0.3.0");
  });

  it.each(classes)("triggers each active effect on %s with real health damage", cls => {
    for (const item of added.filter(i => i.effect!.mechanics[0]!.kind !== "execute")) {
      const input = fight(cls, [item.id]);
      const { summary, events } = recorded(input);
      const id = item.effect!.mechanics[0]!.id;
      expect(summary.counters.procs[id], `${cls} ${item.id}`).toBeGreaterThan(0);
      const kind = item.effect!.mechanics[0]!.kind;
      if (kind === "ward") expect(events.some(e => e.type === "ward" && e.via === id && Number(e.amt) > 0)).toBe(true);
      if (kind === "nth_hit_heal") expect(events.some(e => e.type === "heal" && e.via === id && Number(e.amt) > 0)).toBe(true);
      if (kind === "nth_hit_haste") expect(events.some(e => e.type === "status" && e.status === "ghost_step")).toBe(true);
      const silent = simulateFight(input, NULL_SINK);
      expect({ ...silent, eventCount: 0 }).toEqual({ ...summary, eventCount: 0 });
      expect(recorded(input)).toEqual({ summary, events });
    }
  });

  it("Ember Oath changes direct hits only at its health threshold", () => {
    const input = fight("monk", ["oath_of_embers"]);
    input.hero.mechanics = input.hero.mechanics.filter(m => m.id === "ember_oath");
    input.hero.mechanicSources = ["item"];
    input.hero.critBp = 0;
    input.enemies = input.enemies.slice(0, 1).map(e => ({ ...e, maxHp100: 50_000, hitDamage100: 100 }));
    const { events } = recorded(input);
    const basic = events.filter(e => e.type === "hit" && e.src === "hero" && e.via === "basic");
    expect(basic.some(e => Number(e.hp) + Number(e.eff) <= 12_500)).toBe(true);
    // Same seed and zero variance isolates the modifier from randomness/crit.
    input.config = { ...input.config, damageVarianceBp: 0 };
    const hits = recorded(input).events.filter(e => e.type === "hit" && e.src === "hero" && e.via === "basic");
    const high = hits.find(e => Number(e.hp) + Number(e.eff) > 12_500)!;
    const low = hits.find(e => Number(e.hp) + Number(e.eff) <= 12_500)!;
    expect(Number(low.amt)).toBeGreaterThan(Number(high.amt));
  });

  it("keeps Ranger, Venomstring and Venom Grips poison separate, including class burst", () => {
    const input = fight("ranger", ["venomstring", "venom_grips"]);
    const dots = input.hero.mechanics.filter(m => m.kind === "on_hit_dot");
    expect(dots.map(m => m.statusId)).toEqual(["poison", "poison:venom_thread", "poison:poison_touch"]);
    const { events, summary } = recorded(input);
    for (const d of dots) expect(events.some(e => e.type === "tick" && e.status === d.statusId)).toBe(true);
    expect(summary.counters.procs.venom_burst).toBeGreaterThan(0);
  });

  it("Mage and item wards share the existing cap, reset per fight and respect carried HP", () => {
    const input = fight("mage", ["last_light_vest"]);
    const a = recorded(input), b = recorded(input);
    const start = a.events.find(e => e.type === "ward" && e.via === "start")!;
    expect(start.amt).toBe(Math.floor(input.hero.maxHp100 / 20));
    expect(start.cap).toBe(Math.floor(input.hero.maxHp100 / 5));
    expect(a.events.filter(e => e.type === "ward").every(e => Number(e.ward) <= Number(e.cap))).toBe(true);
    expect(a.summary.counters.absorbed100).toBeGreaterThan(0);
    expect(a.events.find(e => e.type === "spawn" && e.actor === "hero")?.hp).toBe(input.startHp100);
    expect(b).toEqual(a);
  });

  it("inactive owned gear adds no mechanics; queued changes do not change the active fight", () => {
    const p = equipped("ranger", []);
    const old = resolveHeroStats(content, currentBuild(p), equippedInstances(p, currentBuild(p)));
    const i = createInstance(p, "venomstring", { isNew: true });
    p.pending = { equipment: { weapon: i.id } };
    expect(resolveHeroStats(content, currentBuild(p), equippedInstances(p, currentBuild(p)))).toEqual(old);
  });

  it.each([1, 2])("loads an old content schema %i save with owned/queued/Forge identity intact", schema => {
    const old = new ContentIndex(C2_CONTENT as ContentSnapshot);
    const p = createProfile(old, { name: "Kept", activeClassId: "ranger", alternateClassId: "mage", masterSeed: 6006, nowWallMs: 0 });
    for (const id of ["venomstring", "last_light_vest"]) { const i = createInstance(p, id, { isNew: true }); p.equipment[old.item(id).slot] = i.id; }
    const queue = createInstance(p, "ghostwalk", { isNew: true }); p.pending = { equipment: { boots: queue.id } };
    if (schema === 2) {
      p.gold = 500; p.adventure.zones.greenfields!.cleared = true;
      const ids = Array.from({ length: 5 }, () => createInstance(p, "wayfarer_blade", { isNew: true }).id);
      expect(fuse(p, old, FORGE_V1, { slot: "weapon", rarity: "common", instanceIds: ids, transactionId: 1, configVersion: FORGE_V1.version, mode: "configured" }).ok).toBe(true);
    }
    const raw = serializeSave(p, 0); expect(JSON.parse(raw).schema).toBe(schema);
    const read = parseSave(raw); expect(read.ok).toBe(true); if (!read.ok) return;
    expect(encodeProfile(read.profile)).toEqual(encodeProfile(p));
    const build = currentBuild(read.profile);
    const hero = resolveHeroStats(content, build, equippedInstances(read.profile, build));
    expect(hero.mechanics.some(m => m.id === "venom_thread")).toBe(true);
    expect(hero.mechanics.some(m => m.id === "last_light")).toBe(true);
    expect(hero.mechanics.some(m => m.id === "ghost_step")).toBe(false);
    expect(serializeSave(read.profile, 0)).toBe(raw);
  });

  it("offline chunking and replay use the same full Legendary build", () => {
    const p = equipped("mage", CONTENT.items.filter(i => i.rarity === "legendary" && (!i.classId || i.classId === "mage")).map(i => i.id));
    startRun(p, content, "greenfields", "farm", 0);
    const live = prepareFight(p, content, p.adventure.run!, { contentTimeMs: 0, recordEvents: true });
    expect(replayFight(content, live.record).summary).toEqual(live.summary);
    const a = cloneProfile(p), b = cloneProfile(p);
    simulateOffline(a, content, 60_000, 0);
    simulateOffline(b, content, 17_000, 0); simulateOffline(b, content, 43_000, 0);
    // The telemetry counts settlement calls; authoritative gameplay is identical.
    expect(b.stats.offlineSettlements).toBe(a.stats.offlineSettlements + 1);
    b.stats.offlineSettlements = a.stats.offlineSettlements;
    expect(b).toEqual(a);
  });

  it("retains all 18 frozen C2 goldens on their original content and rejects mismatched replays", () => {
    const old = new ContentIndex(C2_CONTENT as ContentSnapshot), golden = C2_GOLDEN as GoldenFile;
    expect(goldenMatches(golden, old, RULES_VERSION)).toBeNull();
    const results = runSelfTest(old, golden, () => 0, Object.keys(golden.cases));
    expect(results).toHaveLength(18); expect(results.every(r => r.pass)).toBe(true);
    const p = createProfile(old, { name: "Old", activeClassId: "monk", alternateClassId: "mage", masterSeed: 1, nowWallMs: 0 });
    startRun(p, old, "greenfields", "push", 0);
    const record = prepareFight(p, old, p.adventure.run!, { contentTimeMs: 0, recordEvents: false }).record;
    expect(() => replayFight(content, record)).toThrow(/Content mismatch/);
    expect(() => replayFight(old, record)).not.toThrow();
  });
});
