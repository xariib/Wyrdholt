import type { MechanicDef, TechniqueDef } from "@emberbound/shared-types";
import type { ContentIndex } from "../content";

/** Highest level/rank whose cumulative requirement is <= xp. totals[0] must be 0. */
export function levelFromTotals(totals: readonly number[], xp: number): number {
  let level = 1;
  for (let i = 1; i < totals.length; i += 1) {
    if (xp >= (totals[i] ?? Number.MAX_SAFE_INTEGER)) level = i + 1;
    else break;
  }
  return level;
}

export interface CurveProgress {
  level: number;
  maxLevel: number;
  /** XP earned inside the current level. */
  intoLevel: number;
  /** XP size of the current level step (0 at max). */
  levelSize: number;
}

export function curveProgress(totals: readonly number[], xp: number): CurveProgress {
  const level = levelFromTotals(totals, xp);
  const maxLevel = totals.length;
  const start = totals[level - 1] ?? 0;
  if (level >= maxLevel) return { level, maxLevel, intoLevel: 0, levelSize: 0 };
  const next = totals[level] ?? start;
  return { level, maxLevel, intoLevel: xp - start, levelSize: next - start };
}

export function characterLevelFromXp(content: ContentIndex, xp: number): number {
  return levelFromTotals(content.levelTotals, xp);
}

export function masteryRank(content: ContentIndex, classId: string, xp: number): number {
  const cls = content.classDef(classId);
  return levelFromTotals(content.masteryTotals(cls.masteryTrackId), xp);
}

export function masteryProgress(content: ContentIndex, classId: string, xp: number): CurveProgress {
  const cls = content.classDef(classId);
  return curveProgress(content.masteryTotals(cls.masteryTrackId), xp);
}

export interface TechniqueStatus {
  technique: TechniqueDef;
  unlocked: boolean;
}

export function techniqueStatuses(content: ContentIndex, classId: string, rank: number): TechniqueStatus[] {
  const track = content.track(content.classDef(classId).masteryTrackId);
  return track.techniques.map((technique) => ({ technique, unlocked: technique.unlockRank <= rank }));
}

export function nextMilestone(content: ContentIndex, classId: string, rank: number): TechniqueDef | null {
  const track = content.track(content.classDef(classId).masteryTrackId);
  return track.techniques.find((t) => t.unlockRank > rank) ?? null;
}

/**
 * Resolve the class kit at a mastery rank: techniques are applied in order.
 * `add` unlocks mechanics; `patch` changes parameters of unlocked mechanics.
 * Returns fresh copies (the catalog is never mutated).
 */
export function resolveClassMechanics(content: ContentIndex, classId: string, rank: number): MechanicDef[] {
  const track = content.track(content.classDef(classId).masteryTrackId);
  const mechanics: MechanicDef[] = [];
  for (const technique of track.techniques) {
    if (technique.unlockRank > rank) continue;
    for (const m of technique.add ?? []) mechanics.push({ ...m });
    for (const patch of technique.patch ?? []) {
      const target = mechanics.find((m) => m.id === patch.mechanicId);
      if (!target) {
        throw new Error(`Technique ${technique.id} patches unknown/locked mechanic ${patch.mechanicId}`);
      }
      const record = target as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(patch.set)) {
        if (!(key in record) || typeof record[key] !== "number") {
          throw new Error(`Technique ${technique.id} patches invalid field ${patch.mechanicId}.${key}`);
        }
        record[key] = value;
      }
    }
  }
  return mechanics;
}
