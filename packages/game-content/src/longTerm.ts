import type { PromotionDef, SeasonDef, SoloBossDef } from "@emberbound/shared-types";

const WEEK = 7 * 24 * 60 * 60 * 1_000;

function challenge(id: string, name: string, tiers: SoloBossDef["tiers"]): SoloBossDef {
  return { id, name, unlockZoneId: "ashen_mountains", tiers, attackRateMilli: 800, armor: 14, damageType: "physical", sprite: "warlord" };
}

const paths = [
  { classId: "warrior", name: "Vanguard" },
  { classId: "monk", name: "Ascendant" },
  { classId: "mage", name: "Arcanist" },
  { classId: "ranger", name: "Warden" },
];

const promotions: PromotionDef[] = paths.map(({ classId, name }) => ({
  classId,
  name,
  level: 25,
  mastery: 20,
  attackBp: 1_000,
  boss: challenge(`trial_${classId}`, `${name} Trial`, [{ hpBudget: 26_000, dpsBudget100: 2_250 }]),
}));

function season(id: string, name: string, bossName: string, startMs: number, rule: SeasonDef["rule"], relicName: string, title: string): SeasonDef {
  return {
    boss: challenge(`season_${id}`, bossName, [
      { hpBudget: 15_500, dpsBudget100: 1_650 },
      { hpBudget: 24_500, dpsBudget100: 2_200 },
      { hpBudget: 39_000, dpsBudget100: 3_160 },
    ]),
    name, startMs, endMs: startMs + 6 * WEEK, tierIntervalMs: WEEK,
    rule, relicName, relicAttackBp: [300, 600, 900],
    titles: [`${title} Challenger`, `${title} Veteran`, `${title} Champion`],
  };
}

const firstStart = Date.UTC(2026, 10, 9);
const seasons = [
  season("hollow_frost", "Hollow Frost", "The Rime Sentinel", firstStart,
    { id: "hollow_frost_hardy", name: "Deep Frost · Boss has 10% more HP", kind: "enemy_hp_bp", valueBp: 11_000 },
    "Rime Sigil", "Hollow Frost"),
  season("ember_wake", "Ember Wake", "The Cinder Sentinel", firstStart + 6 * WEEK,
    { id: "ember_wake_damage", name: "Searing Wake · Boss deals 10% more damage", kind: "enemy_damage_bp", valueBp: 11_000 },
    "Cinder Sigil", "Ember Wake"),
];

export const LONG_TERM = { promotions, seasons };
