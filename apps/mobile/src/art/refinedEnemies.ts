import meta from "../../public/art/darkwood/animation_meta.json";
import { pacedClip, type ProductionActor, type ProductionClip } from "./darkwood";
import type { ArtAsset, Pose } from "./types";

/** Existing enemy identities, illustrated on the same two-pixel grid as the heroes. */
export const ENEMY_SOURCES = {
  greenfields: { file: "art/refined-pixel/enemies/greenfields-source-v1.png", width: 1086, height: 1448, columns: 3, rows: 4 },
  darkwood: { file: "art/refined-pixel/enemies/darkwood-source-v1.png", width: 1086, height: 1448, columns: 3, rows: 4 },
  ashen: { file: "art/refined-pixel/enemies/ashen-source-v1.png", width: 793, height: 1983, columns: 2, rows: 5 },
} as const;
export const ENEMY_DESIGNS = [
  { name: "slime", zone: "greenfields", cell: [0, 0], height: 42 },
  { name: "boar", zone: "greenfields", cell: [1, 0], height: 72 },
  { name: "wolf", zone: "greenfields", cell: [2, 0], height: 72 },
  { name: "boar_elite", zone: "greenfields", cell: [0, 2], height: 82 },
  { name: "root_boss", zone: "greenfields", cell: [1, 2], height: 110 },
  { name: "sprout", zone: "greenfields", cell: [2, 2], height: 62 },
  { name: "spider", zone: "darkwood", cell: [0, 0], height: 58 },
  { name: "wisp", zone: "darkwood", cell: [1, 0], height: 86 },
  { name: "brute", zone: "darkwood", cell: [2, 0], height: 100 },
  { name: "warden", zone: "darkwood", cell: [0, 2], height: 104 },
  { name: "matron", zone: "darkwood", cell: [1, 2], height: 110 },
  { name: "imp", zone: "ashen", cell: [0, 0], height: 72 },
  { name: "hound", zone: "ashen", cell: [0, 1], height: 70 },
  { name: "golem", zone: "ashen", cell: [0, 2], height: 104 },
  { name: "warlord", zone: "ashen", cell: [0, 3], height: 108 },
  { name: "drake", zone: "ashen", cell: [0, 4], height: 98 },
] as const;
export type RefinedEnemy = typeof ENEMY_DESIGNS[number]["name"];
export const isRefinedEnemy = (name: string): name is RefinedEnemy => ENEMY_DESIGNS.some(d => d.name === name);
export const ENEMY_PIXEL_SCALE = 2;
export const ENEMY_ATLAS = { columns: 4, cellWidth: 144, cellHeight: 128, width: 576, height: 512 } as const;
const poses: Pose[] = ["idle", "attack", "hit", "death"];
const defaults: Record<Pose, number[]> = { idle: [200, 200, 200, 200], attack: [150, 60, 110, 150], hit: [80, 120], death: [100, 140, 170, 1] };
export const refinedEnemyActors: Record<string, ProductionActor> = {};
export const refinedEnemyAssets: ArtAsset[] = [];

for (const design of ENEMY_DESIGNS) {
  const original = design.name === "wolf" ? meta.enemies.dire_wolf : design.name === "spider" ? meta.enemies.gloom_spider : undefined;
  const animations = {} as Record<Pose, ProductionClip>;
  let offset = 0;
  const file = `art/refined-pixel/enemies/${design.name}-v1.png`;
  for (const pose of [...poses, "flash"] as const) {
    const old = original?.animations[pose === "flash" ? "hit" : pose];
    const size = old?.frame ?? [64, 64], anchor = old?.anchor ?? [32, 60];
    const timing = pose === "flash" ? undefined : pacedClip({
      ...old, frame: [...size], anchor: [...anchor], ms: [...(old?.ms ?? defaults[pose])],
      loop: pose === "idle", frames: [], sprite_strip: file,
      ...(pose === "attack" && !old ? { impact_frame: 1, min_ms: [60, 60, 60, 60], hold_frame: 2, crit_hold_ms: 140 } : {}),
    }, pose);
    const ms = timing ? timing.ms.map(t => Math.max(1, t)) : [50];
    const indices = ms.map((_, i) => i), clip = { frames: indices, loop: pose === "idle" };
    refinedEnemyAssets.push({
      id: `enemies/${design.name}${pose === "idle" ? "" : `/${pose}`}`, file, approved: true,
      atlasWidth: ENEMY_ATLAS.width, atlasHeight: ENEMY_ATLAS.height,
      width: size[0]! * 2, height: size[1]! * 2, anchor: { x: anchor[0]! * 2, y: anchor[1]! * 2 },
      facing: "left", pixelsPerUnit: 2,
      attachments: { head: { x: anchor[0]! * 2, y: 16 }, chest: { x: anchor[0]! * 2, y: size[1]! }, feet: { x: anchor[0]! * 2, y: anchor[1]! * 2 } },
      frames: ms.map((durationMs, i) => ({ x: ((offset + i) % 4) * 144, y: Math.floor((offset + i) / 4) * 128, durationMs })),
      clips: { idle: clip, attack: clip, hit: clip, death: clip },
    });
    if (pose !== "flash") animations[pose] = {
      ...timing!, ms,
      frames: ms.map(t => ({ file, ms: t })), sprite_strip: file,
    };
    offset += ms.length;
  }
  refinedEnemyActors[design.name] = { animations, hit_flash: file };
}
