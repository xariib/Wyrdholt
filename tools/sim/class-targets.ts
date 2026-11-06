/**
 * Class-performance targets and sanity bounds (docs/design/C1_ADVENTURE.md §8).
 *
 * Primary targets (tuned against):
 *   CT1  wall parity: the per-class wall levels differ by at most CT1_MAX_WALL_GAP levels
 *   CT2  damage output: normal-stage fight length, slowest / fastest class <= CT2_MAX_NORMAL_RATIO
 *
 * Sanity check (Kalvoz, 16 Sep 2026: "the wall metric may replace 40–60%, but not alone"):
 *   CS   the same expected progression state must not give an extreme class split
 *        without a clear gameplay reason. It is not a tuning target, only a tripwire:
 *   CS1  survivability ratio (per-class 50%-clear damage scale, max / min) <= CS1_MAX_SURVIVABILITY_RATIO
 *   CS2  Boss fight length, slowest / fastest class <= CS2_MAX_BOSS_RATIO
 *   CS3  one level either side of the expected build, the classes agree:
 *        at L+1 every class clears >= CS3_MIN_CLEAR_ABOVE, at L-1 every class clears <= CS3_MAX_CLEAR_BELOW
 *   CS4  pacing: per zone, the classes' median first-clear days differ by at most CS4_MAX_DAY_GAP,
 *        and their seed ranges overlap (tools/sim/pacing.ts)
 *
 * A failed sanity check is only acceptable with a written gameplay reason in CLASS_SPLIT_EXCEPTIONS.
 */
/**
 * Classes the shipped zone budgets are calibrated against (tools/sim/tune-budgets.ts).
 * C1 accepted Monk and Mage, and the C1 retune pacing (Darkwood day 1–2, Ashen day 6–8) was
 * fitted on them. The C2 four-class calibration (22 Sep 2026) kept these budgets unchanged and
 * tuned Warrior, Ranger and the Mage ward to them instead, so the approved C1 pacing stays put.
 */
export const CALIBRATION_CLASSES: readonly string[] = ["monk", "mage"];

/**
 * Classes that must meet CT1/CT2 and CS1–CS4 together (C2: all four base classes).
 * tools/sim/class-report.ts reports them as binding "Four-class targets".
 */
export const TARGET_CLASSES: readonly string[] = ["monk", "mage", "warrior", "ranger"];

export const CT1_MAX_WALL_GAP = 1.0;
export const CT2_MAX_NORMAL_RATIO = 1.25;

export const CS1_MAX_SURVIVABILITY_RATIO = 1.2;
export const CS2_MAX_BOSS_RATIO = 1.4;
export const CS3_MIN_CLEAR_ABOVE = 0.9;
export const CS3_MAX_CLEAR_BELOW = 0.1;
export const CS4_MAX_DAY_GAP = 1;

export type SanityCheckId = "CS1" | "CS2" | "CS3" | "CS4";

/**
 * Accepted class splits, per zone and check, each with the gameplay reason that justifies it
 * (for example a zone built around a class's weakness). Empty in C1: no exceptions.
 */
export const CLASS_SPLIT_EXCEPTIONS: Record<string, Partial<Record<SanityCheckId, string>>> = {};

/** "PASS", "EXCEPTION: <reason>" or "**FAIL**" for one sanity check. */
export function sanityResult(zoneId: string, check: SanityCheckId, pass: boolean): string {
  if (pass) return "PASS";
  const reason = CLASS_SPLIT_EXCEPTIONS[zoneId]?.[check];
  return reason ? `EXCEPTION: ${reason}` : "**FAIL**";
}
