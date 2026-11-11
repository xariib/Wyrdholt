import type { Pose } from "../art/types";

/** Pixel offsets only: attacks and damage still belong to the prepared combat log. */
export function characterOffset(name: string, pose: Pose, frame: number, elapsed: number, phase = 0): readonly [number, number] {
  const ranged = name === "mage" || name === "ranger" || name === "spider";
  if (pose === "death") return [0, 0];
  if (pose === "hit") return [-Math.round(3 * Math.max(0, 1 - elapsed / 180)), 0];
  if (pose === "attack") {
    // Anticipation, contact, follow-through, recovery. Preserve the native sprite scale.
    const stride = ranged ? [-2, -1, 1, 0] : [-2, name === "monk" ? 9 : 7, 4, 0];
    return [stride[frame] ?? 0, !ranged && frame === 1 ? -1 : 0];
  }
  return [0, -Math.round((Math.sin(elapsed / (name === "mage" ? 420 : 310) + phase) + 1) * 0.5)];
}
