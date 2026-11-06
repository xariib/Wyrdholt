import { Container, Sprite, Texture } from "pixi.js";
import { environments, asset } from "../art/manifest";
import { ArtScope, frameCanvas } from "../art/load";
import { ART_BUDGET } from "../art/types";

/** Static layers; no extra ticker, parallax, or future-zone preload. */
export class EnvironmentArt {
  readonly back = new Container();
  readonly front = new Container();
  private scope = new ArtScope();
  private textures: Texture[] = [];
  private closed = false;
  constructor(zone: string, width: number, height: number, changed: () => void) {
    const layers = (zone === "darkwood" ? [{ asset: "backgrounds/darkwood" as const, plane: "ground" as const, opacity: 1 }] : environments[zone] ?? []).slice(0, ART_BUDGET.maxLayers);
    // Containers are inserted synchronously so network completion cannot reorder layers.
    for (const layer of layers) {
      const holder = new Container();
      (layer.plane === "foreground" || layer.plane === "atmosphere" ? this.front : this.back).addChild(holder);
      const a = asset(layer.asset);
      if (!a) continue;
      void this.scope.load(a).then(image => {
        if (this.closed) return;
        const tex = Texture.from({ resource: frameCanvas(a, image, a.clips.idle.frames[0]!), scaleMode: "nearest" });
        this.textures.push(tex);
        const s = new Sprite(tex);
        // Environment art fills the logical viewport, unlike actor-native pixels.
        if (zone === "darkwood") { s.position.set(Math.round((width - a.width) / 2), height - a.height); }
        else { s.width = width; s.height = height; }
        s.alpha = layer.opacity;
        holder.addChild(s);
        changed();
      }).catch(() => { /* Procedural zone remains visible underneath. */ });
    }
  }
  dispose(): void {
    this.closed = true;
    this.scope.dispose();
    this.back.destroy({ children: true });
    this.front.destroy({ children: true });
    for (const texture of this.textures) texture.destroy(true);
  }
}
