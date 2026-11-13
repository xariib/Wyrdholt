import { describe, expect, it } from "vitest";
import { darkwoodAssets, actorPack, attackDurations } from "../src/art/darkwood";
import { heroAnimationAsset, heroAttackFrame } from "../src/art/heroAnimation";
import { validateArt } from "../src/art/types";
import { ProductionMotion } from "../src/render/productionMotion";

describe("hero attack presentation keys", () => {
  it("keeps the original pack intact and preserves the release timestamp in expanded atlases", () => {
    for (const cls of ["monk", "warrior", "mage", "ranger"]) {
      const original = darkwoodAssets.find(a => a.id === `characters/${cls}/attack`)!;
      const visual = heroAnimationAsset(original);
      expect(original.frames).toHaveLength(4); expect(visual.frames).toHaveLength(8);
      expect(visual.frames.slice(0, 2).reduce((sum, f) => sum + f.durationMs, 0)).toBe(actorPack[cls]!.animations.attack.ms[0]);
      expect(validateArt([visual])).toEqual([]);
      expect(visual.anchor.y).toBe(original.anchor.y);
      expect(visual.width - visual.anchor.x).toBe(original.width - original.anchor.x + 8);
    }
  });
  it.each([350, 500, 1000])("selects visual keys inside the fitted phases at %d ms cadence", interval => {
    for (const cls of ["monk", "warrior", "mage", "ranger"]) {
      const durations = attackDurations(actorPack[cls]!.animations.attack, interval);
      let elapsed = 0;
      durations.forEach((ms, phase) => {
        if (ms) {
          expect(heroAttackFrame(phase, elapsed, durations)).toBe(phase * 2);
          expect(heroAttackFrame(phase, elapsed + ms * .75, durations)).toBe(phase * 2 + 1);
        }
        elapsed += ms;
      });
    }
  });
  it("shows the release key after a late render instead of skipping to recovery", () => {
    const motion = new ProductionMotion(actorPack.mage!, true);
    motion.attack(1000, 1000);
    const sample = motion.sample(1600);
    expect(sample.impact).toBe(true);
    expect(heroAttackFrame(sample.index, 1600 - motion.start, motion.attackTiming)).toBe(2);
  });
});
