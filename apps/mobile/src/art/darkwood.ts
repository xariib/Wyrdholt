import meta from "../../public/art/darkwood/animation_meta.json";
import type { ArtAsset, ArtId, Pose } from "./types";

export interface ProductionClip {
  frame: number[]; anchor: number[]; ms: number[]; loop: boolean;
  frames: { file: string; ms: number }[]; sprite_strip: string;
  impact_frame?: number; hold_frame?: number; min_ms?: number[]; crit_hold_ms?: number;
  fx_projectile_spawn?: number[];
}
export interface ProductionActor { animations: Record<Pose, ProductionClip>; hit_flash: string }
export interface ProductionFx {
  frame: number[]; anchor?: number[]; frames: string[]; sprite_strip: string;
  ms: number[] | Record<string, number | number[]>; segments?: Record<string, number[]>;
}
export const darkwoodMeta = meta;
export const actorPack: Record<string, ProductionActor> = { ...meta.heroes, wolf: meta.enemies.dire_wolf, spider: meta.enemies.gloom_spider };
export const fxPack = meta.vfx as Record<string, ProductionFx>;
export const productionUrl = (file: string): string => `./art/darkwood/${file}`;
const poses: Pose[] = ["idle", "attack", "hit", "death"];
export const productionActorId = (name: string): ArtId => `${name === "wolf" || name === "spider" ? "enemies" : "characters"}/${name}`;
function entry(id: ArtId, file: string, size: number[], anchor: number[], ms: number[], loop: boolean, facing: "left" | "right" = "right"): ArtAsset {
  const [width, height] = size as [number, number];
  const indices = ms.map((_, i) => i);
  const clip = { frames: indices, loop };
  return { id, file: `art/darkwood/${file}`, approved: true, width, height, atlasWidth: width * ms.length, atlasHeight: height,
    anchor: { x: anchor[0]!, y: anchor[1]! }, facing, pixelsPerUnit: 1,
    attachments: { head: { x: anchor[0]!, y: 12 }, chest: { x: anchor[0]!, y: Math.floor(height / 2) }, feet: { x: anchor[0]!, y: anchor[1]! } },
    frames: ms.map((durationMs, i) => ({ x: i * width, y: 0, durationMs: Math.max(1, durationMs) })),
    clips: { idle: clip, attack: clip, hit: clip, death: clip },
  };
}
export const darkwoodAssets: ArtAsset[] = [];
for (const [name, actor] of Object.entries(actorPack)) {
  const id = productionActorId(name), facing = name === "wolf" || name === "spider" ? "left" : "right";
  for (const pose of poses) {
    const c = actor.animations[pose];
    darkwoodAssets.push(entry(pose === "idle" ? id : `${id}/${pose}`, c.sprite_strip, c.frame, c.anchor, c.ms, c.loop, facing));
  }
  const c = actor.animations.hit;
  darkwoodAssets.push(entry(`${id}/flash`, actor.hit_flash, c.frame, c.anchor, [50], false, facing));
}
for (const [name, fx] of Object.entries(fxPack)) {
  const ms = Array.isArray(fx.ms) ? fx.ms : fx.frames.map(() => 70);
  const a = fx.anchor ?? [Math.floor(fx.frame[0]! / 2), Math.floor(fx.frame[1]! / 2)];
  const e = entry(`vfx/${name}`, fx.sprite_strip, fx.frame, a, ms, false);
  // Tiny projectile frames have no head attachment; all attachments stay within the frame.
  e.attachments.head.y = 0;
  darkwoodAssets.push(e);
}
const bg = meta.environment.darkwood_combat;
darkwoodAssets.push(entry("backgrounds/darkwood", bg.file, bg.size, [0, 0], [1], false));

/** Presentation duration fitting; never changes attack or damage timestamps. */
export function attackDurations(c: ProductionClip, interval: number, crit = false): number[] {
  const ms = [...c.ms];
  if (crit && c.hold_frame !== undefined) ms[c.hold_frame] = c.crit_hold_ms ?? ms[c.hold_frame]!;
  let excess = Math.max(0, ms.reduce((a, b) => a + b, 0) - interval);
  for (const i of [3, 0, 2]) {
    const remove = Math.min(excess, Math.max(0, ms[i]! - (c.min_ms?.[i] ?? 0)));
    ms[i] = ms[i]! - remove; excess -= remove;
  }
  return ms;
}
export function sequenceIndex(ms: readonly number[], elapsed: number, loop = false): number {
  const total = ms.reduce((a, b) => a + b, 0);
  let t = loop && total ? Math.max(0, elapsed) % total : Math.max(0, elapsed);
  for (let i = 0; i < ms.length; i++) { if (t < ms[i]!) return i; t -= ms[i]!; }
  return ms.length - 1;
}
