import { describe, it, expect, vi, afterEach } from "vitest";
import { animationFrame, validateArt, type ArtAsset } from "../src/art/types";
import { actorId, HEROES, SLOT_ICONS } from "../src/art/manifest";
import { ArtScope } from "../src/art/load";

const fixture = (): ArtAsset => ({
  id: "characters/monk", file: "art/characters/monk.png", approved: true,
  atlasWidth: 32, atlasHeight: 16, width: 16, height: 16, anchor: { x: 8, y: 16 }, facing: "right", pixelsPerUnit: 1,
  attachments: { head: { x: 8, y: 2 }, chest: { x: 8, y: 8 }, feet: { x: 8, y: 16 } },
  frames: [{ x: 0, y: 0, durationMs: 100 }, { x: 16, y: 0, durationMs: 200 }],
  clips: { idle: { frames: [0, 1], loop: true }, attack: { frames: [0, 1], loop: false }, hit: { frames: [0], loop: false }, death: { frames: [1], loop: false } },
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("presentation art contract", () => {
  it("keeps class and slot identities central", () => {
    expect(HEROES.map(actorId)).toEqual(["characters/warrior", "characters/monk", "characters/mage", "characters/ranger"]);
    expect(Object.keys(SLOT_ICONS)).toHaveLength(6);
    expect(actorId("matron")).toBe("enemies/matron");
  });
  it("loops idle while non-looping poses hold their last complete frame", () => {
    const a = fixture();
    expect([0, 99, 100, 299, 300].map(t => animationFrame(a, "idle", t))).toEqual([0, 0, 1, 1, 0]);
    expect(animationFrame(a, "attack", 99999)).toBe(1);
    expect(animationFrame(a, "idle", -1)).toBe(0);
  });
  it("rejects duplicate IDs, out-of-atlas frames, missing clips and external files", () => {
    const a = fixture();
    expect(validateArt([a])).toEqual([]);
    expect(validateArt([a, a]).join()).toContain("duplicate");
    a.frames[1]!.x = 30; a.file = "https://example.com/art.png"; a.clips.hit.frames = [50];
    expect(validateArt([a]).join()).toMatch(/local PNG.*frame rectangle.*hit clip/);
  });
  it("rejects oversized textures, invalid foot anchors and fractional pixel scale", () => {
    const a = fixture(); a.atlasWidth = 4096; a.anchor.y = 50; a.pixelsPerUnit = 1.5;
    expect(validateArt([a])).toHaveLength(3);
  });
  it("coalesces scoped requests and rejects a late result after disposal", async () => {
    class FakeImage { onload: (() => void) | null = null; onerror: (() => void) | null = null; src = ""; naturalWidth = 32; naturalHeight = 16; }
    vi.stubGlobal("Image", FakeImage);
    const scope = new ArtScope(); const a = fixture();
    const first = scope.load(a); expect(scope.load(a)).toBe(first);
    const failure = expect(first).rejects.toThrow("disposed");
    scope.dispose(); await failure;
    expect(scope.decodedBytes).toBe(0);
    await expect(scope.load(a)).rejects.toThrow("closed");
  });
  it("bounds a hung art request without touching game state", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Image", class { onload = null; onerror = null; src = ""; });
    const scope = new ArtScope();
    const failure = expect(scope.load(fixture())).rejects.toThrow("timeout");
    await vi.advanceTimersByTimeAsync(10000); await failure; scope.dispose();
  });
});
