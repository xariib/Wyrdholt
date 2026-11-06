/** Presentation only. No simulation module may import this contract. */
export type ArtCategory = "characters" | "enemies" | "backgrounds" | "vfx" | "icons";
export type ArtId = `${ArtCategory}/${string}`;
export type Pose = "idle" | "attack" | "hit" | "death";
export interface Point { x: number; y: number }
export interface ArtFrame { x: number; y: number; durationMs: number }
export interface ArtClip { frames: number[]; loop: boolean }
export interface ArtAsset {
  id: ArtId;
  /** Relative to public/. Only approved, locally packaged PNGs. */
  file: string;
  approved: true;
  atlasWidth: number;
  atlasHeight: number;
  width: number;
  height: number;
  anchor: Point;
  facing: "left" | "right";
  /** Native pixels per logical pixel; use 1 unless the approved pack needs otherwise. */
  pixelsPerUnit: number;
  attachments: { head: Point; chest: Point; feet: Point };
  frames: ArtFrame[];
  clips: Record<Pose, ArtClip>;
}
export interface EnvironmentLayer {
  asset: ArtId;
  plane: "distant" | "midground" | "ground" | "foreground" | "atmosphere";
  opacity: number;
}
export const ART_BUDGET = { maxAtlasSide: 2048, maxDecodedBytes: 32 * 1024 * 1024, maxFrames: 64, maxVfx: 16, maxLayers: 5 } as const;

export function animationFrame(asset: ArtAsset, pose: Pose, elapsedMs: number): number {
  const clip = asset.clips[pose];
  const duration = clip.frames.reduce((sum, i) => sum + asset.frames[i]!.durationMs, 0);
  let t = clip.loop ? Math.max(0, elapsedMs) % duration : Math.min(Math.max(0, elapsedMs), duration - 1);
  for (const i of clip.frames) {
    t -= asset.frames[i]!.durationMs;
    if (t < 0) return i;
  }
  return clip.frames[0]!;
}

export function validateArt(assets: readonly ArtAsset[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const a of assets) {
    const fail = (s: string) => errors.push(`${a.id}: ${s}`);
    if (ids.has(a.id)) fail("duplicate ID");
    ids.add(a.id);
    if (!/^(characters|enemies|backgrounds|vfx|icons)\/[a-z0-9_/-]+$/.test(a.id)) fail("invalid ID");
    if (a.approved !== true) fail("approval required");
    if (!/^art\/[a-z0-9_/-]+\.png$/.test(a.file)) fail("local PNG path required");
    if (![a.width, a.height, a.atlasWidth, a.atlasHeight].every(n => Number.isInteger(n) && n > 0 && n <= ART_BUDGET.maxAtlasSide)) fail("invalid or oversized dimensions");
    if (!Number.isInteger(a.pixelsPerUnit) || a.pixelsPerUnit < 1 || a.pixelsPerUnit > 8) fail("pixelsPerUnit must be 1–8");
    if (![a.anchor, ...Object.values(a.attachments)].every(p => Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.y >= 0 && p.x <= a.width && p.y <= a.height)) fail("anchor/attachment outside frame");
    if (a.facing !== "left" && a.facing !== "right") fail("invalid facing");
    if (!a.frames.length || a.frames.length > ART_BUDGET.maxFrames) fail("invalid frame count");
    for (const f of a.frames) {
      if (![f.x, f.y, f.durationMs].every(Number.isInteger) || f.x < 0 || f.y < 0 || f.x + a.width > a.atlasWidth || f.y + a.height > a.atlasHeight || f.durationMs <= 0) fail("invalid frame rectangle/timing");
    }
    for (const pose of ["idle", "attack", "hit", "death"] as const) {
      const clip = a.clips[pose];
      if (!clip?.frames.length || typeof clip.loop !== "boolean" || clip.frames.some(i => !Number.isInteger(i) || !a.frames[i])) fail(`invalid ${pose} clip`);
    }
  }
  return errors;
}
