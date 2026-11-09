import type { ContentIndex } from "../content";
import { resolveHeroStats } from "../character/stats";
import { ArraySink, simulateFight } from "../combat/engine";
import { buildEncounter } from "../encounter/budget";
import { BP, mulDivRound } from "../math/fixed";
import { deriveSeed } from "../math/prng";

export const FIELD_TRIAL_LEVEL = 5;
export const FIELD_TRIAL_MASTERY = 5;
export const FIELD_TRIAL_ZONE = "greenfields";
export const FIELD_TRIAL_ROTATION_MS = 12 * 60 * 60 * 1000;

export const FIELD_TRIALS = [
  { id: "slime-surge", name: "Slime Surge", stageIndex: 1, hpBp: 18_000, damageBp: 22_000, timeMs: 13_000, healthBp: 4_500 },
  { id: "roadside-ambush", name: "Roadside Ambush", stageIndex: 3, hpBp: 20_000, damageBp: 18_000, timeMs: 15_000, healthBp: 4_500 },
  { id: "thornback-duel", name: "Thornback Duel", stageIndex: 4, hpBp: 10_000, damageBp: 17_000, timeMs: 16_000, healthBp: 2_700 },
  { id: "wolfpack", name: "Wolfpack", stageIndex: 6, hpBp: 24_000, damageBp: 19_000, timeMs: 15_000, healthBp: 3_200 },
  { id: "boar-charge", name: "Boar Charge", stageIndex: 7, hpBp: 17_000, damageBp: 17_000, timeMs: 15_000, healthBp: 3_800 },
  { id: "elder-root", name: "Elder Root", stageIndex: 9, hpBp: 6_000, damageBp: 14_500, timeMs: 24_000, healthBp: 1_500 },
] as const;

export const FIELD_TACTICS = [
  { id: "assault", name: "Assault", description: "+45% Attack, −30% max HP" },
  { id: "guard", name: "Guard", description: "+50% max HP, +12 Armor, −20% Attack" },
  { id: "sweep", name: "Sweep", description: "Every attack splashes 70% damage to other enemies" },
] as const;

export type FieldTrial = (typeof FIELD_TRIALS)[number];
export type FieldTactic = (typeof FIELD_TACTICS)[number]["id"];

export function featuredFieldTrial(atMs: number): FieldTrial {
  const rotation = Math.floor(Math.max(0, atMs) / FIELD_TRIAL_ROTATION_MS);
  return FIELD_TRIALS[rotation % FIELD_TRIALS.length]!;
}

/** Practice with fixed stats and a fixed seed. Adventure and the owned build are outside this simulation. */
export function runFieldTrial(content: ContentIndex, trial: FieldTrial, classId: string, tactic: FieldTactic) {
  const track = content.classDef(classId).masteryTrackId;
  const masteryXp = content.masteryTotals(track)[FIELD_TRIAL_MASTERY - 1] ?? 0;
  const hero = resolveHeroStats(content, {
    classId, characterLevel: FIELD_TRIAL_LEVEL, masteryXp, equipment: {}, artifactId: null,
  }, new Map());
  switch (tactic) {
    case "assault":
      hero.attack100 = mulDivRound(hero.attack100, 14_500, BP);
      hero.maxHp100 = mulDivRound(hero.maxHp100, 7_000, BP);
      break;
    case "guard":
      hero.maxHp100 = mulDivRound(hero.maxHp100, 15_000, BP);
      hero.armor += 12;
      hero.attack100 = mulDivRound(hero.attack100, 8_000, BP);
      break;
    case "sweep":
      hero.mechanics.push({
        id: "field-sweep", kind: "nth_attack_split", every: 1, potencyBp: 7_000, targets: 2,
        damageType: hero.damageType, appliesDots: 0,
      });
      hero.mechanicSources.push("item");
      break;
  }

  const effects = { enemyHpBp: trial.hpBp, enemyDamageBp: trial.damageBp, dotDamageBp: BP };
  const setup = buildEncounter(content, FIELD_TRIAL_ZONE, trial.stageIndex, effects);
  const sink = new ArraySink();
  const summary = simulateFight({
    seed: deriveSeed(1, `field-trial/${trial.id}`),
    hero,
    startHp100: null,
    enemies: setup.enemies,
    effects,
    config: content.snapshot.config,
  }, sink);
  const cleared = summary.outcome === "victory";
  const timeGoal = cleared && summary.durationMs <= trial.timeMs;
  const healthGoal = cleared && summary.hero.hp100 * BP >= summary.hero.maxHp100 * trial.healthBp;
  return { hero, setup, summary, events: sink.events, goals: { cleared, timeGoal, healthGoal } };
}
