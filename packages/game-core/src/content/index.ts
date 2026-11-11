import type {
  ClassDef,
  ContentSnapshot,
  DungeonDef,
  EnemyArchetypeDef,
  HuntDef,
  ItemDef,
  LootTableDef,
  MasteryTrackDef,
  ProgressionDef,
  RaidDef,
  PromotionDef,
  RarityDef,
  RuleDef,
  SeasonDef,
  SoloBossDef,
  SoloBossTierDef,
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
  /** Adventure hash, retained in existing records. */
  readonly hash: string;
  /** Solo Boss replays pin both boss data and the shared combat content. */
  readonly bossHash: string;
  readonly promotionHash: string;
  readonly longTermHash: string;
  readonly socialHash: string;
  readonly huntHash: string;
  readonly authorityHash: string;
  readonly hunts = new Map<string, HuntDef>();
  readonly promotions = new Map<string, PromotionDef>();
  readonly seasons = new Map<string, SeasonDef>();
  readonly seasonHashes = new Map<string, string>();
  readonly dungeons = new Map<string, DungeonDef>();
  readonly raids = new Map<string, RaidDef>();
  readonly classes = new Map<string, ClassDef>();
  readonly tracks = new Map<string, MasteryTrackDef>();
  readonly items = new Map<string, ItemDef>();
  readonly enemies = new Map<string, EnemyArchetypeDef>();
  readonly zones = new Map<string, ZoneDef>();
  readonly lootTables = new Map<string, LootTableDef>();
  readonly rules = new Map<string, RuleDef>();
  readonly rarities = new Map<string, RarityDef>();
  readonly soloBosses = new Map<string, SoloBossDef>();
  readonly raritiesByOrder: RarityDef[];
  /** levelTotals[L-1] = total XP needed to reach level L. */
  readonly levelTotals: number[];
  private readonly masteryTotalsCache = new Map<string, number[]>();

  constructor(snapshot: ContentSnapshot) {
    this.snapshot = snapshot;
    // canonicalJson also enforces "integers only" across all content.
    const { soloBosses = [], longTerm, social, hunts, ...adventure } = snapshot;
    this.hash = sha256Hex(canonicalJson(adventure));
    this.bossHash = sha256Hex(canonicalJson({ adventureHash: this.hash, soloBosses }));
    this.promotionHash = sha256Hex(canonicalJson({ bossHash: this.bossHash, promotions: longTerm?.promotions ?? [] }));
    this.longTermHash = sha256Hex(canonicalJson({ bossHash: this.bossHash, longTerm: longTerm ?? null }));
    this.socialHash = sha256Hex(canonicalJson({ promotionHash: this.promotionHash, social: social ?? null }));
    this.huntHash = sha256Hex(canonicalJson({ promotionHash: this.promotionHash, hunts: hunts ?? null }));
    this.authorityHash = hunts ? sha256Hex(canonicalJson({ longTermHash: this.longTermHash, huntHash: this.huntHash })) : this.longTermHash;
    for (const hunt of hunts?.definitions ?? []) addUnique(this.hunts, hunt.id, hunt, "hunt");
    for (const c of snapshot.classes) addUnique(this.classes, c.id, c, "class");
    for (const t of snapshot.masteryTracks) addUnique(this.tracks, t.id, t, "mastery track");
    for (const i of snapshot.items) addUnique(this.items, i.id, i, "item");
    for (const e of snapshot.enemies) addUnique(this.enemies, e.id, e, "enemy");
    for (const b of soloBosses) addUnique(this.soloBosses, b.id, b, "solo boss");
    for (const z of snapshot.zones) addUnique(this.zones, z.id, z, "zone");
    for (const l of snapshot.lootTables) addUnique(this.lootTables, l.id, l, "loot table");
    for (const r of snapshot.rules) addUnique(this.rules, r.id, r, "rule");
    for (const p of longTerm?.promotions ?? []) {
      addUnique(this.promotions, p.classId, p, "promotion");
      addUnique(this.soloBosses, p.boss.id, p.boss, "solo boss");
    }
    for (const s of longTerm?.seasons ?? []) {
      addUnique(this.seasons, s.boss.id, s, "season");
      this.seasonHashes.set(s.boss.id, sha256Hex(canonicalJson({ promotionHash: this.promotionHash, season: s })));
      addUnique(this.soloBosses, s.boss.id, s.boss, "solo boss");
      addUnique(this.rules, s.rule.id, s.rule, "rule");
    }
    for (const dungeon of social?.dungeons ?? []) addUnique(this.dungeons, dungeon.id, dungeon, "dungeon");
    for (const raid of social?.raids ?? []) addUnique(this.raids, raid.id, raid, "raid");
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
  soloBossTier(id: string, tier: number): { boss: SoloBossDef; budget: SoloBossTierDef } {
    const boss = must(this.soloBosses.get(id), `solo boss ${id}`);
    const budget = Number.isSafeInteger(tier) && tier > 0 ? boss.tiers[tier - 1] : undefined;
    return { boss, budget: must(budget, `tier ${tier} for solo boss ${id}`) };
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
    const hunts = this.snapshot.hunts;
    if (hunts && (!Number.isSafeInteger(hunts.intervalMs) || hunts.intervalMs < 1
      || !Number.isSafeInteger(hunts.capacity) || hunts.capacity < 1 || hunts.capacity > 3 || !hunts.definitions.length)) throw new Error("Invalid Hunt cadence");
    for (const hunt of this.hunts.values()) {
      const zone = this.zone(hunt.zoneId);
      if (!zone.implemented || zone.hidden || hunt.weakenedDamageBp <= 0 || hunt.weakenedDamageBp > 10_000) throw new Error("Invalid Hunt");
      for (const [index, stage] of [hunt.approach, hunt.detour, hunt.boss].entries()) {
        if (stage.index !== index || stage.hpBudget <= 0 || stage.dpsBudget100 <= 0 || stage.level < 1
          || !stage.enemies.length || stage.enemies.length > 3) throw new Error("Invalid Hunt encounter");
        for (const enemy of stage.enemies) this.enemy(enemy);
      }
    }
    for (const dungeon of this.dungeons.values()) {
      if (!this.zone(dungeon.unlockZoneId).implemented || !dungeon.waves.length || dungeon.rewardGold < 1 || dungeon.guildMarks < 0) {
        throw new Error(`Invalid dungeon ${dungeon.id}`);
      }
    }
    for (const raid of this.raids.values()) {
      if (!raid.phases.length || raid.durationMs <= 0 || raid.rewardGold < 1
        || raid.phases.some(p => p.damageGoal100 <= 0 || p.addGoal <= 0 || p.enemies.length < 2)) throw new Error(`Invalid raid ${raid.id}`);
    }
    for (const wave of [...this.dungeons.values()].flatMap(d => d.waves).concat([...this.raids.values()].flatMap(r => r.phases))) {
      if (!wave.enemies.length || wave.enemies.length > 3 || wave.hpBudget <= 0 || wave.dpsBudget100 <= 0) throw new Error("Invalid party encounter");
      for (const enemy of wave.enemies) this.enemy(enemy);
      for (const rule of wave.ruleIds ?? []) must(this.rules.get(rule), `rule ${rule}`);
    }
    for (const p of this.promotions.values()) {
      const cls = this.classDef(p.classId);
      if (p.boss.id !== `trial_${p.classId}` || p.boss.tiers.length !== 1 || !cls.implemented || cls.tier !== 1
        || p.level < 1 || p.level > this.levelTotals.length || p.mastery !== this.track(cls.masteryTrackId).maxRank
        || p.attackBp < 1 || p.attackBp > 10_000) throw new Error(`Invalid promotion ${p.classId}`);
    }
    let previousEnd = 0;
    for (const s of [...this.seasons.values()].sort((a, b) => a.startMs - b.startMs)) {
      if (!s.boss.id.startsWith("season_") || s.startMs < previousEnd || s.tierIntervalMs <= 0
        || s.startMs + s.tierIntervalMs * (s.boss.tiers.length - 1) >= s.endMs
        || s.titles.length !== s.boss.tiers.length || s.relicAttackBp.length !== s.boss.tiers.length
        || s.relicAttackBp.some(bp => bp < 1 || bp > 10_000) || s.rule.availability || s.rule.testOnly) {
        throw new Error(`Invalid season ${s.boss.id}`);
      }
      previousEnd = s.endMs;
    }
    for (const boss of this.soloBosses.values()) {
      if (!this.zone(boss.unlockZoneId).implemented || boss.tiers.length === 0 || boss.attackRateMilli <= 0 || boss.armor < 0
        || boss.tiers.some(tier => tier.hpBudget <= 0 || tier.dpsBudget100 <= 0)) {
        throw new Error(`Invalid solo boss ${boss.id}`);
      }
    }
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
    for (const i of this.snapshot.items) {
      this.rarity(i.rarity);
      if (i.classId !== undefined) this.classDef(i.classId);
    }
    for (const s of this.snapshot.starterItems) {
      const item = this.item(s);
      if (this.snapshot.starterWeapons && (item.slot === "weapon" || item.classId !== undefined)) {
        throw new Error(`Invalid shared starter item ${item.id}`);
      }
    }
    if (this.snapshot.starterWeapons) {
      for (const cls of this.classes.values()) {
        if (!cls.implemented || cls.tier !== 1) continue;
        const starter = this.item(this.snapshot.starterWeapons[cls.id] ?? "");
        if (starter.slot !== "weapon" || starter.classId !== cls.id) throw new Error(`Invalid starter weapon for ${cls.id}`);
      }
    }
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
