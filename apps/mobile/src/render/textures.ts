import { Rectangle, Texture } from "pixi.js";
import { SPRITES, spriteCanvas } from "./pixelArt";
import { asset, actorId } from "../art/manifest";
import { ArtScope, frameCanvas } from "../art/load";
import { ART_BUDGET, type ArtAsset, type ArtId } from "../art/types";
import { gearAtlas } from "../art/gearArt";
import { bareAppearance, isHeroClass, type HeroAppearance } from "../art/gearSkins";
import { loadRefinedHero, refinedReady, refinedDecodedBytes, refinedLayerBytes, REFINED_PIXEL_SCALE } from "../art/refinedPixelArt";

export interface SpriteTextures {
  normal: Texture; flash: Texture;
  width: number; height: number; anchorX: number; anchorY: number;
  scale: number; facing: "left" | "right";
  frames: { normal: Texture; flash: Texture }[];
  asset?: ArtAsset;
}

/** Only the current composition is resident. Late loads cannot replace a disposed scene. */
export class TextureBank {
  private scope = new ArtScope();
  private textures = new Map<string, SpriteTextures>();
  private pending = new Set<string>();
  private owned = new Set<Texture>();
  private views = new Set<Texture>();
  private disposed = false;
  private frameBytes = 0;
  constructor(private readonly changed: () => void, private readonly resolveAsset: (id: ArtId) => ArtAsset | undefined = asset,
    private readonly appearance?: HeroAppearance) {}
  get decodedBytes(): number { return this.scope.decodedBytes + this.frameBytes + (this.disposed ? 0 : refinedDecodedBytes() + refinedLayerBytes()); }
  private texture(canvas: HTMLCanvasElement, resolution = 1): Texture {
    const t = Texture.from({ resource: canvas, scaleMode: "nearest", resolution });
    this.owned.add(t);
    this.frameBytes += canvas.width * canvas.height * 4;
    return t;
  }
  get(name: string): SpriteTextures {
    const id = actorId(name);
    let tex = this.textures.get(id);
    if (!tex) {
      const def = SPRITES[name] ?? SPRITES.slime!;
      const normal = this.texture(spriteCanvas(def));
      const flash = this.texture(spriteCanvas(def, "#ffffff"));
      tex = { normal, flash, width: def.rows[0]!.length, height: def.rows.length, anchorX: def.anchorX, anchorY: def.rows.length, scale: 1, facing: "right", frames: [{ normal, flash }] };
      this.textures.set(id, tex);
    }
    this.request(id);
    return this.textures.get(id)!;
  }
  optional(id: ArtId): SpriteTextures | undefined { this.request(id); return this.textures.get(id); }
  private request(id: ArtId): void {
    const a = this.resolveAsset(id);
    if (!a || this.pending.has(id) || this.disposed) return;
    this.pending.add(id);
    const name = id.split("/")[1]!;
    if (id.startsWith("characters/") && isHeroClass(name) && this.resolveAsset === asset) {
      const publish = (notify = true) => {
        if (this.disposed) return;
        const resolution = refinedReady(name) ? REFINED_PIXEL_SCALE : 1;
        const bytes = a.atlasWidth * a.atlasHeight * 4 * resolution * resolution;
        if (this.decodedBytes + bytes > ART_BUDGET.maxDecodedBytes) return;
        const look = this.appearance?.classId === name ? this.appearance : bareAppearance(name);
        const atlas = this.texture(gearAtlas(a, look), resolution);
        const frames = a.frames.map(f => {
          const normal = new Texture({ source: atlas.source, frame: new Rectangle(f.x, f.y, a.width, a.height) });
          this.views.add(normal); return { normal, flash: normal };
        });
        const first = frames[a.clips.idle.frames[0]!]!;
        this.textures.set(id, { ...first, width: a.width, height: a.height, anchorX: a.anchor.x, anchorY: a.anchor.y,
          scale: 1, facing: a.facing, frames, asset: a });
        if (notify) this.changed();
      };
      if (refinedReady(name)) publish(false);
      else void loadRefinedHero(name).then(() => publish()).catch(() => publish());
      return;
    }
    // Darkwood supplies its own flash poses. Read frames directly from the atlas:
    // no per-frame canvas copies, duplicate flash pixels, or per-frame GPU uploads.
    const separateFlash = !a.file.startsWith("art/darkwood/");
    const bytes = separateFlash ? a.frames.length * a.width * a.height * 8 : 0;
    if (this.decodedBytes + bytes + a.atlasWidth * a.atlasHeight * 4 > ART_BUDGET.maxDecodedBytes) return;
    void this.scope.load(a).then(image => {
      if (this.disposed) return;
      if (this.decodedBytes + bytes > ART_BUDGET.maxDecodedBytes) return;
      let frames: SpriteTextures["frames"];
      if (separateFlash) {
        frames = a.frames.map((_, i) => ({ normal: this.texture(frameCanvas(a, image, i)), flash: this.texture(frameCanvas(a, image, i, true)) }));
      } else {
        const atlas = Texture.from({ resource: image, scaleMode: "nearest" });
        this.owned.add(atlas); // The image bytes are already counted by ArtScope.
        frames = a.frames.map(f => {
          const normal = new Texture({ source: atlas.source, frame: new Rectangle(f.x, f.y, a.width, a.height) });
          this.views.add(normal);
          return { normal, flash: normal };
        });
      }
      const first = frames[a.clips.idle.frames[0]!]!;
      this.textures.set(id, { ...first, width: a.width, height: a.height, anchorX: a.anchor.x, anchorY: a.anchor.y, scale: 1 / a.pixelsPerUnit, facing: a.facing, frames, asset: a });
      this.changed();
    }).catch(() => { /* Keep the existing silhouette if an approved file is unavailable. */ });
  }
  dispose(): void {
    this.disposed = true;
    this.scope.dispose();
    // Frame views share an atlas source. Only its owning texture destroys it.
    for (const t of this.views) t.destroy(false);
    this.views.clear();
    for (const t of this.owned) t.destroy(true);
    this.owned.clear();
    this.textures.clear();
    this.frameBytes = 0;
  }
}
