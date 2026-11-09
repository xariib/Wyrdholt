import type { ContentIndex } from "../content";
import { createInstance } from "../items/inventory";
import { RULES_VERSION, SAVE_SCHEMA_VERSION } from "../rules/version";
import type { Profile } from "./types";

export interface NewCharacterInput {
  name: string;
  activeClassId: string;
  alternateClassId: string;
  /** 32-bit seed. The client generates it today; a server will issue it later. */
  masterSeed: number;
  nowWallMs: number;
}

export function validateNewCharacter(content: ContentIndex, input: NewCharacterInput): string | null {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 16) return "Name must be 2–16 characters.";
  if (input.activeClassId === input.alternateClassId) return "Choose two different classes.";
  for (const id of [input.activeClassId, input.alternateClassId]) {
    const cls = content.classes.get(id);
    if (!cls) return `Unknown class ${id}.`;
    if (!cls.implemented) return `${cls.name} is not available in this build.`;
    if (cls.tier !== 1) return `${cls.name} is not a base class.`;
  }
  if (!Number.isSafeInteger(input.masterSeed)) return "Invalid seed.";
  return null;
}

export function createProfile(content: ContentIndex, input: NewCharacterInput): Profile {
  const problem = validateNewCharacter(content, input);
  if (problem) throw new Error(problem);
  const zones: Profile["adventure"]["zones"] = {};
  const playable = content.snapshot.zones.filter((z) => !z.hidden).sort((a, b) => a.order - b.order);
  for (const [i, z] of playable.entries()) {
    zones[z.id] = { unlocked: i === 0, cleared: false, bestStage: 0, completions: 0, checkpoint: null };
  }
  const firstZone = playable[0];
  if (!firstZone) throw new Error("Content has no zones");

  const profile: Profile = {
    schema: SAVE_SCHEMA_VERSION,
    rulesVersion: RULES_VERSION,
    contentVersion: content.snapshot.contentVersion,
    masterSeed: input.masterSeed >>> 0,
    createdAtWallMs: input.nowWallMs,
    character: {
      name: input.name.trim(),
      xp: 0,
      level: 1,
      activeClassId: input.activeClassId,
      alternateClassId: input.alternateClassId,
      masteryXp: { [input.activeClassId]: 0, [input.alternateClassId]: 0 },
    },
    gold: 0,
    inventory: { nextInstanceId: 1, instances: [] },
    equipment: {},
    pending: null,
    adventure: {
      activity: "idle",
      zoneId: firstZone.id,
      zones,
      run: null,
      runCounter: 0,
      lastResult: null,
    },
    stats: { fights: 0, victories: 0, defeats: 0, runsStarted: 0, runsCompleted: 0, itemsFound: 0, offlineSettlements: 0 },
    clock: { lastSettledWallMs: input.nowWallMs, simulatedMs: 0 },
  };

  const starterWeapon = content.snapshot.starterWeapons?.[input.activeClassId];
  const starterItems = content.snapshot.starterItems;
  for (const baseId of starterWeapon ? [starterWeapon, ...starterItems] : starterItems) {
    const item = content.item(baseId);
    const instance = createInstance(profile, baseId, { isNew: false, provenance: { source: "starter" } });
    profile.equipment[item.slot] = instance.id;
  }
  return profile;
}
