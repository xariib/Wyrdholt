import { afterEach, describe, expect, it, vi } from "vitest";
import { Texture } from "pixi.js";
import { TextureBank } from "../src/render/textures";
import { CombatRenderer } from "../src/render/CombatRenderer";
import type { ArtAsset } from "../src/art/types";
import { actorPack } from "../src/art/darkwood";
import { ProductionMotion } from "../src/render/productionMotion";
import * as refinedArt from "../src/art/refinedPixelArt";
import * as equippedArt from "../src/art/gearArt";
import * as attackEffects from "../src/render/attackEffects";

vi.mock("pixi.js/unsafe-eval", () => ({}));
vi.mock("pixi.js", () => ({
  Application: class {}, Container: class {}, Graphics: class {}, Sprite: class {},
  TextureSource: { defaultOptions: {} },
  Rectangle: class { constructor(public x: number, public y: number, public width: number, public height: number) {} },
  Texture: class {
    source: object; frame: unknown; destroy = vi.fn();
    constructor(options: { source?: object; frame?: unknown } = {}) { this.source = options.source ?? {}; this.frame = options.frame; }
    static from() { return new this(); }
  },
}));

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("recovery presentation", () => {
  it("shows the new run's full health and living pose during rest after defeat", () => {
    const hero = { alive: false, hp100: 0, shownHp100: 0, max100: 10000,
      motion: new ProductionMotion(actorPack.monk!), statuses: new Set(["poison"]),
      deathAt: 100, flashAt: 100, ward100: 0, wardPhase: "off" };
    hero.motion.death(100);
    const renderer = Object.assign(Object.create(CombatRenderer.prototype), {
      actors: new Map([["hero", hero]]), floatNumber: vi.fn(),
    });
    renderer.showRecovery({ heroMaxHp100: 12000, carriedHp100: null });
    expect(hero).toMatchObject({ alive: true, hp100: 12000, max100: 12000 });
    expect(hero.motion.pose).toBe("idle");
    expect(hero.statuses.size).toBe(0);
    const recoveredMotion = hero.motion;
    renderer.showRecovery({ heroMaxHp100: 12000, carriedHp100: null });
    expect(hero.motion).toBe(recoveredMotion);
    expect(renderer.floatNumber).not.toHaveBeenCalled();
  });
  it("preserves carried damage between stages and announces each recovery only once", () => {
    const hero = { alive: true, hp100: 3000, max100: 10000, statuses: new Set(["bleed"]) };
    const renderer = Object.assign(Object.create(CombatRenderer.prototype), {
      actors: new Map([["hero", hero]]), floatNumber: vi.fn(),
    });
    renderer.showRecovery({ heroMaxHp100: 12000, carriedHp100: 4500 });
    renderer.showRecovery({ heroMaxHp100: 12000, carriedHp100: 4500 });
    expect(hero).toMatchObject({ alive: true, hp100: 4500, max100: 12000 });
    expect(renderer.floatNumber).toHaveBeenCalledOnce();
    expect(renderer.floatNumber.mock.calls[0][1]).toBe(15);
    expect(hero.statuses.size).toBe(0);
  });
});

