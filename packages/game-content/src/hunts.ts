import type { HuntDef, ItemDef, ItemEffectDef, SlotId } from "@emberbound/shared-types";

const classes = ["warrior", "monk", "mage", "ranger"];
export const HUNT_ITEMS: ItemDef[] = [];

function hunt(boss: HuntDef["boss"], reward: Pick<HuntDef, "xp" | "mastery" | "gold">,
  gear: { name: string; rarity: string; slot: SlotId; icon: string; stats: ItemDef["stats"]; effect: ItemEffectDef }): HuntDef {
  const rewards: HuntDef["rewards"] = {};
  for (const classId of classes) {
    const id = `${boss.id}_${classId}`;
    rewards[classId] = id;
    HUNT_ITEMS.push({
      ...gear, id, classId, huntId: boss.id, minEncounterLevel: 1, tags: ["HUNT EXCLUSIVE"],
      effect: { ...gear.effect, mechanics: gear.effect.mechanics.map(mechanic => ({ ...mechanic, id: `${id}_${mechanic.id}` })) },
    });
  }
  return { boss, ...reward, rewards };
}

export const HUNTS: HuntDef[] = [
  hunt({
    id: "hunt_brambleback", name: "Brambleback", unlockZoneId: "greenfields", sprite: "boar_elite",
    attackRateMilli: 780, armor: 12, damageType: "physical", tiers: [{ hpBudget: 950, dpsBudget100: 730 }],
  }, { xp: 360, mastery: 45, gold: 80 }, {
    name: "Brambleback Signet", rarity: "rare", slot: "ring", icon: "ring", stats: { hp: 15, attack: 4, armor: 3 },
    effect: { name: "Briar Revenge", description: "35% chance to retaliate after taking health damage for 35% attack. 2s cooldown.",
      mechanics: [{ kind: "on_damaged_retaliate", id: "briar_revenge", chanceBp: 3_500, potencyBp: 3_500, damageType: "physical", cooldownMs: 2_000, appliesDots: 0 }] },
  }),
  hunt({
    id: "hunt_gloamweaver", name: "Gloamweaver", unlockZoneId: "darkwood", sprite: "matron",
    attackRateMilli: 1_050, armor: 8, damageType: "magic", tiers: [{ hpBudget: 3_200, dpsBudget100: 1_620 }],
  }, { xp: 1_400, mastery: 120, gold: 220 }, {
    name: "Gloamweaver Treads", rarity: "epic", slot: "boots", icon: "boots", stats: { hp: 18, attackRateMilli: 140, armor: 6 },
    effect: { name: "Silkstep", description: "Every fourth hit grants +15% attack speed for 3s.",
      mechanics: [{ kind: "nth_hit_haste", id: "silkstep", statusId: "silkstep", every: 4, hasteBp: 1_500, durationMs: 3_000 }] },
  }),
  hunt({
    id: "hunt_cindermaw", name: "Cindermaw", unlockZoneId: "ashen_mountains", sprite: "drake",
    attackRateMilli: 840, armor: 17, damageType: "magic", tiers: [{ hpBudget: 10_500, dpsBudget100: 2_350 }],
  }, { xp: 3_000, mastery: 240, gold: 500 }, {
    name: "Cindermaw Grips", rarity: "legendary", slot: "gloves", icon: "gloves", stats: { attack: 10, critBp: 600, armor: 5 },
    effect: { name: "Cinderclaw", description: "Every fourth attack deals 50% attack as magic damage to all living enemies.",
      mechanics: [{ kind: "nth_attack_splash", id: "cinderclaw", every: 4, potencyBp: 5_000, damageType: "magic" }] },
  }),
];
