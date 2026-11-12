import { describe, expect, it } from "vitest";
import { FightCache, heroStatsFor, prepareFight, startRun } from "@emberbound/game-core";
import { content, newProfile } from "./helpers";

describe("replacing a profile invalidates combat caches", () => {
  it.each([true, false])("cannot transfer cached gear strength between backups (strong first=%s)", strongFirst => {
    const first = newProfile(17, "warrior", "mage"), second = newProfile(17, "warrior", "mage");
    const strong = strongFirst ? first : second;
    strong.inventory.instances.find(i => i.id === strong.equipment.weapon)!.baseId = "kingsfall";
    const cache = new FightCache();
    const oldStats = heroStatsFor(first, content, cache);
    const expected = heroStatsFor(second, content);
    expect(oldStats.attack100).not.toBe(expected.attack100);
    cache.clearFights(); // Restore/reset/catch-up calls this before publishing a replacement.
    expect(heroStatsFor(second, content, cache)).toEqual(expected);
    const run = startRun(second, content, "greenfields", "trail", 0);
    const cached = prepareFight(second, content, run, { contentTimeMs: 0, recordEvents: true, cache });
    const uncached = prepareFight(second, content, run, { contentTimeMs: 0, recordEvents: true });
    expect(cached.summary).toEqual(uncached.summary);
    expect(cached.events).toEqual(uncached.events);
  });
});
