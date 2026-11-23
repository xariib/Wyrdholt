import { SLOT_ORDER, type DamageType, type ItemDef, type MechanicDef, type SlotId, type StatBlock } from "@emberbound/shared-types";

const classes = { monk: "Monk", mage: "Mage", warrior: "Warrior", ranger: "Ranger" };
const tiers = [
  { rarity: "rare", rank: 1, name: "Briar" },
  { rarity: "epic", rank: 2, name: "Storm" },
  { rarity: "legendary", rank: 3, name: "Dawn" },
] as const;
const styles = ["precision", "tempo", "bulwark"] as const;
const labels = { precision: "Precision", tempo: "Tempo", bulwark: "Bulwark" };
const tags = { precision: ["PRECISION", "CRIT"], tempo: ["TEMPO", "FAST ATTACKS"], bulwark: ["BULWARK", "SUSTAIN"] };
const slots = { weapon: "Weapon", head: "Headpiece", chest: "Vest", gloves: "Grips", boots: "Stride", ring: "Band" };
const weapons = { monk: "Wraps", mage: "Staff", warrior: "Sword", ranger: "Bow" };

type Style = typeof styles[number];
type Effect = NonNullable<ItemDef["effect"]>;
const percent = (bp: number) => `${bp / 100}%`;

function specialization(style: Style, slot: SlotId, rank: number, id: string, damageType: DamageType): Effect {
  const power = 1_500 + 500 * rank;
  const speed = 800 + 200 * rank;
  const ward = 300 + 200 * rank;
  const heal = 200 + 100 * rank;
  const effect = (name: string, description: string, mechanic: MechanicDef): Effect => ({ name, description, mechanics: [mechanic] });
  switch (style) {
    case "precision":
      switch (slot) {
        case "weapon": return effect("Finish the Hunt", `Direct hits deal +${percent(power)} damage to enemies at or below 25% HP.`, { kind: "execute", id, thresholdBp: 2_500, bonusBp: power });
        case "head": return effect("Find the Gap", `Direct hits ignore ${percent(power)} of enemy armor.`, { kind: "armor_pierce", id, pierceBp: power });
        case "chest": return effect("Vengeful Focus", `When a hit damages health, 25% chance to retaliate for ${percent(power + 1_000)} attack. 2s cooldown.`, { kind: "on_damaged_retaliate", id, chanceBp: 2_500, potencyBp: power + 1_000, damageType, cooldownMs: 2_000, appliesDots: 0 });
        case "gloves": return effect("Severing Strike", `Every fourth hit deals an extra strike for ${percent(power + 1_000)} attack.`, { kind: "nth_hit_extra_damage", id, every: 4, potencyBp: power + 1_000, damageType });
        case "boots": return effect("Crosscut", `15% chance on hit to strike a second enemy for ${percent(power + 1_000)} attack.`, { kind: "on_hit_chain", id, chanceBp: 1_500, potencyBp: power + 1_000, damageType });
        case "ring": return effect("Splinter", `Hits have a 20% chance to deal ${percent(power)} attack per second for 4s. One stack.`, { kind: "on_hit_dot", id, statusId: "splinter", chanceBp: 2_000, potencyBp: power, tickMs: 1_000, durationMs: 4_000, maxStacks: 1 });
      }
      break;
    case "tempo":
      switch (slot) {
        case "weapon": return effect("Quickening", `Every fourth hit grants +${percent(speed)} attack speed for 3s.`, { kind: "nth_hit_haste", id, statusId: "quickening", every: 4, hasteBp: speed, durationMs: 3_000 });
        case "head": return effect("Afterimage", `Every fifth attack also hits up to two other enemies for ${percent(power)} attack each.`, { kind: "nth_attack_split", id, every: 5, targets: 2, potencyBp: power, damageType, appliesDots: 0 });
        case "chest": return effect("Momentum Burn", `Hits have a 25% chance to deal ${percent(power - 500)} attack per second for 3s. Up to two stacks.`, { kind: "on_hit_dot", id, statusId: "momentum_burn", chanceBp: 2_500, maxStacks: 2, tickMs: 1_000, durationMs: 3_000, potencyBp: power - 500 });
        case "gloves": return effect("Reverberation", `20% chance on hit to echo for ${percent(power)} attack.`, { kind: "on_hit_echo", id, chanceBp: 2_000, potencyBp: power, damageType });
        case "boots": return effect("Rolling Shock", `Every fifth attack deals ${percent(power)} attack to all living enemies.`, { kind: "nth_attack_splash", id, every: 5, potencyBp: power, damageType });
        case "ring": return effect("Wind Shell", `Every fourth attack adds ${percent(ward + 500)} attack as ward, capped at 7% max HP.`, { kind: "ward", id, startBp: 0, every: 4, potencyBp: ward + 500, capBp: 700 });
      }
      break;
    case "bulwark":
      switch (slot) {
        case "weapon": return effect("Stand Firm", `When a hit damages health, 35% chance to retaliate for ${percent(power)} attack. 2s cooldown.`, { kind: "on_damaged_retaliate", id, chanceBp: 3_500, potencyBp: power, damageType, cooldownMs: 2_000, appliesDots: 0 });
        case "head": return effect("Shelter", `Start each fight with a ward of ${percent(ward)} max HP. Cap 10% max HP.`, { kind: "ward", id, startBp: ward, every: 1, potencyBp: 0, capBp: 1_000 });
        case "chest": return effect("Deep Reserve", `Every seventh hit heals ${percent(heal * 2)} max HP. 7s cooldown.`, { kind: "nth_hit_heal", id, every: 7, potencyBp: heal * 2, cooldownMs: 7_000 });
        case "gloves": return effect("Shield Pulse", `Start at ${percent(ward)} max HP as ward. Every sixth attack adds 10% attack as ward. Cap 12% max HP.`, { kind: "ward", id, startBp: ward, every: 6, potencyBp: 1_000, capBp: 1_200 });
        case "boots": return effect("Last Stand", `Direct hits deal +${percent(power - 500)} damage to enemies at or below 40% HP.`, { kind: "execute", id, thresholdBp: 4_000, bonusBp: power - 500 });
        case "ring": return effect("Iron Rhythm", `Every seventh hit grants +${percent(speed + 200)} attack speed for 4s.`, { kind: "nth_hit_haste", id, statusId: "iron_rhythm", every: 7, hasteBp: speed + 200, durationMs: 4_000 });
      }
  }
}

