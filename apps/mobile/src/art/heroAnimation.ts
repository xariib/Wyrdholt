import type { ArtAsset } from "./types";
import type { HeroClass } from "./gearSkins";

/** Eight visual keys inside the existing four combat phases. No gameplay timing. */
export interface HeroAttackKey { strike: boolean; lean: number; sink: number; angle: number }
const keys = (strike: boolean[], lean: number[], sink: number[], angle: number[]): HeroAttackKey[] =>
  lean.map((value, i) => ({ strike: strike[i]!, lean: value, sink: sink[i]!, angle: angle[i]! }));
const body = [false, false, true, true, true, true, false, false];
export const HERO_ATTACK_KEYS: Record<HeroClass, readonly HeroAttackKey[]> = {
  warrior: keys(body, [-1, -2, 2, 2.5, 2, 1, .5, 0], [1, 2, 1, 2, 2, 1, .5, 0], [-.4, -.65, 1.15, 1.4, 1.7, 1.8, .5, .12]),
  monk: keys(body, [-1, -2, 2.5, 3, 2, 1, .5, 0], [1, 2, 0, .5, 1, 1, .5, 0], [0, 0, 0, 0, 0, 0, 0, 0]),
  // Positive rotation takes the staff crown toward the target, away from the face.
  mage: keys(body, [-.5, -1, 1, 1.5, 1, .5, .25, 0], [.5, 1, 0, .5, .5, .5, .25, 0], [1.2, 1.25, .95, 1.05, 1.15, 1.05, 1.25, 1.2]),
  ranger: keys([true, true, true, true, true, true, false, false], [-1, -1.5, .5, 1, .5, 0, -.25, 0], [1, 1.5, .5, .5, 1, 1, .5, 0], [-.08, -.1, .02, .08, .12, .06, .02, 0]),
};

export function heroAnimationAsset(a: ArtAsset): ArtAsset {
  if (!/^characters\/(monk|mage|warrior|ranger)\/attack$/.test(a.id)) return a;
  const width = a.width + 16;
  const frames = a.frames.flatMap((f, phase) => [0, 1].map(sub => ({
    x: (phase * 2 + sub) * width, y: 0,
    durationMs: Math.max(1, sub ? f.durationMs - Math.floor(f.durationMs / 2) : Math.floor(f.durationMs / 2)),
  })));
  const clip = { frames: frames.map((_, i) => i), loop: false };
  return { ...a, width, anchor: { ...a.anchor, x: a.anchor.x + 8 },
    attachments: { head: { ...a.attachments.head, x: a.attachments.head.x + 8 }, chest: { ...a.attachments.chest, x: a.attachments.chest.x + 8 }, feet: { ...a.attachments.feet, x: a.attachments.feet.x + 8 } },
    atlasWidth: width * frames.length, frames, clips: { idle: clip, attack: clip, hit: clip, death: clip } };
}

/** Select within the sampled phase, including the mandatory late-frame impact hold. */
export function heroAttackFrame(phase: number, elapsed: number, durations: readonly number[]): number {
  const start = durations.slice(0, phase).reduce((n, ms) => n + ms, 0);
  return phase * 2 + (elapsed - start >= (durations[phase] ?? 1) / 2 ? 1 : 0);
}
