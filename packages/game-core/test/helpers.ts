import { CONTENT } from "@emberbound/game-content";
import {
  ContentIndex,
  applyCommand,
  createProfile,
  type Command,
  type Profile,
} from "@emberbound/game-core";

export const content = new ContentIndex(CONTENT);

export function newProfile(seed = 1, active = "monk", alternate = "mage"): Profile {
  return createProfile(content, {
    name: "Tester",
    activeClassId: active,
    alternateClassId: alternate,
    masterSeed: seed,
    nowWallMs: 0,
  });
}

export function run(profile: Profile, command: Command, offline = false) {
  return applyCommand(profile, content, command, { contentTimeMs: 0, offline });
}

export function setLevel(profile: Profile, level: number): void {
  profile.character.xp = content.levelTotals[level - 1] ?? 0;
  profile.character.level = level;
}

export function setMastery(profile: Profile, classId: string, rank: number): void {
  const track = content.classDef(classId).masteryTrackId;
  profile.character.masteryXp[classId] = content.masteryTotals(track)[rank - 1] ?? 0;
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
