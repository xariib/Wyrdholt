import { describe, expect, it } from "vitest";
import { FIELD_TACTICS, FIELD_TRIAL_ROTATION_MS, FIELD_TRIALS, featuredFieldTrial, runFieldTrial } from "@emberbound/game-core";
import { content } from "./helpers";

describe("Field Trials", () => {
  it("features each trial in turn and wraps after the full rotation", () => {
    for (const [index, trial] of FIELD_TRIALS.entries()) {
      const startsAt = index * FIELD_TRIAL_ROTATION_MS;
      expect(featuredFieldTrial(startsAt)).toBe(trial);
      expect(featuredFieldTrial(startsAt + FIELD_TRIAL_ROTATION_MS - 1)).toBe(trial);
    }
    expect(featuredFieldTrial(FIELD_TRIALS.length * FIELD_TRIAL_ROTATION_MS)).toBe(FIELD_TRIALS[0]);
  });

  it("lets each base class earn both bonus stars on each trial, across attempts", () => {
    for (const trial of FIELD_TRIALS) {
      for (const cls of content.snapshot.classes.filter(cls => cls.implemented && cls.tier === 1)) {
        const results = FIELD_TACTICS.map(tactic => runFieldTrial(content, trial, cls.id, tactic.id));
        expect(results.some(result => result.goals.timeGoal), `${trial.id} · ${cls.id} time`).toBe(true);
        expect(results.some(result => result.goals.healthGoal), `${trial.id} · ${cls.id} health`).toBe(true);
      }
    }
  });

  it("makes different tactics useful on the same fight and gives identical retries", () => {
    const duel = FIELD_TRIALS[2];
    const assault = runFieldTrial(content, duel, "monk", "assault");
    const guard = runFieldTrial(content, duel, "monk", "guard");
    expect(assault.goals).toEqual({ cleared: true, timeGoal: true, healthGoal: false });
    expect(guard.goals).toEqual({ cleared: true, timeGoal: false, healthGoal: true });
    expect(runFieldTrial(content, duel, "monk", "guard")).toEqual(guard);
  });
});
