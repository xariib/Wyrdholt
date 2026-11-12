import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => vi.resetModules());
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function browserImages() {
  class FakeImage {
    static all: FakeImage[] = [];
    onload: (() => void) | null = null; onerror: (() => void) | null = null; src = "";
    naturalWidth = 384; naturalHeight = 256;
    constructor() { FakeImage.all.push(this); }
    finish() { if(this.src.includes("headgear")) {this.naturalWidth=512;this.naturalHeight=128;} this.onload?.(); }
  }
  vi.stubGlobal("Image", FakeImage); return FakeImage.all;
}
describe("painted character loading", () => {
  it("shares equipment requests across classes and counts physical decoded pixels", async () => {
    const images = browserImages(), art = await import("../src/art/paintedHeroes");
    const first = art.loadPaintedHero("monk"), again = art.loadPaintedHero("monk"), other = art.loadPaintedHero("mage");
    expect(images).toHaveLength(4); expect(art.paintedReady("monk")).toBe(false);
    images.forEach(i=>i.finish()); await Promise.all([first,again,other]);
    expect(art.paintedReady("monk")).toBe(true); expect(art.paintedReady("warrior")).toBe(false);
    expect(art.paintedDecodedBytes()).toBe((384*256*3+512*128)*4);
  });
  it("rejects mismatched source dimensions and permits a later retry", async () => {
    const images = browserImages(), art = await import("../src/art/paintedHeroes");
    const failure = expect(art.loadPaintedHero("warrior")).rejects.toThrow("Invalid painted atlas");
    images[0]!.naturalWidth=1;images.forEach(i=>i.finish());await failure;
    expect(art.paintedReady("warrior")).toBe(false);
    const retry = art.loadPaintedHero("warrior");expect(images).toHaveLength(4);images[3]!.finish();await retry;
    expect(art.paintedReady("warrior")).toBe(true);
  });
  it("bounds hung requests and leaves the character eligible for fallback", async () => {
    vi.useFakeTimers();browserImages();const art=await import("../src/art/paintedHeroes");
    const failure=expect(art.loadPaintedHero("ranger")).rejects.toThrow("timeout");
    await vi.advanceTimersByTimeAsync(10000);await failure;
    expect(art.paintedReady("ranger")).toBe(false);expect(art.paintedDecodedBytes()).toBe(0);
  });
});
