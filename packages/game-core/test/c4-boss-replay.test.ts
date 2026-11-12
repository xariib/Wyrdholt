import { describe, expect, it } from "vitest";
import { CONTENT } from "@emberbound/game-content";
import {
  ContentIndex,
  ReplayMismatchError,
  createBossFightRecord,
  executeRecord,
  fightHash,
  fightSeed,
  replayFight,
} from "@emberbound/game-core";
import { clone, content, newProfile, run, withLegacyStarterGear } from "./helpers";

const attempt = { bossId: "ashen_king", tier: 1, attemptIndex: 1 };

describe("C4 boss replay", () => {
  it("snapshots the build and replays the same full-HP fight after the profile changes", () => {
    const profile = withLegacyStarterGear(newProfile(40, "mage", "monk"));
    run(profile, { type: "startPush", zoneId: "greenfields" });
    profile.adventure.run!.hp100 = 1;
    const before = clone(profile);
    const record = createBossFightRecord(profile, content, attempt);
    const fight = executeRecord(content, record, { recordEvents: true });

    expect(profile).toEqual(before);
    expect(record.encounter).toEqual({ bossId: "ashen_king", tier: 1 });
    expect(fight.setup.enemies.map((enemy) => enemy.name)).toEqual(["Ashen King"]);
    expect(fight.events?.[0]).toMatchObject({ type: "spawn", actor: "hero", hp: fight.hero.maxHp100 });

    profile.character.activeClassId = "monk";
    delete profile.equipment.weapon;
    profile.inventory.instances[0]!.provenance!.source = "changed";

    const replay = replayFight(content, clone(record));
    expect(record.build.classId).toBe("mage");
    expect(record.itemInstances[0]).toEqual(before.inventory.instances[0]);
    expect(replay.summary).toEqual(fight.summary);
    expect(replay.events).toEqual(fight.events);
    expect(replay.hash).toBe(fightHash(record, fight.events!, fight.summary));
    const headless = executeRecord(content, record, { recordEvents: false });
    expect(headless.events).toBeNull();
    expect(headless.summary).toEqual({ ...replay.summary, eventCount: 0 });
  });

  it("derives attempt seeds independently of Adventure", () => {
    const profile = newProfile(41);
    const first = createBossFightRecord(profile, content, attempt);
    run(profile, { type: "startPush", zoneId: "greenfields" });
    expect(createBossFightRecord(profile, content, attempt)).toEqual(first);
    expect(first.seed).not.toBe(fightSeed(profile.masterSeed, 1, 0));
    expect(createBossFightRecord(profile, content, { ...attempt, attemptIndex: 2 }).seed).not.toBe(first.seed);
  });

  it("pins boss content independently of Adventure records", () => {
    const profile = newProfile(42);
    const record = createBossFightRecord(profile, content, attempt);
    const snapshot = clone(CONTENT);
    snapshot.soloBosses![0]!.tiers[0]!.hpBudget += 1;
    const revised = new ContentIndex(snapshot);

    expect(revised.hash).toBe(content.hash);
    expect(() => replayFight(revised, record)).toThrow(ReplayMismatchError);
  });

  it("rejects invalid boss attempts", () => {
    const profile = newProfile(43);
    expect(() => createBossFightRecord(profile, content, { ...attempt, bossId: "caldera_drake" })).toThrow("Unknown solo boss");
    expect(() => createBossFightRecord(profile, content, { ...attempt, tier: 6 })).toThrow("Unknown tier");
    expect(() => createBossFightRecord(profile, content, { ...attempt, attemptIndex: 0 })).toThrow("Invalid solo boss attempt index");
  });
});
