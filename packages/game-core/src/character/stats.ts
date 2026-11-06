import { SLOT_ORDER, type BuildSnapshot, type DamageType, type ItemInstance, type MechanicDef } from "@emberbound/shared-types";
import type { ContentIndex } from "../content";
import { BP, HP_SCALE, mulDivRound } from "../math/fixed";
import { masteryRank, resolveClassMechanics } from "./progression";

export interface HeroStats {
  classId: string;
  level: number;
  masteryRank: number;
  maxHp100: number;
  attack100: number;
  armor: number;
  attackRateMilli: number;
  critBp: number;
  damageType: DamageType;
  /** Class mechanics first (technique order), then item effects in slot order. */
  mechanics: MechanicDef[];
  /** Parallel to `mechanics`: where each mechanic comes from. */
  mechanicSources: ("class" | "item")[];
  /** Display-only totals (whole units). */
  display: { hp: number; attack: number; armor: number; attackRateMilli: number; critBp: number };
  activeEffects: { name: string; source: "class" | "item" }[];
}

/**
 * Resolve a build snapshot into combat stats. Deterministic and integer-only.
 * `instances` must contain every equipped instance id.
 */
export function resolveHeroStats(
  content: ContentIndex,
  build: BuildSnapshot,
  instances: ReadonlyMap<number, ItemInstance>,
): HeroStats {
  const cls = content.classDef(build.classId);
  if (!cls.implemented) throw new Error(`Class ${cls.id} is not implemented in this build`);
  const track = content.track(cls.masteryTrackId);
  const level = build.characterLevel;
  const rank = masteryRank(content, cls.id, build.masteryXp);
  const lv = level - 1;

  const baseAttack = cls.base.attack + cls.growth.attack * lv;
  // Mastery foundation in hundredths of attack (rules 0.3.0): every rank adds its share, so
  // no rank rounds to +0 (with whole units, a level-11 Monk gained nothing from M6 to M7).
  const foundation100 = mulDivRound(baseAttack * HP_SCALE, track.foundationAttackBpPerRank * (rank - 1), BP);
  let hp = cls.base.hp + cls.growth.hp * lv;
  let attack = baseAttack;
  let armor = cls.base.armor + cls.growth.armor * lv;
  let attackRateMilli = cls.base.attackRateMilli;
  let critBp = cls.base.critBp;

  const mechanics = resolveClassMechanics(content, cls.id, rank);
  const mechanicSources: ("class" | "item")[] = mechanics.map(() => "class");
  const activeEffects: HeroStats["activeEffects"] = track.techniques
    .filter((t) => t.unlockRank <= rank)
    .map((t) => ({ name: t.name, source: "class" as const }));

  for (const slot of SLOT_ORDER) {
    const instanceId = build.equipment[slot];
    if (instanceId === undefined) continue;
    const instance = instances.get(instanceId);
    if (!instance) throw new Error(`Equipped instance ${instanceId} missing from snapshot`);
    const item = content.item(instance.baseId);
    if (item.slot !== slot) throw new Error(`Item ${item.id} cannot be equipped in ${slot}`);
    hp += item.stats.hp ?? 0;
    attack += item.stats.attack ?? 0;
    armor += item.stats.armor ?? 0;
    attackRateMilli += item.stats.attackRateMilli ?? 0;
    critBp += item.stats.critBp ?? 0;
    if (item.effect) {
      for (const m of item.effect.mechanics) {
        mechanics.push({ ...m });
        mechanicSources.push("item");
      }
      activeEffects.push({ name: item.effect.name, source: "item" });
    }
  }

  claimStatusOwnership(mechanics);

  return {
    classId: cls.id,
    level,
    masteryRank: rank,
    maxHp100: hp * HP_SCALE,
    attack100: attack * HP_SCALE + foundation100,
    armor,
    attackRateMilli,
    critBp,
    damageType: cls.damageType,
    mechanics,
    mechanicSources,
    display: { hp, attack: attack + Math.round(foundation100 / HP_SCALE), armor, attackRateMilli, critBp },
    activeEffects,
  };
}

/**
 * One owner per hero status line (C2). Class mechanics come first, then items in slot order;
 * a later mechanic that names a status already owned by another mechanic gets its own line,
 * `${statusId}:${mechanicId}` (e.g. Bloodletter's Rend on a Warrior becomes `bleed:rend`).
 * Each line keeps its own stacks, parameters and damage attribution, so a class Bleed and an
 * item Bleed never overwrite each other. Content without such overlaps is unchanged.
 */
function claimStatusOwnership(mechanics: MechanicDef[]): void {
  const owner = new Map<string, string>();
  for (let i = 0; i < mechanics.length; i += 1) {
    const m = mechanics[i]!;
    if (m.kind !== "on_hit_dot" && m.kind !== "nth_hit_haste") continue;
    const current = owner.get(m.statusId);
    if (current === undefined) {
      owner.set(m.statusId, m.id);
    } else if (current !== m.id) {
      const statusId = `${m.statusId}:${m.id}`;
      mechanics[i] = { ...m, statusId };
      owner.set(statusId, m.id);
    }
  }
}