describe("weapon-driven attack playback", () => {
  it("keeps an incoming impact on the moving character instead of its home slot", () => {
    const draw = vi.spyOn(attackEffects, "drawAttackImpact").mockImplementation(() => {});
    const body = { x: 0, y: 0, scale: { x: 1, y: 1 } };
    const src = { root: { x: 150, y: 100 }, body, tex: { anchorY: 60, height: 60 }, attackName: "wolf" };
    const target = { baseX: 40, root: { x: 105, y: 100 }, body, tex: { anchorY: 64, height: 64 } };
    const renderer = Object.assign(Object.create(CombatRenderer.prototype), { effects: [], fxLayer: { addChild: vi.fn() } });
    renderer.attackImpact(src, target, 1000, false, "basic");
    renderer.effects[0].update({}, .1);
    expect(draw.mock.calls[0][4]).toEqual([105, 68]);
    target.root.x = 90;
    renderer.effects[0].update({}, .2);
    expect(draw.mock.calls[1][4]).toEqual([90, 68]);
  });
  it("flashes the actual attack pose immediately while the damage recoil waits for recovery", () => {
    const point = () => ({ x: 0, y: 0, set: vi.fn(), copyFrom: vi.fn() });
    const texture = {}, tex = { asset: {}, frames: [{ normal: texture }], normal: texture, anchorX: 32, anchorY: 56, width: 64, height: 64 };
    const motion = new ProductionMotion(actorPack.monk!, true);
    motion.attack(1000, 1000); motion.hit(1100, false);
    const actor = { motion, isHero: true, alive: true, spriteName: "monk", attackName: "unarmed",
      root: { position: point() }, body: { texture: {}, anchor: point(), scale: point(), position: point() },
      flash: { alpha: 0, anchor: point(), scale: point(), position: point() }, flashAt: 1100, flashAbsorbed: false,
      baseX: 50, minX: 0, maxX: 200, groundOffset: 0, vfx: new Map(), tex, wardPhase: "off" };
    const renderer = Object.assign(Object.create(CombatRenderer.prototype), {
      sprites: { get: () => tex, optional: () => tex }, actors: new Map(), ground: () => 100,
    });
    renderer.animateProduction(actor, 1110);
    expect(motion.pose).toBe("attack");
    expect(actor.flash).toMatchObject({ texture, tint: 0xffa69b });
    expect(actor.flash.alpha).toBeGreaterThan(0);
    expect(actor.flash.anchor.copyFrom).toHaveBeenCalledWith(actor.body.anchor);
    actor.flashAbsorbed = true;
    renderer.animateProduction(actor, 1120);
    expect(actor.flash.alpha).toBe(0);
  });
  it.each(["mage", "ranger", "warrior", "monk"])("does not preroll projectiles or weapon contacts for unarmed %s", spriteName => {
    const motion = new ProductionMotion(actorPack.monk!);
    const attack = vi.spyOn(motion, "scheduledAttack");
    const src = { spriteName, attackName: "unarmed", motion, alive: true, targetId: "", lungeAt: 0 };
    const target = { alive: true };
    const renderer = Object.assign(Object.create(CombatRenderer.prototype), {
      actors: new Map([["hero", src], ["enemy", target]]), cursor: 0,
      events: [{ type: "attack", t: 1000, src: "hero", tgt: "enemy" }],
      prerolled: new Set(), launched: new Set(), artEffects: [], attackArt: vi.fn(), artBurst: vi.fn(),
    });
    const lead = actorPack.monk!.animations.attack.ms[0]!;
    renderer.prerollAttacks(1000 - lead - 100, 500);
    expect(attack).not.toHaveBeenCalled();
    renderer.prerollAttacks(1000 - lead, 600);
    expect(attack).toHaveBeenCalledOnce();
    renderer.prerollAttacks(999, 700);
    expect(renderer.attackArt).not.toHaveBeenCalled();
    expect(renderer.launched.size).toBe(0);
    renderer.contactArt(src, target, 700, true);
    expect(renderer.artBurst).not.toHaveBeenCalled();
  });
});

describe("animation texture ownership", () => {
  it("does not re-enter scene construction when detailed character art is already loaded", () => {
    vi.spyOn(refinedArt, "refinedReady").mockReturnValue(true);
    vi.spyOn(equippedArt, "gearAtlas").mockReturnValue({ width: 512, height: 128 } as HTMLCanvasElement);
    const changed = vi.fn(), uploads = vi.spyOn(Texture, "from"), bank = new TextureBank(changed);
    const actor = bank.optional("characters/monk");
    expect(actor?.frames).toHaveLength(4);
    expect(changed).not.toHaveBeenCalled();
    expect(uploads).toHaveBeenCalledWith(expect.objectContaining({ resolution: 2, scaleMode: "nearest" }));
    bank.dispose();
  });
  function fixture(darkwood: boolean): ArtAsset {
    return {
      id: "characters/monk", file: darkwood ? "art/darkwood/monk.png" : "art/characters/monk.png", approved: true,
      atlasWidth: 32, atlasHeight: 16, width: 16, height: 16,
      anchor: { x: 8, y: 16 }, facing: "right", pixelsPerUnit: 1,
      attachments: { head: { x: 8, y: 2 }, chest: { x: 8, y: 8 }, feet: { x: 8, y: 16 } },
      frames: [{ x: 0, y: 0, durationMs: 100 }, { x: 16, y: 0, durationMs: 100 }],
      clips: { idle: { frames: [0, 1], loop: true }, attack: { frames: [0], loop: false }, hit: { frames: [0], loop: false }, death: { frames: [1], loop: false } },
    };
  }
  function browserMocks() {
    const images: { onload: (() => void) | null }[] = [];
    const whitePaint = vi.fn();
    vi.stubGlobal("Image", class {
      onload = null; onerror = null; src = ""; naturalWidth = 32; naturalHeight = 16;
      constructor() { images.push(this); }
    });
    vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage: vi.fn(), fillRect: whitePaint }) }) });
    return { images, whitePaint };
  }
  it.each([true, false])("retains correct flash pixels and releases each unique texture once (Darkwood=%s)", async darkwood => {
    const { images, whitePaint } = browserMocks();
    const uploads = vi.spyOn(Texture, "from");
    const a = fixture(darkwood), changed = vi.fn(), bank = new TextureBank(changed, () => a);
    bank.optional(a.id);
    images[0]!.onload!();
    await Promise.resolve();
    const frames = bank.optional(a.id)!.frames;
    expect(changed).toHaveBeenCalledOnce();
    expect(images).toHaveLength(1);
    for (const frame of frames) expect(frame.normal === frame.flash).toBe(darkwood);
    expect(whitePaint).toHaveBeenCalledTimes(darkwood ? 0 : 2);
    // Atlas views cost no additional decoded pixels; legacy white silhouettes do.
    expect(bank.decodedBytes).toBe(32 * 16 * 4 + (darkwood ? 0 : 2 * 16 * 16 * 8));
    if (darkwood) {
      expect(frames[0]!.normal.source).toBe(frames[1]!.normal.source);
      expect(frames[1]!.normal.frame).toMatchObject({ x: 16, y: 0, width: 16, height: 16 });
    }
    bank.dispose(); bank.dispose();
    for (const texture of new Set(frames.flatMap(f => [f.normal, f.flash]))) expect(texture.destroy).toHaveBeenCalledExactlyOnceWith(!darkwood);
    expect(uploads).toHaveBeenCalledTimes(darkwood ? 1 : 4);
    for (const upload of uploads.mock.results) expect(upload.value.destroy).toHaveBeenCalledExactlyOnceWith(true);
    expect(bank.decodedBytes).toBe(0);
  });
  it("never publishes textures after its scene has been disposed", async () => {
    browserMocks();
    const changed = vi.fn(), bank = new TextureBank(changed, () => fixture(true));
    bank.optional("characters/monk"); bank.dispose();
    await Promise.resolve(); await Promise.resolve();
    expect(changed).not.toHaveBeenCalled();
    expect(bank.decodedBytes).toBe(0);
  });
});

