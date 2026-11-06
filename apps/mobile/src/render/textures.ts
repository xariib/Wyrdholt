import { Texture } from "pixi.js";
import { SPRITES, spriteCanvas } from "./pixelArt";
import { asset, actorId } from "../art/manifest";
import { ArtScope, frameCanvas } from "../art/load";
import { ART_BUDGET, type ArtAsset, type ArtId } from "../art/types";

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
  private disposed = false;
  private frameBytes = 0;
  constructor(private readonly changed: () => void, private readonly resolveAsset: (id: ArtId) => ArtAsset | undefined = asset) {}
  get decodedBytes(): number { return this.scope.decodedBytes + this.frameBytes; }
  private texture(canvas: HTMLCanvasElement): Texture {
    const t = Texture.from({ resource: canvas, scaleMode: "nearest" });
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
    const bytes = a.frames.length * a.width * a.height * 8;
    if (this.decodedBytes + bytes + a.atlasWidth * a.atlasHeight * 4 > ART_BUDGET.maxDecodedBytes) return;
    void this.scope.load(a).then(image => {
      if (this.disposed) return;
      if (this.decodedBytes + bytes > ART_BUDGET.maxDecodedBytes) return;
      const frames = a.frames.map((_, i) => ({ normal: this.texture(frameCanvas(a, image, i)), flash: this.texture(frameCanvas(a, image, i, !a.file.startsWith("art/darkwood/"))) }));
      const first = frames[a.clips.idle.frames[0]!]!;
      this.textures.set(id, { ...first, width: a.width, height: a.height, anchorX: a.anchor.x, anchorY: a.anchor.y, scale: 1 / a.pixelsPerUnit, facing: a.facing, frames, asset: a });
      this.changed();
    }).catch(() => { /* Keep the existing silhouette if an approved file is unavailable. */ });
  }
  dispose(): void {
    this.disposed = true;
    this.scope.dispose();
    for (const t of this.owned) t.destroy(true);
    this.owned.clear();
    this.textures.clear();
    this.frameBytes = 0;
  }
}
