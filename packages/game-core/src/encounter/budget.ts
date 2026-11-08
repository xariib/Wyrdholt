import type { BossFightRecord, DamageType, EnemyArchetypeDef, SoloBossDef, StageDef, ZoneDef } from "@emberbound/shared-types";
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

export interface BossEncounterSetup {
  boss: SoloBossDef;
  tier: number;
  enemies: [EnemyInit];
}

function enemyInit(
  archetype: Omit<EnemyArchetypeDef, "hpWeight" | "damageWeight">,
  index: number,
  hp100: number,
  dps100: number,
): EnemyInit {
  return {
    id: `e${index}`,
    index,
    archetypeId: archetype.id,
    name: archetype.name,
    maxHp100: Math.max(HP_SCALE, hp100),
    hitDamage100: Math.max(1, mulDivRound(dps100, 1000, archetype.attackRateMilli)),
    attackRateMilli: archetype.attackRateMilli,
    armor: archetype.armor,
    damageType: archetype.damageType,
    sprite: archetype.sprite,
  };
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
  const enemies = archetypes.map((a, index) => {
    const hp100 = mulDivRound(hpBudget100, a.hpWeight, hpWeights);
    const dps100 = mulDivRound(dpsBudget100, a.damageWeight, damageWeights);
    return enemyInit(a, index, hp100, dps100);
  });
  return { zone, stage, enemies };
}

export function buildBossEncounter(
  content: ContentIndex,
  { bossId, tier }: BossFightRecord["encounter"],
  effects: RuleEffects,
): BossEncounterSetup {
  const { boss, budget } = content.soloBossTier(bossId, tier);
  const hp100 = mulDivRound(budget.hpBudget * HP_SCALE, effects.enemyHpBp, BP);
  const dps100 = mulDivRound(budget.dpsBudget100, effects.enemyDamageBp, BP);
  return { boss, tier, enemies: [enemyInit(boss, 0, hp100, dps100)] };
}
