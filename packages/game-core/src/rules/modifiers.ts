import type { RuleDef, StageDef, TimeWindow, ZoneDef } from "@emberbound/shared-types";
import { BP, mulDivRound } from "../math/fixed";
import type { ContentIndex } from "../content";

/** True when `atMs` is inside the window. Missing window = always available. */
export function isWindowOpen(timeWindow: TimeWindow | undefined, atMs: number): boolean {
  if (!timeWindow) return true;
  if (timeWindow.startMs !== null && atMs < timeWindow.startMs) return false;
  if (timeWindow.endMs !== null && atMs >= timeWindow.endMs) return false;
  return true;
}

/**
 * Resolve which rules are active for an encounter at a given time.
 * The resolved list becomes part of the fight's content snapshot, so a replay
 * never needs to know the wall-clock time.
 */
export function resolveActiveRuleIds(
  content: ContentIndex,
  zone: ZoneDef,
  stage: StageDef,
  atMs: number,
  extraRuleIds: readonly string[] = [],
): string[] {
  const ids = [...(zone.ruleIds ?? []), ...(stage.ruleIds ?? []), ...extraRuleIds];
  const out: string[] = [];
  for (const id of ids) {
    const rule = content.rules.get(id);
    if (!rule) throw new Error(`Unknown rule ${id}`);
    if (isWindowOpen(rule.availability, atMs) && !out.includes(id)) out.push(id);
  }
  return out;
}

export interface RuleEffects {
  enemyHpBp: number;
  enemyDamageBp: number;
  dotDamageBp: number;
}

/** Multiplicative combination of active rules, in list order. */
export function combineRuleEffects(content: ContentIndex, ruleIds: readonly string[]): RuleEffects {
  const effects: RuleEffects = { enemyHpBp: BP, enemyDamageBp: BP, dotDamageBp: BP };
  for (const id of ruleIds) {
    const rule: RuleDef | undefined = content.rules.get(id);
    if (!rule) throw new Error(`Unknown rule ${id}`);
    switch (rule.kind) {
      case "enemy_hp_bp":
        effects.enemyHpBp = mulDivRound(effects.enemyHpBp, rule.valueBp, BP);
        break;
      case "enemy_damage_bp":
        effects.enemyDamageBp = mulDivRound(effects.enemyDamageBp, rule.valueBp, BP);
        break;
      case "dot_damage_bp":
        effects.dotDamageBp = mulDivRound(effects.dotDamageBp, rule.valueBp, BP);
        break;
    }
  }
  return effects;
}
