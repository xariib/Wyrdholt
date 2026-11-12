import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTENT } from "@emberbound/game-content";
import { REFINED_CLASSES, refinedGearFamilies } from "../src/art/refinedPixelSources";

beforeEach(() => vi.resetModules());
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function fakeImages() {
  class FakeImage {
    static all: FakeImage[] = [];
    onload: (() => void) | null = null; onerror: (() => void) | null = null;
    src = ""; naturalWidth = 1; naturalHeight = 1;
    constructor() { FakeImage.all.push(this); }
  }
  vi.stubGlobal("Image", FakeImage); return FakeImage.all;
}
describe("refined pixel artwork", () => {
  it("maps every live class item to its own illustrated atlas cell", () => {
    for (const cls of REFINED_CLASSES) {
      const families = refinedGearFamilies(cls);
      expect(families).toHaveLength(32); expect(new Set(families).size).toBe(32);
      const items = CONTENT.items.filter(i => i.classId === cls).map(i => i.id.replace(/_(monk|warrior|mage|ranger)$/, ""));
      expect([...families].sort()).toEqual(items.sort());
    }
  });
  it("shares concurrent requests and releases failed source images", async () => {
    const images = fakeImages(), art = await import("../src/art/refinedPixelAssets");
    const results = Promise.allSettled([art.loadRefinedHero("warrior"), art.loadRefinedHero("warrior"), art.loadRefinedHero("mage")]);
    expect(images).toHaveLength(3);
    images.forEach(i => i.onerror?.());
    expect((await results).every(r => r.status === "rejected")).toBe(true);
    expect(art.refinedReady("warrior")).toBe(false); expect(art.refinedDecodedBytes()).toBe(0);
    expect(images.every(i => i.src === "")).toBe(true);
  });
  it("rejects malformed dimensions and permits a retry", async () => {
    const images = fakeImages(), art = await import("../src/art/refinedPixelAssets");
    const first = expect(art.loadRefinedHero("monk")).rejects.toThrow("Invalid refined pixel atlas");
    images.forEach(i => i.onload?.()); await first;
    const retry = expect(art.loadRefinedHero("monk")).rejects.toThrow("unavailable");
    expect(images).toHaveLength(4); images.slice(2).forEach(i => i.onerror?.()); await retry;
  });
  it("times out missing images so artwork cannot block play", async () => {
    vi.useFakeTimers(); fakeImages(); const art = await import("../src/art/refinedPixelAssets");
    const failure = expect(art.loadRefinedHero("ranger")).rejects.toThrow("timeout");
    await vi.advanceTimersByTimeAsync(10000); await failure;
    expect(art.refinedReady("ranger")).toBe(false); expect(art.refinedDecodedBytes()).toBe(0);
  });
});
