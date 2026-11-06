import { describe, it, expect } from "vitest";
import { actorPack, darkwoodAssets, attackDurations, sequenceIndex } from "../src/art/darkwood";
import { ProductionMotion } from "../src/render/productionMotion";
import { validateArt } from "../src/art/types";

describe("approved Darkwood presentation", () => {
  it("adapts variable frames without cropping or anchor shifts", () => {
    expect(validateArt(darkwoodAssets)).toEqual([]);
    const warrior = actorPack.warrior!;
    expect(warrior.animations.idle.frame).toEqual([64, 64]);
    expect(warrior.animations.attack.frame).toEqual([72, 72]);
    expect(warrior.animations.attack.anchor).toEqual([36, 64]);
    expect(actorPack.wolf!.animations.attack.frame).toEqual([72, 56]);
    expect(darkwoodAssets.some(a => a.id.includes("ranger_poison"))).toBe(false);
  });
  it("compresses recovery then anticipation then hold, preserving impact minimum", () => {
    const clip = actorPack.monk!.animations.attack;
    expect(attackDurations(clip, 280)).toEqual([120, 60, 100, 0]);
    expect(attackDurations(clip, 180)).toEqual([60, 60, 60, 0]);
    expect(attackDurations(clip, 1)).toEqual([60, 60, 60, 0]);
  });
  it("does not skip impact when a render frame is late", () => {
    const m = new ProductionMotion(actorPack.monk!);
    m.attack(1000, 1000);
    expect(m.sample(1500)).toEqual({ pose: "attack", index: 1, impact: true });
    expect(m.sample(1559).index).toBe(1);
    expect(m.sample(1560).index).toBe(2);
  });
  it("defers hit until impact finishes and ward uses hit_01", () => {
    const m = new ProductionMotion(actorPack.mage!);
    m.attack(1000, 1000); m.sample(1160); m.hit(1180, true);
    expect(m.sample(1200).pose).toBe("attack");
    expect(m.sample(1220)).toEqual({ pose: "hit", index: 1, impact: false });
  });
  it("protects impact even when hit arrives before that render sample", () => {
    const m = new ProductionMotion(actorPack.monk!);
    m.attack(1000, 1000); m.hit(1125, false);
    expect(m.sample(1125)).toEqual({ pose: "attack", index: 1, impact: true });
    expect(m.sample(1185).pose).toBe("hit");
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