describe("combat HUD geometry cache", () => {
  const graphics = () => {
    const g = { clear: vi.fn(), rect: vi.fn(), fill: vi.fn(), poly: vi.fn() };
    for (const fn of Object.values(g)) fn.mockReturnValue(g);
    return g;
  };
  function fixture() {
    const actor = {
      motion: {}, isHero: true, tex: { width: 16 }, barOffset: -30,
      max100: 10000, shownHp100: 10000, ward100: 0, wardCap100: 0, alive: true,
      statuses: new Set<string>(), bar: graphics(), pips: graphics(),
    };
    // Exercise production drawing without requiring a WebGL context in Node.
    const renderer = Object.create(CombatRenderer.prototype) as { drawBar(a: typeof actor): void };
    return { actor, draw: () => renderer.drawBar(actor) };
  }
  it("does no geometry work for unchanged pixels, including subpixel HP changes", () => {
    const { actor, draw } = fixture(); draw();
    actor.shownHp100--;
    for (let i = 0; i < 1000; i++) draw();
    expect(actor.bar.clear).toHaveBeenCalledOnce();
    expect(actor.pips.clear).toHaveBeenCalledOnce();
    actor.shownHp100 = 5000; draw();
    expect(actor.bar.clear).toHaveBeenCalledTimes(2);
  });
  it("updates the low-health color even when rounded bar width is unchanged", () => {
    const { actor, draw } = fixture(); actor.shownHp100 = 3000; draw();
    actor.shownHp100 = 2999; draw();
    expect(actor.bar.clear).toHaveBeenCalledTimes(2);
    expect(actor.bar.fill).toHaveBeenCalledWith(0xf08a3a);
  });
  it("updates ward capacity, its last sliver, death shield, and layout", () => {
    const { actor, draw } = fixture(); draw();
    actor.wardCap100 = 10000; draw();
    actor.ward100 = 1; draw();
    actor.alive = false; draw();
    actor.barOffset -= 4; draw();
    actor.wardCap100 = 0; draw();
    expect(actor.bar.clear).toHaveBeenCalledTimes(6);
    expect(actor.pips.clear).toHaveBeenCalledTimes(4);
  });
  it("updates status replacements and order without repainting health", () => {
    const { actor, draw } = fixture(); draw();
    actor.statuses.add("poison"); draw();
    actor.statuses.clear(); actor.statuses.add("bleed:rend"); draw();
    actor.statuses.add("burn"); draw();
    actor.statuses.delete("bleed:rend"); actor.statuses.add("bleed:rend"); draw();
    actor.statuses.clear(); draw();
    expect(actor.pips.clear).toHaveBeenCalledTimes(6);
    expect(actor.bar.clear).toHaveBeenCalledOnce();
  });
});
