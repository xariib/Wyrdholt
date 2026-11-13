import type { Pose } from "../art/types";
import { CLASS_BODIES } from "../art/classBodies";
import type { HeroClass } from "../art/gearSkins";
import { actorPack, type ProductionClip } from "../art/darkwood";

/** A readable step, contact, follow-through and return, fitted to the logged cadence. */
export const UNARMED_ATTACK: ProductionClip = {
  ...actorPack.monk!.animations.attack,
  ms: [320, 140, 180, 320], min_ms: [80, 100, 60, 80], crit_hold_ms: 220,
};

/** Pixel offsets only: attacks and damage still belong to the prepared combat log. */
export function characterOffset(name: string, pose: Pose, frame: number, elapsed: number, _phase = 0, attackName = name): readonly [number, number] {
  const ranged = attackName === "mage" || attackName === "ranger" || attackName === "spider";
  if (pose === "death") return [0, 0];
  if (pose === "hit") return [-Math.round((name === "warrior" ? 2 : 3) * Math.max(0, 1 - elapsed / 180)), 0];
  if (pose === "attack") {
    // Anticipation, contact, follow-through, recovery. Preserve the native sprite scale.
    const stride = ranged ? name === "ranger" ? [-3, 1, 2, 0] : [-1, 0, 1, 0]
      : name === "warrior" ? [-3, 6, 5, 0] : [-2, name === "monk" ? 9 : 7, 4, 0];
    return [stride[frame] ?? 0, !ranged && frame === 1 && (name === "monk" || name === "ranger") ? -1 : 0];
  }
  // Breathing and weight shifts live in the illustrated sprites. Every species
  // rests on the same ground plane, including spirits and the middle enemy slot.
  return [0, 0];
}

/** Close the visual distance for a bare-handed strike; HUD and simulation positions stay fixed. */
export function unarmedApproach(distance: number, elapsed: number, durations: readonly number[], classId: string = "monk"): number {
  const reach = Math.max(0, distance - (CLASS_BODIES[classId as HeroClass]?.reach ?? 26));
  const [windupMs = 320, contactMs = 140, followThroughMs = 180, returnMs = 320] = durations;
  const t = Math.min(1, Math.max(0, elapsed / Math.max(1, windupMs)));
  const weight = classId === "warrior" ? t * t : classId === "mage" ? t * t * (3 - 2 * t)
    : classId === "ranger" ? 1 - (1 - t) * (1 - t) : t;
  if (elapsed < windupMs) return reach * weight;
  const recovery = Math.min(1, Math.max(0, (elapsed - windupMs - contactMs) / Math.max(1, followThroughMs + returnMs)));
  // Interpolate across both recovery poses instead of teleporting at frame boundaries.
  return reach * (1 - recovery * recovery * (3 - 2 * recovery));
}
