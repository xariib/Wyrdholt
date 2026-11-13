import { describe, it, expect } from "vitest";
import { actorPack, darkwoodAssets, attackDurations, sequenceIndex } from "../src/art/darkwood";
import { ProductionMotion } from "../src/render/productionMotion";
import { UNARMED_ATTACK, unarmedApproach } from "../src/render/characterMotion";
import { validateArt } from "../src/art/types";

describe("approved Darkwood presentation", () => {
  it.each([350, 500, 714])("finishes a critical unarmed recovery before the next %d ms attack", interval => {
    const m = new ProductionMotion({ ...actorPack.monk!, animations: { ...actorPack.monk!.animations, attack: UNARMED_ATTACK } }, true);
    m.scheduledAttack(0, interval);
    const windup = m.windupMs;
    m.sample(windup); m.crit();
    expect(m.attackTiming.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(interval);
    const frames = new Set([0]);
    for (let t = windup; t < interval; t += 10) frames.add(m.sample(t).index);
    expect([...frames]).toEqual([0, 1, 2, 3]);
    expect(unarmedApproach(100, interval, m.attackTiming)).toBe(0);
    expect(m.sample(interval).pose).toBe("idle");
  });
  it("finishes every bare-handed pose and a smooth return despite repeated incoming hits", () => {
    const m = new ProductionMotion({ ...actorPack.monk!, animations: { ...actorPack.monk!.animations, attack: UNARMED_ATTACK } }, true);
    m.scheduledAttack(1000, 1000);
    const frames = new Set<number>(), positions: number[] = [];
    for (let now = 1000; now < 1960; now += 20) {
      if (now % 100 === 0) m.hit(now, false);
      const sample = m.sample(now);
      expect(sample.pose).toBe("attack");
      frames.add(sample.index);
      positions.push(unarmedApproach(100, now - m.start, m.attackTiming));
    }
    expect([...frames]).toEqual([0, 1, 2, 3]);
    expect(positions.at(-1)).toBeLessThan(1);
    expect(m.sample(1960).pose).toBe("hit");
    m.death(1970);
    expect(m.sample(1980).pose).toBe("death");
  });
  it("adapts variable frames without cropping or anchor shifts", () => {
    expect(validateArt(darkwoodAssets)).toEqual([]);
    const warrior = actorPack.warrior!;
    expect(warrior.animations.idle.frame).toEqual([64, 64]);
    expect(warrior.animations.attack.frame).toEqual([72, 72]);
    expect(warrior.animations.attack.anchor).toEqual([36, 64]);
    expect(actorPack.wolf!.animations.attack.frame).toEqual([72, 56]);
    expect(darkwoodAssets.some(a => a.id.includes("ranger_poison"))).toBe(false);
  });
  it("compresses proportionally while keeping contact and a visible recovery", () => {
    const clip = actorPack.monk!.animations.attack;
    for (const interval of [280, 350, 500, 714, 1000]) {
      const durations = attackDurations(clip, interval);
      expect(durations.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(interval);
      expect(durations.every(t => t >= 60)).toBe(true);
    }
    expect(attackDurations(clip, 180)).toEqual([60, 60, 60, 60]);
    expect(attackDurations(clip, 1)).toEqual([60, 60, 60, 60]);
  });
  it("gives every hero a measured idle loop and a full attack at normal cadence", () => {
    for (const cls of ["monk", "mage", "warrior", "ranger"]) {
      const actor = actorPack[cls]!;
      expect(actor.animations.idle.ms.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(1800);
      const attack = attackDurations(actor.animations.attack, 1000);
      expect(attack.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(800);
      expect(attack[0]).toBeGreaterThanOrEqual(240);
      expect(attack[3]).toBeGreaterThanOrEqual(250);
    }
  });
  it("does not skip impact when a render frame is late", () => {
    const m = new ProductionMotion(actorPack.monk!);
    m.attack(1000, 1000);
    expect(m.sample(1500)).toEqual({ pose: "attack", index: 1, impact: true });
    expect(m.sample(1559).index).toBe(1);
    expect(m.sample(1619).index).toBe(1);
    expect(m.sample(1620).index).toBe(2);
  });
  it("defers hit until impact finishes and ward uses hit_01", () => {
    const m = new ProductionMotion(actorPack.mage!);
    m.attack(1000, 1000); m.sample(1320); m.hit(1340, true);
    expect(m.sample(1360).pose).toBe("attack");
    expect(m.sample(1380)).toEqual({ pose: "hit", index: 1, impact: false });
  });
  it("protects impact even when hit arrives before that render sample", () => {
    const m = new ProductionMotion(actorPack.monk!);
    m.attack(1000, 1000); m.hit(1245, false);
    expect(m.sample(1245)).toEqual({ pose: "attack", index: 1, impact: true });
    expect(m.sample(1305).pose).toBe("hit");
  });
  it("death has priority and holds the final approved frame", () => {
    const m = new ProductionMotion(actorPack.warrior!);
    m.attack(1000, 1000); m.death(1010); m.hit(1020, false); m.attack(1030, 1);
    expect(m.sample(9000)).toEqual({ pose: "death", index: 3, impact: false });
    expect(sequenceIndex([100, 140, 170, 0], 410)).toBe(3);
  });
  it("prepared attack cadence replaces stale reactions without exposing a future crit", () => {
    const m = new ProductionMotion(actorPack.mage!);
    m.attack(1000, 1000); m.crit(); m.hit(1001, false);
    m.scheduledAttack(1020, 120);
    expect(m.pose).toBe("attack"); expect(m.critical).toBe(false);
    m.death(1030); m.scheduledAttack(1040, 120); expect(m.pose).toBe("death");
  });
  it("queues rapid attacks without endlessly restarting anticipation", () => {
    const m = new ProductionMotion(actorPack.monk!);
    m.attack(1000, 1); m.attack(1020, 1); m.attack(1040, 1);
    expect(m.sample(1060).index).toBe(1);
    expect(m.sample(1119).impact).toBe(true);
    expect(m.sample(1120).index).toBe(0);
    expect(m.attackSerial).toBe(2);
  });
});
