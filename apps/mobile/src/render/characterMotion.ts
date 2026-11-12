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

/** Close the visual distance for a bare-handed strike; HUD and simulation positions stay fixed. */
export function unarmedApproach(distance: number, frame: number, elapsed: number, windupMs: number): number {
  const reach = Math.max(0, distance - 26);
  if (frame === 0) return -2 + (reach + 2) * Math.min(1, Math.max(0, elapsed / Math.max(1, windupMs)));
  return frame === 1 ? reach : frame === 2 ? reach * 0.65 : 0;
}
