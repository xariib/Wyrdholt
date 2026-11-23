import type { TalentDef, TalentTreeDef } from "@emberbound/shared-types";
import type { ContentIndex } from "../content";
import type { Profile } from "../profile/types";
import { TALENTS_AND_HUNTS_SAVE_SCHEMA_VERSION } from "../rules/version";
import { masteryRank } from "./progression";

export const MAX_TALENT_POINTS = 4;
export const talentPoints = (mastery: number): number => Math.min(MAX_TALENT_POINTS, Math.floor(mastery / 3));

export function selectedTalents(tree: TalentTreeDef | undefined, rank: number, ids: readonly string[]): TalentDef[] {
  if (!tree || ids.length > talentPoints(rank) || ids.length !== new Set(ids).size) return [];
  const wanted = new Set(ids);
  const selected: TalentDef[] = [];
  for (const { nodes } of tree.branches) {
    for (const node of nodes) {
      if (!wanted.has(node.id)) break;
      selected.push(node);
    }
  }
  return selected.length === ids.length ? selected : [];
}

export function setTalents(profile: Profile, content: ContentIndex, classId: string, ids: string[], queued: boolean): { error: string } | { queued: boolean } {
  const character = profile.character;
  if (classId !== character.activeClassId && classId !== character.alternateClassId) return { error: "That class is not learned." };
  const tree = content.talentTrees.get(classId);
  if (!tree) return { error: "That class has no skill tree." };
  const rank = masteryRank(content, classId, character.masteryXp[classId] ?? 0);
  if (!Array.isArray(ids) || ids.length > MAX_TALENT_POINTS || selectedTalents(tree, rank, ids).length !== ids.length) {
    return { error: "Spend available points in order along each branch." };
  }
  const ordered = [...ids].sort();
  profile.schema = TALENTS_AND_HUNTS_SAVE_SCHEMA_VERSION;
  if (queued) {
    const pending = profile.pending ??= {};
    (pending.talents ??= {})[classId] = ordered;
  } else {
    (character.talents ??= {})[classId] = ordered;
    if (profile.pending?.talents) delete profile.pending.talents[classId];
  }
  return { queued };
}
