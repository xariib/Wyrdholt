import { describe, expect, it } from "vitest";
import {
  advanceAdventure,
  canonicalJson,
  encodeProfile,
  settleOffline,
  simulateOffline,
} from "@emberbound/game-core";
import { clone, content, newProfile, run, setLevel, setMastery } from "./helpers";

describe("offline catch-up", () => {
  it("uses the same pipeline as online play", () => {
    const online = newProfile(30);
    setLevel(online, 10);
    setMastery(online, "monk", 10);
    run(online, { type: "startPush", zoneId: "greenfields" });
    advanceAdventure(online, content, 30_000, { offline: false, contentTimeMs: 0 });
    const offline = clone(online);
    advanceAdventure(online, content, 900_000, { offline: false, contentTimeMs: 0 });
    simulateOffline(offline, content, 900_000, 0);
    offline.stats.offlineSettlements -= 1;
    expect(canonicalJson(encodeProfile(offline))).toBe(canonicalJson(encodeProfile(online)));
  });

  it("a failed Push stops risky content and farms safe content for the rest of the time", () => {
    const p = newProfile(31, "mage", "monk");
    run(p, { type: "startPush", zoneId: "greenfields" });
    // Entering the boss stage with 1 HP guarantees a Push failure.
    p.adventure.run!.stageIndex = 9;
    p.adventure.run!.hp100 = 100;
    const s = simulateOffline(p, content, 3_600_000, 0);
    expect(s.push.status).toBe("failed");
    expect(s.push.stage).toBe(10);
    expect(s.segments[0]!.mode).toBe("push");
    expect(s.segments.slice(1).map((seg) => seg.mode)).toEqual(["trail"]);
    expect(p.adventure.activity).toBe("farm");
    expect(p.adventure.run?.mode).toBe("trail");
    expect(s.segments.reduce((a, seg) => a + seg.ms, 0)).toBe(3_600_000);
    expect(s.victories).toBeGreaterThan(10);
  });

  it("a successful Push unlocks the next zone, does not enter it, and farms the completed zone", () => {
    const p = newProfile(32);
    setLevel(p, 10);
    setMastery(p, "monk", 10);
    run(p, { type: "startPush", zoneId: "greenfields" });
    const s = simulateOffline(p, content, 2 * 3_600_000, 0);
    expect(s.push.status).toBe("cleared");
    expect(s.unlockedZoneIds).toEqual(["darkwood"]);
    expect(p.adventure.run?.zoneId).toBe("greenfields");
    expect(p.adventure.activity).toBe("farm");
    expect(s.segments.map((x) => x.mode)).toEqual(["push", "farm"]);
    expect(s.notableInstanceIds.length).toBeLessThanOrEqual(3);
    expect(s.otherItems).toBe(s.itemsFound - s.notableInstanceIds.length);
  });

  it("is capped at the content's offline storage (24 hours since the C1 retune)", () => {
    expect(content.snapshot.config.offlineCapMs).toBe(24 * 3_600_000);
    const p = newProfile(33);
    run(p, { type: "startFarm", zoneId: "greenfields" });
    const s = simulateOffline(p, content, 30 * 3_600_000, 0);
    expect(s.capped).toBe(true);
    expect(s.simulatedMs).toBe(24 * 3_600_000);
    const q = newProfile(33);
    run(q, { type: "startFarm", zoneId: "greenfields" });
    const t = simulateOffline(q, content, 20 * 3_600_000, 0);
    expect(t.capped).toBe(false);
    expect(t.simulatedMs).toBe(20 * 3_600_000);
  });

  it("settlement is idempotent and ignores a clock that moved backwards", () => {
    const p = newProfile(34);
    run(p, { type: "startFarm", zoneId: "greenfields" });
    const first = settleOffline(p, content, 600_000);
    expect(first.fights).toBeGreaterThan(0);
    const snapshot = canonicalJson(encodeProfile(p));
    const again = settleOffline(p, content, 600_000);
    expect(again.fights).toBe(0);
    const back = settleOffline(p, content, 100_000);
    expect(back.fights).toBe(0);
    expect(p.clock.lastSettledWallMs).toBe(600_000);
    const withoutCounter = (x: string) => x.replace(/"offlineSettlements":\d+/, "");
    expect(withoutCounter(canonicalJson(encodeProfile(p)))).toBe(withoutCounter(snapshot));
  });

  it("does nothing while idle", () => {
    const p = newProfile(35);
    const s = simulateOffline(p, content, 3_600_000, 0);
    expect(s.fights).toBe(0);
    expect(s.stoppedReason).toBe("idle");
  });
});
