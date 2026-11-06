import type { DamageType, StageDef, ZoneDef } from "@emberbound/shared-types";
import type { ContentIndex } from "../content";
import { BP, HP_SCALE, mulDivRound } from "../math/fixed";
import type { RuleEffects } from "../rules/modifiers";

export interface EnemyInit {
  id: string;
  index: number;
  archetypeId: string;
  name: string;
  maxHp100: number;
  /** Raw damage per hit, x100. */
  hitDamage100: number;
  attackRateMilli: number;
  armor: number;
  damageType: DamageType;
  sprite: string;
}

export interface EncounterSetup {
  zone: ZoneDef;
  stage: StageDef;
  enemies: EnemyInit[];
}

/**
 * Build an encounter from its stage budget. Members SHARE the stage HP and
 * damage budgets by archetype weight — three enemies are not three
 * full-strength copies. Count changes the combat problem (more attack
 * events, more value for multi-target effects), not the total budget.
 */
export function buildEncounter(
  content: ContentIndex,
  zoneId: string,
  stageIndex: number,
  effects: RuleEffects,
): EncounterSetup {
  const zone = content.zone(zoneId);
  const stage = zone.stages[stageIndex];
  if (!stage) throw new Error(`Zone ${zoneId} has no stage ${stageIndex}`);
  const archetypes = stage.enemies.map((id) => content.enemy(id));
  let hpWeights = 0;
  let damageWeights = 0;
  for (const a of archetypes) {
    hpWeights += a.hpWeight;
    damageWeights += a.damageWeight;
  }
  const hpBudget100 = mulDivRound(stage.hpBudget * HP_SCALE, effects.enemyHpBp, BP);
  const dpsBudget100 = mulDivRound(stage.dpsBudget100, effects.enemyDamageBp, BP);
  const enemies = archetypes.map((a, index): EnemyInit => {
    const maxHp100 = Math.max(HP_SCALE, mulDivRound(hpBudget100, a.hpWeight, hpWeights));
    const memberDps100 = mulDivRound(dpsBudget100, a.damageWeight, damageWeights);
    return {
      id: `e${index}`,
      index,
      archetypeId: a.id,
      name: a.name,
      maxHp100,
      hitDamage100: Math.max(1, mulDivRound(memberDps100, 1000, a.attackRateMilli)),
      attackRateMilli: a.attackRateMilli,
      armor: a.armor,
      damageType: a.damageType,
      sprite: a.sprite,
    };
  });
  return { zone, stage, enemies };
}