/** Same-tier pieces have a distinct mechanic choice in each slot. */
export function createBuildGear(catalog: readonly ItemDef[]): ItemDef[] {
  const items: ItemDef[] = [];
  for (const [classId, className] of Object.entries(classes)) {
    for (const { rarity, rank, name } of tiers) for (const slot of SLOT_ORDER) {
      const source = catalog.find(item => item.classId === classId && item.rarity === rarity && item.slot === slot && !item.classVariants);
      if (!source) throw new Error(`Missing build gear source: ${classId}/${rarity}/${slot}`);
      for (const style of styles) {
        const id = `${style}_${source.id}`;
        const attack = source.stats.attack ?? 0;
        const packages: Record<typeof styles[number], StatBlock> = {
          precision: { attack: attack + 2 * rank, critBp: (source.stats.critBp ?? 0) + 300 * rank },
          tempo: { attack: Math.max(0, attack - rank), attackRateMilli: (source.stats.attackRateMilli ?? 0) + 60 * rank },
          bulwark: { attack: Math.max(0, attack - 2 * rank), hp: (source.stats.hp ?? 0) + 10 * rank, armor: (source.stats.armor ?? 0) + 2 * rank },
        };
        items.push({
          ...source,
          id,
          name: `${className}'s ${name} ${labels[style]} ${slot === "weapon" ? weapons[classId as keyof typeof weapons] : slots[slot]}`,
          stats: packages[style],
          effect: specialization(style, slot, rank, `gear_${id}`, classId === "mage" ? "magic" : "physical"),
          tags: tags[style],
        });
      }
    }
  }
  return items;
}
