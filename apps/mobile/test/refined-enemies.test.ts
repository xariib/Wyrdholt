import { describe, expect, it } from "vitest";
import { CONTENT } from "@emberbound/game-content";
import { asset } from "../src/art/manifest";
import { ENEMY_DESIGNS, refinedEnemyAssets, refinedEnemyActors } from "../src/art/refinedEnemies";
import { actorPack, productionActorId } from "../src/art/actors";
import { actorPack as originalActors } from "../src/art/darkwood";
import { validateArt } from "../src/art/types";

describe("matching enemy artwork", () => {
  it("covers every live enemy with distinct local artwork and all combat poses", () => {
    const names = [...new Set(CONTENT.enemies.map(e => e.sprite))].sort();
    expect(ENEMY_DESIGNS.map(e => e.name).sort()).toEqual(names);
    expect(new Set(ENEMY_DESIGNS.map(e => asset(`enemies/${e.name}`)!.file)).size).toBe(names.length);
    expect(validateArt(refinedEnemyAssets)).toEqual([]);
    for (const name of names) {
      expect(productionActorId(name)).toBe(`enemies/${name}`);
      expect(actorPack[name]).toBe(refinedEnemyActors[name]);
      for (const pose of ["idle", "attack", "hit", "death", "flash"] as const) {
        const a = asset(`enemies/${name}${pose === "idle" ? "" : `/${pose}`}`)!;
        expect(a.file).toMatch(/^art\/refined-pixel\/enemies\//);
        expect(a.pixelsPerUnit).toBe(2); expect(a.facing).toBe("left");
        if (pose !== "flash") expect(a.frames.length).toBe(actorPack[name]!.animations[pose].ms.length);
      }
    }
  });
  it.each(["wolf", "spider"])("preserves the existing %s contact timing and anchors", name => {
    for (const pose of ["idle", "attack", "hit", "death"] as const) {
      const before = originalActors[name]!.animations[pose], after = actorPack[name]!.animations[pose];
      expect(after.frame).toEqual(before.frame); expect(after.anchor).toEqual(before.anchor);
      expect(after.ms).toEqual(before.ms.map(t => Math.max(1, t)));
      expect(after.impact_frame).toBe(before.impact_frame);
    }
  });
});
