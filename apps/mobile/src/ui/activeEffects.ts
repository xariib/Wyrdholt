import { SLOT_ORDER, type MechanicDef, type SlotId } from "@emberbound/shared-types";
import { findInstance, type ContentIndex, type HeroStats, type Profile } from "@emberbound/game-core";
import { pct, SLOT_LABELS } from "./format";

export interface ClassEffect {
  id: string;
  name: string;
  description: string;
}

/** Mastery can replace these parameters; show their resolved values in the build. */
function upgradedMechanicDescription(mechanic: MechanicDef): string | null {
  const hits = (every: number) => every === 1 ? "Every hit" : `Every ${every} hits`;
  const status = (id: string) => id.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
  switch (mechanic.kind) {
    case "on_hit_dot":
      return `${mechanic.chanceBp === 10000 ? "Every hit applies" : `${pct(mechanic.chanceBp)} chance on hit to apply`} ${status(mechanic.statusId)}: ${pct(mechanic.potencyBp)} attack per stack every ${mechanic.tickMs / 1000}s for ${mechanic.durationMs / 1000}s, up to ${mechanic.maxStacks} stacks per enemy.`;
    case "on_damaged_retaliate":
      return `When an enemy attack damages health, ${pct(mechanic.chanceBp)} chance to strike back for ${pct(mechanic.potencyBp)} attack. ${mechanic.cooldownMs / 1000}s cooldown.${mechanic.appliesDots ? " Also applies class damage over time effects." : ""}`;
    case "execute":
      return `Your hits deal ${pct(mechanic.bonusBp)} more damage to enemies at or below ${pct(mechanic.thresholdBp)} health.`;
    case "nth_hit_haste":
      return `${hits(mechanic.every)}, gain ${pct(mechanic.hasteBp)} attack speed for ${mechanic.durationMs / 1000}s.`;
    case "nth_hit_extra_damage":
      return `${hits(mechanic.every)}, deal an extra ${pct(mechanic.potencyBp)} attack as ${mechanic.damageType} damage${mechanic.requiresStatus ? ` while ${status(mechanic.requiresStatus)} is active` : ""}${mechanic.requiresTargetHpBelowBp !== undefined ? ` to enemies at or below ${pct(mechanic.requiresTargetHpBelowBp)} health` : ""}.`;
    case "on_hit_echo":
      return `Attacks have a ${pct(mechanic.chanceBp)} chance to echo for ${pct(mechanic.potencyBp)} attack damage.`;
    case "nth_attack_splash":
      return `Every ${mechanic.every} attacks, deal ${pct(mechanic.potencyBp)} attack as ${mechanic.damageType} splash damage to all enemies, including the main target.`;
    case "nth_attack_split":
      return `Every ${mechanic.every} attacks, also hit up to ${mechanic.targets} other enemies for ${pct(mechanic.potencyBp)} attack.${mechanic.appliesDots ? " Also applies class damage over time effects." : ""}`;
    default:
      return null;
  }
}

/** Build-summary descriptions; the Character mastery view uses its own presentation. */
export function classEffectDetails(content: ContentIndex, stats: HeroStats): ClassEffect[] {
  const cls = content.classDef(stats.classId);
  const techniques = content.track(cls.masteryTrackId).techniques.filter(technique => technique.unlockRank <= stats.masteryRank);
  const patched = new Set(techniques.flatMap(technique => (technique.patch ?? []).map(patch => patch.mechanicId)));
  const mechanics = stats.mechanics.filter((_, index) => stats.mechanicSources[index] === "class");
  const effects = techniques.map(technique => {
    let description = technique.description;
    if (!technique.patch?.length && technique.add?.some(mechanic => patched.has(mechanic.id))) {
      const current = technique.add.map(original => {
        const resolved = mechanics.find(mechanic => mechanic.id === original.id);
        return resolved ? upgradedMechanicDescription(resolved) : null;
      });
      if (current.every(text => text !== null)) description = current.join(" ");
    }
    return { id: technique.id, name: technique.name, description };
  });
  const promotion = content.promotions.get(cls.id);
  if (promotion && stats.activeEffects.some(effect => effect.source === "class" && effect.name === promotion.name)) {
    effects.push({
      id: `promotion-${cls.id}`,
      name: promotion.name,
      description: `+${pct(promotion.attackBp)} Attack while ${cls.name} is active.`,
    });
  }
  return effects;
}

export interface ActiveEffect {
  id: string;
  name: string;
  description: string;
  source: "item";
  sourceLabel: string;
  slot: SlotId;
  baseId: string;
}

/** Descriptions and inspection links for currently equipped items. */
export function activeEffectDetails(profile: Profile, content: ContentIndex): ActiveEffect[] {
  const effects: ActiveEffect[] = [];
  for (const slot of SLOT_ORDER) {
    const id = profile.equipment[slot];
    const instance = id === undefined ? undefined : findInstance(profile, id);
    if (!instance) continue;
    const item = content.item(instance.baseId);
    if (item.effect) effects.push({
      id: `item-${slot}-${instance.id}`,
      name: item.effect.name,
      description: item.effect.description,
      source: "item",
      sourceLabel: `${SLOT_LABELS[slot]} · ${item.name}`,
      slot,
      baseId: item.id,
    });
  }

  return effects;
}
