import type { Pose } from "../art/types";
import { CLASS_BODIES } from "../art/classBodies";
import type { HeroClass } from "../art/gearSkins";

/** Pixel offsets only: attacks and damage still belong to the prepared combat log. */
export function characterOffset(name: string, pose: Pose, frame: number, elapsed: number, phase = 0, attackName = name): readonly [number, number] {
  const body = CLASS_BODIES[name as HeroClass];
  const ranged = attackName === "mage" || attackName === "ranger" || attackName === "spider";
  if (pose === "death") return [0, 0];
  if (pose === "hit") return [-Math.round((name === "warrior" ? 2 : 3) * Math.max(0, 1 - elapsed / 180)), 0];
  if (pose === "attack") {
    // Anticipation, contact, follow-through, recovery. Preserve the native sprite scale.
    const stride = ranged ? name === "ranger" ? [-3, 1, 2, 0] : [-1, 0, 1, 0]
      : name === "warrior" ? [-3, 6, 5, 0] : [-2, name === "monk" ? 9 : 7, 4, 0];
    return [stride[frame] ?? 0, !ranged && frame === 1 && (name === "monk" || name === "ranger") ? -1 : 0];
  }
  // Breathing and weight shifts live in the articulated sprites; keep bare feet grounded.
  if (body) return [0, 0];
  return [0, -Math.round((Math.sin(elapsed / (name === "mage" ? 420 : 310) + phase) + 1) * 0.5)];
}

/** Close the visual distance for a bare-handed strike; HUD and simulation positions stay fixed. */
export function unarmedApproach(distance: number, frame: number, elapsed: number, windupMs: number, classId: string = "monk"): number {
  const reach = Math.max(0, distance - (CLASS_BODIES[classId as HeroClass]?.reach ?? 26));
  const t = Math.min(1, Math.max(0, elapsed / Math.max(1, windupMs)));
  const weight = classId === "warrior" ? t * t : classId === "mage" ? t * t * (3 - 2 * t)
    : classId === "ranger" ? 1 - (1 - t) * (1 - t) : t;
  if (frame === 0) return -2 + (reach + 2) * weight;
  return frame === 1 ? reach : frame === 2 ? reach * (classId === "warrior" ? 0.8 : classId === "ranger" ? 0.45 : 0.65) : 0;
}
