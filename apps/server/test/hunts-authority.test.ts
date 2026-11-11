import { describe, expect, it } from "vitest";
import { CONTENT } from "@emberbound/game-content";
import { ContentIndex, applyCommand, createProfile } from "@emberbound/game-core";
import { executeAuthorityCommand, isPlayerCommand, verifyAuthorityReplay } from "../src/authority/commands";

describe("Hunt authority journal compatibility", () => {
  it("replays pre-Hunt farming journals and pins new discoveries to the Hunt hash", () => {
    const { hunts: _hunts, ...snapshot } = CONTENT;
    const legacy = new ContentIndex(snapshot), current = new ContentIndex(CONTENT);
    const p = createProfile(legacy, { name: "Journal", activeClassId: "warrior", alternateClassId: "mage", masterSeed: 8, nowWallMs: 0 });
    p.character.level = 30; p.character.xp = legacy.levelTotals[29]!;
    Object.assign(p.adventure.zones.greenfields!, { unlocked: true, cleared: true, bestStage: 10, completions: 1 });
    applyCommand(p, legacy, { type: "startFarm", zoneId: "greenfields" }, { contentTimeMs: 0 });
    const request = { format: "wyrdholt-command/1" as const, requestId: "settle", revision: 1, command: null };
    const old = executeAuthorityCommand(legacy, p, request, 10_000);
    if (!old.ok) throw new Error(old.error);
    expect(old.profile.hunts).toBeUndefined();
    expect(verifyAuthorityReplay(current, p, old.entry)).toEqual(old.profile);
    const next = executeAuthorityCommand(current, p, request, 10_000);
    if (!next.ok) throw new Error(next.error);
    expect(next.entry.contentHash).toBe(current.authorityHash);
    expect(next.profile.hunts!.queue).toHaveLength(1);
    expect(verifyAuthorityReplay(current, p, next.entry)).toEqual(next.profile);
  });
  it("validates network Hunt commands", () => {
    expect(isPlayerCommand({ type: "startHunt", discoveryId: 1, slot: "ring" })).toBe(true);
    expect(isPlayerCommand({ type: "startHunt", discoveryId: 1, route: "weakness" })).toBe(true);
    expect(isPlayerCommand({ type: "startHunt", discoveryId: 0 })).toBe(false);
    expect(isPlayerCommand({ type: "startHunt", discoveryId: 1, route: "free-loot" })).toBe(false);
    expect(isPlayerCommand({ type: "startHunt", discoveryId: 1, slot: "bag" })).toBe(false);
  });
});
