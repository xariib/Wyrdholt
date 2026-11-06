/**
 * C1 target timeline for the model player, in simulated hours since install
 * (docs/design/C1_ADVENTURE.md §1–2; C1 retune of 21 Sep 2026).
 *
 * Calibration player: **two check-ins a day** (08:00 for 10 min, 19:00 for 20 min), which
 * Kalvoz defined as normal play. With the retuned offline storage every absence of that
 * player is simulated in full, so simulated hours ≈ real hours since install (day 0, 19:00):
 *   day N 08:00 = 13 + 24 × (N − 1) h · day N 19:00 = 24 × N h
 *
 * Anchors:
 * - L5–L6 and M2 inside the 30-minute first session (Greenfields wall: L5 M2)
 * - L10 and M7 around day 1 evening (the Darkwood wall; cleared around day 1–2)
 * - M10 around day 3; L19 and M14 around day 6–7 (the Ashen wall, cleared day 6–8); M15 about day 7
 * - M20 after day 21; level 30 after about 12 weeks
 *
 * tools/sim/fit-tables.ts turns these into the XP tables in
 * packages/game-content/src/progression.ts from a pacing run (bun tools/sim/pacing.ts --schedule=twice).
 * Hours past the simulated days are extrapolated at the late XP rate (farming Ashen),
 * so the long tail must be refitted when later milestones add content.
 */

/** The check-in pattern the tables are fitted for (tools/sim/model-player.ts SCHEDULES). */
export const CALIBRATION_SCHEDULE = "twice";

/** Hours at which each level is reached, for levels 2..30. */
export const LEVEL_HOURS: Record<number, number> = {
  2: 0.03, 3: 0.06, 4: 0.1, 5: 0.17, 6: 0.26,
  7: 2, 8: 5, 9: 11, 10: 22,
  11: 36, 12: 50, 13: 64, 14: 78, 15: 92, 16: 107, 17: 121, 18: 136, 19: 150,
  20: 207, 21: 270, 22: 349, 23: 450, 24: 575, 25: 719, 26: 894, 27: 1_100, 28: 1_355, 29: 1_640, 30: 1_986,
};

/** Hours at which each Mastery rank of the active class is reached, for ranks 2..20. */
export const MASTERY_HOURS: Record<number, number> = {
  2: 0.1, 3: 0.3, 4: 2, 5: 6,
  6: 13, 7: 22, 8: 34, 9: 48, 10: 62,
  11: 78, 12: 96, 13: 116, 14: 140, 15: 165,
  16: 214, 17: 289, 18: 375, 19: 476, 20: 598,
};
