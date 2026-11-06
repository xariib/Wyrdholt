import type { StageRole } from "@emberbound/shared-types";

/**
 * C1 calibration anchors (docs/design/C1_ADVENTURE.md): the build a typical player
 * has when they first clear each zone, and the per-role fight shape.
 * Stage budgets are generated against these (tools/sim/tune-budgets.ts).
 */
export interface ExpectedBuild {
  level: number;
  mastery: number;
  /** Equipped catalog items (one per slot). */
  gear: string[];
  /** Difficulty growth per stage inside the zone (0.03 = +3% per stage index). */
  rampPerStage: number;
}

export const ZONE_BUILDS: Record<string, ExpectedBuild> = {
  // First session: starter gear, a couple of mastery ranks.
  greenfields: {
    level: 5,
    mastery: 2,
    gear: ["wayfarer_blade", "linen_hood", "trail_tunic", "worn_grips", "road_boots", "copper_band"],
    rampPerStage: 0.03,
  },
  // Day 1 evening for a two-check-in player (C1 retune: cleared around day 1–2). With a full day
  // of offline storage the model wears the full Greenfields Rare set by then; level and
  // mastery carry the time gate. Not a hard gate: stronger builds clear earlier.
  darkwood: {
    level: 10,
    mastery: 7,
    gear: ["bloodletter", "seers_circlet", "ironbark_mantle", "flowing_wraps", "huntsmans_stride", "ember_seal"],
    rampPerStage: 0.03,
  },
  // Day 6–8: the full Darkwood Epic set after several days of Darkwood farming.
  ashen_mountains: {
    level: 19,
    mastery: 14,
    gear: ["stormcaller", "crown_of_thorns", "cinderweave", "venom_grips", "pilgrims_pace", "moonlit_loop"],
    rampPerStage: 0.03,
  },
};

/** Target victory length at the expected build, and the share of max HP one fight costs. */
export const STAGE_SHAPES: Record<StageRole, { seconds: number; hpShare: number }> = {
  normal: { seconds: 10, hpShare: 0.22 },
  elite: { seconds: 20, hpShare: 0.42 },
  boss: { seconds: 36, hpShare: 0.8 },
};
