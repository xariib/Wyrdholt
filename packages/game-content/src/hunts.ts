import type { ContentSnapshot, HuntDef, StageDef } from "@emberbound/shared-types";
import { ZONES } from "./zones";

// Initial playtest tuning. Separate from Adventure budgets and reward cadence.
function hunt(zoneId: string, id: string, name: string, description: string, trait: string): HuntDef {
  const zone = ZONES.find(z => z.id === zoneId)!;
  const stage = (source: StageDef, index: number, hpBp: number, damageBp: number): StageDef => ({
    ...source, enemies: [...source.enemies], index,
    hpBudget: Math.round(source.hpBudget * hpBp / 10_000),
    dpsBudget100: Math.round(source.dpsBudget100 * damageBp / 10_000),
  });
  return {
    id, name, zoneId, description, trait,
    approach: stage(zone.stages[4]!, 0, 20_000, 3_000),
    detour: stage(zone.stages[8]!, 1, 20_000, 5_000),
    boss: stage(zone.stages[zone.stages.length - 1]!, 2, 16_000, 3_500),
    weakenedDamageBp: 4_000,
  };
}

export const HUNTS: NonNullable<ContentSnapshot["hunts"]> = {
  intervalMs: 4 * 60 * 60 * 1000,
  capacity: 3,
  definitions: [
    hunt("greenfields", "rootbound_elder", "The Rootbound Elder",
      "Ancient roots have swallowed a traveller's cache beneath the meadow.",
      "A sturdy elder and its sproutling share the fight. Multi-target attacks can help."),
    hunt("darkwood", "briar_matriarch", "The Briar Matriarch",
      "Silken tracks lead to a nest deep beneath the briars.",
      "The matriarch fights with two broodlings. Prepare for repeated incoming hits."),
    hunt("ashen_mountains", "cindermaw", "Cindermaw",
      "A drake has dragged a treasure caravan into the hot stone.",
      "One powerful drake. Sustained single-target damage and survival matter."),
  ],
};
