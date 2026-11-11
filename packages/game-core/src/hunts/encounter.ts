import type { FightRecord } from "@emberbound/shared-types";
import type { ContentIndex } from "../content";
import { buildWaveEnemies, type EncounterSetup } from "../encounter/budget";
import { mulDivRound } from "../math/fixed";
import type { RuleEffects } from "../rules/modifiers";

export function buildHuntEncounter(content: ContentIndex, record: FightRecord, effects: RuleEffects): EncounterSetup {
  const ref = record.hunt;
  const hunt = ref && content.hunts.get(ref.huntId);
  if (!hunt || !ref) throw new Error("Unknown Hunt");
  const source = [hunt.approach, hunt.detour, hunt.boss][ref.step];
  if (!source) throw new Error("Invalid Hunt step");
  const stage = { ...source, dpsBudget100: ref.step === 2 && ref.route === "weakness"
    ? mulDivRound(source.dpsBudget100, hunt.weakenedDamageBp, 10_000) : source.dpsBudget100 };
  const enemies = buildWaveEnemies(content, stage, effects);
  if (ref.step === 2 && enemies[0]) enemies[0].name = hunt.name;
  return { zone: content.zone(hunt.zoneId), stage, enemies };
}
