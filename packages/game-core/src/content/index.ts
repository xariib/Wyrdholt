import type {
  ClassDef,
  ContentSnapshot,
  EnemyArchetypeDef,
  ItemDef,
  LootTableDef,
  MasteryTrackDef,
  ProgressionDef,
  RarityDef,
  RuleDef,
  ZoneDef,
} from "@emberbound/shared-types";
import { validateKits } from "./kits";
import { canonicalJson } from "../hash/canonical";
import { sha256Hex } from "../hash/sha256";
import { geometricCurveTotals, stepTotals } from "../math/fixed";

/**
 * Indexed, validated view of a content snapshot. Built once per content version.
 * game-core never imports game-content directly: content is always injected,
 * so a server can validate with a pinned content version.
 */
export class ContentIndex {
  readonly snapshot: ContentSnapshot;
  readonly hash: string;
  readonly classes = new Map<string, ClassDef>();
  readonly tracks = new Map<string, MasteryTrackDef>();
  readonly items = new Map<string, ItemDef>();
  readonly enemies = new Map<string, EnemyArchetypeDef>();
  readonly zones = new Map<string, ZoneDef>();
  readonly lootTables = new Map<string, LootTableDef>();
  readonly rules = new Map<string, RuleDef>();
  readonly rarities = new Map<string, RarityDef>();
  readonly raritiesByOrder: RarityDef[];
  /** levelTotals[L-1] = total XP needed to reach level L. */
  readonly levelTotals: number[];
  private readonly masteryTotalsCache = new Map<string, number[]>();

  constructor(snapshot: ContentSnapshot) {
    this.snapshot = snapshot;
    // canonicalJson also enforces "integers only" across all content.
    this.hash = sha256Hex(canonicalJson(snapshot));
    for (const c of snapshot.classes) addUnique(this.classes, c.id, c, "class");
    for (const t of snapshot.masteryTracks) addUnique(this.tracks, t.id, t, "mastery track");
    for (const i of snapshot.items) addUnique(this.items, i.id, i, "item");
    for (const e of snapshot.enemies) addUnique(this.enemies, e.id, e, "enemy");
    for (const z of snapshot.zones) addUnique(this.zones, z.id, z, "zone");
    for (const l of snapshot.lootTables) addUnique(this.lootTables, l.id, l, "loot table");
    for (const r of snapshot.rules) addUnique(this.rules, r.id, r, "rule");
    for (const r of snapshot.rarities) addUnique(this.rarities, r.id, r, "rarity");
    this.raritiesByOrder = [...snapshot.rarities].sort((a, b) => a.order - b.order);
    this.levelTotals = progressionTotals(snapshot.config.levelXp, snapshot.config.maxCharacterLevel, "character level");
    this.validate();
  }

  classDef(id: string): ClassDef {
    return must(this.classes.get(id), `class ${id}`);
  }
  track(id: string): MasteryTrackDef {
    return must(this.tracks.get(id), `mastery track ${id}`);
  }
  item(id: string): ItemDef {
    return must(this.items.get(id), `item ${id}`);
  }
  enemy(id: string): EnemyArchetypeDef {
    return must(this.enemies.get(id), `enemy ${id}`);
  }
  zone(id: string): ZoneDef {
    return must(this.zones.get(id), `zone ${id}`);
  }
  lootTable(id: string): LootTableDef {
    return must(this.lootTables.get(id), `loot table ${id}`);
  }
  rarity(id: string): RarityDef {
    return must(this.rarities.get(id), `rarity ${id}`);
  }

  /** masteryTotals[rank-1] = total mastery XP required for that rank. */
  masteryTotals(trackId: string): number[] {
    let totals = this.masteryTotalsCache.get(trackId);
    if (!totals) {
      const track = this.track(trackId);
      totals = progressionTotals(track.xp, track.maxRank, `mastery track ${trackId}`);
      this.masteryTotalsCache.set(trackId, totals);
    }
    return totals;
  }

  private validate(): void {
    for (const c of this.snapshot.classes) {
      this.track(c.masteryTrackId);
      if (c.parentClassId !== null) this.classDef(c.parentClassId);
    }
    for (const z of this.snapshot.zones) {
      this.lootTable(z.lootTableId);
      this.lootTable(z.bossLootTableId);
      if (z.cacheLootTableId !== undefined) this.lootTable(z.cacheLootTableId);
      for (const u of z.unlocks) this.zone(u);
      z.stages.forEach((s, i) => {
        if (s.index !== i) throw new Error(`zone ${z.id}: stage index mismatch at ${i}`);
        if (s.enemies.length < 1 || s.enemies.length > 3) {
          throw new Error(`zone ${z.id} stage ${i}: 1-3 enemies required`);
        }
        for (const e of s.enemies) this.enemy(e);
        for (const r of s.ruleIds ?? []) must(this.rules.get(r), `rule ${r}`);
      });
    }
    for (const i of this.snapshot.items) this.rarity(i.rarity);
    for (const s of this.snapshot.starterItems) this.item(s);
    for (const l of this.snapshot.lootTables) {
      this.rarity(l.maxRarity);
      for (const r of Object.keys(l.weights)) this.rarity(r);
    }
    validateKits(this);
  }
}

/** totals[i] = XP needed to reach level/rank i + 1 (totals[0] = 0). */
function progressionTotals(def: ProgressionDef, max: number, label: string): number[] {
  if (def.steps !== undefined) {
    if (def.steps.length !== max - 1) {
      throw new Error(`${label}: ${def.steps.length} XP steps for max ${max} (need ${max - 1})`);
    }
    return stepTotals(def.steps);
  }
  return geometricCurveTotals(def.curve.firstStep, def.curve.growthBp, max - 1);
}

function addUnique<T>(map: Map<string, T>, id: string, value: T, label: string): void {
  if (map.has(id)) throw new Error(`Duplicate ${label} id: ${id}`);
  map.set(id, value);
}

function must<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Unknown ${label}`);
  return value;
}
