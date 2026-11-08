import type { CombatRecord, FightRecord, SlotId } from "@emberbound/shared-types";
import { prepareFight, startRun, zoneProgress } from "../adventure/run";
import { createBossFightRecord } from "../boss/attempt";
import { prepareBossFight } from "../boss/ladder";
import { applyCommand } from "../commands/commands";
import type { ContentIndex } from "../content";
import { canonicalJson } from "../hash/canonical";
import { sha256Hex } from "../hash/sha256";
import { createInstance } from "../items/inventory";
import { simulateOffline } from "../offline/offline";
import { createProfile } from "../profile/create";
import type { Profile, RunState } from "../profile/types";
import { replayFight } from "../replay/replay";
import { resolveActiveRuleIds } from "../rules/modifiers";
import { encodeProfile } from "../save/codec";

/**
 * Deterministic self-test cases. The same list runs in:
 * - Node (vitest + parity runner),
 * - Bun (JavaScriptCore engine),
 * - a real WebKit browser (WebKitGTK via WebDriver),
 * - the in-app Determinism self-test screen (Android WebView, iOS, browsers).
 * Every case returns a SHA-256 over its complete authoritative output.
 */

export interface SelfTestCase {
  id: string;
  description: string;
  run(content: ContentIndex): CaseOutput;
}

export interface CaseOutput {
  hash: string;
  /** Short human-readable facts for reports. */
  detail: string;
}

export interface SelfTestResult {
  id: string;
  description: string;
  expected: string | null;
  actual: string;
  pass: boolean;
  detail: string;
  ms: number;
  error?: string;
}

export interface GoldenFile {
  rulesVersion: string;
  contentVersion: string;
  contentHash: string;
  generatedBy: string;
  cases: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseProfile(content: ContentIndex, seed: number, active: string, alternate: string): Profile {
  return createProfile(content, {
    name: "Fixture",
    activeClassId: active,
    alternateClassId: alternate,
    masterSeed: seed,
    nowWallMs: 0,
  });
}

function setLevel(content: ContentIndex, profile: Profile, level: number): void {
  profile.character.xp = content.levelTotals[level - 1] ?? 0;
  profile.character.level = level;
}

function setMastery(content: ContentIndex, profile: Profile, classId: string, rank: number): void {
  const track = content.classDef(classId).masteryTrackId;
  profile.character.masteryXp[classId] = content.masteryTotals(track)[rank - 1] ?? 0;
}

function equipNew(content: ContentIndex, profile: Profile, baseIds: readonly string[]): void {
  for (const baseId of baseIds) {
    const item = content.item(baseId);
    const instance = createInstance(profile, baseId, { isNew: false });
    profile.equipment[item.slot as SlotId] = instance.id;
  }
}

function fightRecordFor(
  content: ContentIndex,
  profile: Profile,
  zoneId: string,
  stageIndex: number,
  hp100: number | null,
  runIndex: number,
): FightRecord {
  const run: RunState = {
    zoneId,
    mode: "push",
    runIndex,
    stageIndex,
    hp100,
    phase: "fight",
    elapsedMs: 0,
    restMs: 0,
    runElapsedMs: 0,
    bestAtStart: 0,
    totals: { xp: 0, gold: 0, mastery: 0, items: 0 },
  };
  return prepareFight(profile, content, run, { contentTimeMs: 0, recordEvents: false }).record;
}

function replayCase(content: ContentIndex, record: CombatRecord): CaseOutput {
  const r = replayFight(content, record);
  const s = r.summary;
  return {
    hash: r.hash,
    detail: `${s.outcome} in ${s.durationMs}ms, ${r.events.length} events, hero ${s.hero.hp100}/${s.hero.maxHp100}, draws ${s.rngDraws}`,
  };
}

function profileHash(profile: Profile, extra: unknown): string {
  return sha256Hex(canonicalJson({ profile: encodeProfile(profile), extra }));
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

export const SELF_TEST_CASES: readonly SelfTestCase[] = [
  {
    id: "fight-c4-ashen-king-tier-1",
    description: "Mage M14, level 19, Darkwood gear, Ashen King tier 1",
    run(content) {
      const p = baseProfile(content, 4_001, "mage", "monk");
      setLevel(content, p, 19);
      setMastery(content, p, "mage", 14);
      equipNew(content, p, ["stormcaller", "crown_of_thorns", "cinderweave", "venom_grips", "pilgrims_pace", "moonlit_loop"]);
      return replayCase(content, createBossFightRecord(p, content, { bossId: "ashen_king", tier: 1, attemptIndex: 1 }));
    },
  },
  {
    id: "c4-ashen-crown-offline",
    description: "Finish Ashen King tier 1 offline, then replay a Farm fight with the Ashen Crown",
    run(content) {
      const p = baseProfile(content, 4_105, "warrior", "ranger");
      setLevel(content, p, 30);
      setMastery(content, p, "warrior", 20);
      equipNew(content, p, content.snapshot.items.filter(item => item.rarity === "legendary").map(item => item.id));
      Object.assign(zoneProgress(p, "ashen_mountains"), { unlocked: true, cleared: true, bestStage: 10, completions: 1 });
      const start = applyCommand(p, content, { type: "startBoss", tier: 1, autoPush: true }, { contentTimeMs: 0 });
      const active = p.ashenKing?.active;
      if (!start.ok || !active) throw new Error("Ashen King attempt did not start");
      const fight = prepareBossFight(content, active, false);
      if (!fight) throw new Error("Ashen King attempt did not replay");
      const summary = simulateOffline(p, content, fight.summary.durationMs + 500, 0);
      const farm = p.adventure.run;
      if (!farm || p.ashenKing?.highestClearedTier !== 1 || p.ashenKing.active) throw new Error("Tier 1 did not settle into Farm");
      const replay = replayCase(content, prepareFight(p, content, farm, { contentTimeMs: 0, recordEvents: false }).record);
      return { hash: profileHash(p, { summary, farmHash: replay.hash }), detail: replay.detail };
    },
  },
  ...["monk", "mage", "warrior", "ranger"].flatMap((classId) =>
    ["epic", "legendary"].map((rarity): SelfTestCase => ({
      id: `fight-c3-${classId}-${rarity}`,
      description: `C3 ${classId} M15, level 18, full ${rarity} gear, Ashen Boss, carried HP`,
      run(content) {
        const p = baseProfile(content, 6_006, classId, classId === "monk" ? "mage" : "monk");
        setLevel(content, p, 18);
        setMastery(content, p, classId, 15);
        equipNew(content, p, content.snapshot.items.filter((item) => item.rarity === rarity).map((item) => item.id));
        return replayCase(content, fightRecordFor(content, p, "ashen_mountains", 9, 18_000, 6));
      },
    })),
  ),
  {
    id: "fight-c3-ranger-three-poison-owners",
    description: "Ranger M20 with Venomstring and Venom Grips: three independent Poison owners",
    run(content) {
      const p = baseProfile(content, 6_007, "ranger", "mage");
      setLevel(content, p, 18);
      setMastery(content, p, "ranger", 20);
      equipNew(content, p, ["venomstring", "venom_grips", "ghostwalk", "oath_of_embers"]);
      return replayCase(content, fightRecordFor(content, p, "ashen_mountains", 9, null, 7));
    },
  },
  {
    id: "fight-monk-m1-l1-stage1",
    description: "Monk M1, level 1, starter gear, Greenfields stage 1 (1 enemy)",
    run(content) {
      const p = baseProfile(content, 101, "monk", "mage");
      return replayCase(content, fightRecordFor(content, p, "greenfields", 0, null, 1));
    },
  },
  {
    id: "fight-monk-m20-l7-elite",
    description: "Monk M20 (Flow, combos), level 7, Flowing Wraps + Bloodletter, stage 5 Elite",
    run(content) {
      const p = baseProfile(content, 202, "monk", "mage");
      setLevel(content, p, 7);
      setMastery(content, p, "monk", 20);
      equipNew(content, p, ["bloodletter", "flowing_wraps", "seers_circlet"]);
      return replayCase(content, fightRecordFor(content, p, "greenfields", 4, null, 3));
    },
  },
  {
    id: "fight-monk-m15-venom-three",
    description: "Monk M15, level 6, Venom Grips poison, stage 7 (3 enemies)",
    run(content) {
      const p = baseProfile(content, 303, "monk", "mage");
      setLevel(content, p, 6);
      setMastery(content, p, "monk", 15);
      equipNew(content, p, ["venom_grips", "briar_edge"]);
      return replayCase(content, fightRecordFor(content, p, "greenfields", 6, 9_000, 7));
    },
  },
  {
    id: "fight-mage-m20-l6-three",
    description: "Mage M20 (Spellstorm, 2 Burn stacks), level 6, Ember Seal + Stormcaller, stage 9 (3 enemies)",
    run(content) {
      const p = baseProfile(content, 404, "mage", "monk");
      setLevel(content, p, 6);
      setMastery(content, p, "mage", 20);
      equipNew(content, p, ["ember_seal", "stormcaller", "ironbark_mantle"]);
      return replayCase(content, fightRecordFor(content, p, "greenfields", 8, null, 11));
    },
  },
  {
    id: "fight-mage-m1-l2-boss",
    description: "Mage M1, level 2, starter gear vs the Greenfields boss group (close fight)",
    run(content) {
      const p = baseProfile(content, 505, "mage", "monk");
      setLevel(content, p, 2);
      return replayCase(content, fightRecordFor(content, p, "greenfields", 9, null, 2));
    },
  },
  {
    id: "fight-monk-m5-low-hp",
    description: "Monk M5, level 3, entering stage 8 with 5 HP (HP carry-over input)",
    run(content) {
      const p = baseProfile(content, 606, "monk", "mage");
      setLevel(content, p, 3);
      setMastery(content, p, "monk", 5);
      return replayCase(content, fightRecordFor(content, p, "greenfields", 7, 500, 5));
    },
  },
  {
    id: "fight-rule-hook-hardy",
    description: "Monk M10 in the test zone with the test-only rule enemy HP +50% (rules hook)",
    run(content) {
      const p = baseProfile(content, 707, "monk", "mage");
      setLevel(content, p, 5);
      setMastery(content, p, "monk", 10);
      const record = fightRecordFor(content, p, "test_grounds", 5, null, 4);
      if (!record.activeRuleIds.includes("test_enemy_hp_150")) throw new Error("rule hook not applied");
      return replayCase(content, record);
    },
  },
  {
    id: "fight-timeout",
    description: "Monk M1 vs boss with test rules Iron Hide + Soft Hits (expected 120s timeout)",
    run(content) {
      const p = baseProfile(content, 808, "monk", "mage");
      const record = fightRecordFor(content, p, "greenfields", 9, null, 9);
      record.activeRuleIds = ["test_enemy_tough", "test_enemy_soft"];
      return replayCase(content, record);
    },
  },
  {
    id: "fight-time-window-rule",
    description: "Mage M15 with a time-windowed DoT rule resolved inside its window",
    run(content) {
      const p = baseProfile(content, 909, "mage", "monk");
      setLevel(content, p, 4);
      setMastery(content, p, "mage", 15);
      const zone = content.zone("greenfields");
      const stage = zone.stages[3]!;
      const inside = resolveActiveRuleIds(content, zone, stage, 1_500_000, ["test_windowed_embers"]);
      const outside = resolveActiveRuleIds(content, zone, stage, 2_000_000, ["test_windowed_embers"]);
      if (inside.length !== 1 || outside.length !== 0) throw new Error("time window resolution failed");
      const record = fightRecordFor(content, p, "greenfields", 3, null, 6);
      record.activeRuleIds = inside;
      return replayCase(content, record);
    },
  },
  // --- C2 preparation: Warrior and Ranger --------------------------------------
  {
    id: "fight-warrior-m10-l8-elite",
    description: "Warrior M10 (Bleed, Retaliation, Execute), level 8, starter gear, Greenfields Elite (1 enemy)",
    run(content) {
      const p = baseProfile(content, 1_001, "warrior", "ranger");
      setLevel(content, p, 8);
      setMastery(content, p, "warrior", 10);
      return replayCase(content, fightRecordFor(content, p, "greenfields", 4, null, 12));
    },
  },
  {
    id: "fight-warrior-m20-bleed-owners-boss",
    description: "Warrior M20 with Bloodletter (item Bleed beside class Bleed), level 12, Darkwood Boss + 2 adds",
    run(content) {
      const p = baseProfile(content, 1_002, "warrior", "monk");
      setLevel(content, p, 12);
      setMastery(content, p, "warrior", 20);
      equipNew(content, p, ["bloodletter", "ironbark_mantle", "flowing_wraps"]);
      return replayCase(content, fightRecordFor(content, p, "darkwood", 9, null, 13));
    },
  },
  {
    id: "fight-ranger-m5-l6-two",
    description: "Ranger M5 (Poison, Split Arrow), level 6, starter gear, Greenfields stage 4 (2 enemies)",
    run(content) {
      const p = baseProfile(content, 1_003, "ranger", "warrior");
      setLevel(content, p, 6);
      setMastery(content, p, "ranger", 5);
      return replayCase(content, fightRecordFor(content, p, "greenfields", 3, null, 14));
    },
  },
  {
    id: "fight-ranger-m20-venom-three",
    description: "Ranger M20 (Split x2, Piercing, Venom Burst) with Venom Grips (item Poison), level 14, Darkwood stage 7 (3 enemies)",
    run(content) {
      const p = baseProfile(content, 1_004, "ranger", "mage");
      setLevel(content, p, 14);
      setMastery(content, p, "ranger", 20);
      equipNew(content, p, ["venom_grips", "stormcaller", "cinderweave"]);
      return replayCase(content, fightRecordFor(content, p, "darkwood", 6, null, 15));
    },
  },
  {
    id: "fight-mage-ward-m7-l10-boss",
    description: "Mage M7 (Arcane Ward, Burn, Wildfire), level 10, Greenfields Rare set, Darkwood Boss + 2 adds (ward absorbs)",
    run(content) {
      const p = baseProfile(content, 1_006, "mage", "monk");
      setLevel(content, p, 10);
      setMastery(content, p, "mage", 7);
      equipNew(content, p, ["bloodletter", "seers_circlet", "ironbark_mantle", "flowing_wraps", "huntsmans_stride", "ember_seal"]);
      return replayCase(content, fightRecordFor(content, p, "darkwood", 9, null, 16));
    },
  },
  {
    id: "adventure-ranger-warrior-offline",
    description: "Level-4 Ranger pushes Greenfields offline for 1 hour, then switches to Warrior for 30 minutes",
    run(content) {
      const p = baseProfile(content, 1_005, "ranger", "warrior");
      setLevel(content, p, 4);
      applyCommand(p, content, { type: "startPush", zoneId: "greenfields" }, { contentTimeMs: 0 });
      const first = simulateOffline(p, content, 60 * 60_000, 0);
      applyCommand(p, content, { type: "setActiveClass", classId: "warrior" }, { contentTimeMs: 0 });
      const second = simulateOffline(p, content, 30 * 60_000, 0);
      return {
        hash: profileHash(p, { first, second }),
        detail: `fights ${first.fights}+${second.fights}, level ${p.character.level}, active ${p.character.activeClassId}, ranger xp ${p.character.masteryXp["ranger"] ?? 0}, warrior xp ${p.character.masteryXp["warrior"] ?? 0}`,
      };
    },
  },
  {
    id: "adventure-push-12min-chunked",
    description: "New Monk/Mage character: Push Greenfields for 12 simulated minutes in irregular chunks",
    run(content) {
      const p = baseProfile(content, 1_234, "monk", "mage");
      applyCommand(p, content, { type: "startPush", zoneId: "greenfields" }, { contentTimeMs: 0 });
      let remaining = 12 * 60_000;
      let step = 997;
      let restarts = 0;
      while (remaining > 0) {
        const ms = Math.min(step, remaining);
        applyCommand(p, content, { type: "advance", ms }, { contentTimeMs: 0 });
        remaining -= ms;
        step = step === 997 ? 16 : step === 16 ? 4_321 : 997;
        if (p.adventure.activity === "idle") {
          // Online defeat stops the activity: the player retries Push, or farms the trail.
          restarts += 1;
          const zp = p.adventure.zones["greenfields"];
          const cmd = restarts % 3 === 0 || zp?.cleared ? "startFarm" : "startPush";
          applyCommand(p, content, { type: cmd, zoneId: "greenfields" }, { contentTimeMs: 0 });
        }
      }
      return {
        hash: profileHash(p, { restarts }),
        detail: `level ${p.character.level}, gold ${p.gold}, items ${p.inventory.instances.length}, fights ${p.stats.fights}, cleared ${String(p.adventure.zones["greenfields"]?.cleared)}`,
      };
    },
  },
  {
    id: "offline-2h-push-fallback",
    description: "Level-3 Mage pushes offline for 2 hours (Push failure falls back to safe farming)",
    run(content) {
      const p = baseProfile(content, 4_242, "mage", "monk");
      setLevel(content, p, 3);
      applyCommand(p, content, { type: "startPush", zoneId: "greenfields" }, { contentTimeMs: 0 });
      const summary = simulateOffline(p, content, 2 * 60 * 60_000, 0);
      return {
        hash: profileHash(p, summary),
        detail: `push ${summary.push.status}, fights ${summary.fights}, xp ${summary.xp}, items ${summary.itemsFound}, level ${summary.levelBefore}->${summary.levelAfter}`,
      };
    },
  },
  {
    id: "build-snapshot-rule",
    description: "Gear and class changes during a fight are queued and do not alter that fight",
    run(content) {
      const p = baseProfile(content, 5_151, "monk", "mage");
      const extra = createInstance(p, "briar_edge", { isNew: true });
      startRun(p, content, "greenfields", "push", 0);
      applyCommand(p, content, { type: "advance", ms: 1 }, { contentTimeMs: 0 });
      const before = prepareFight(p, content, p.adventure.run!, { contentTimeMs: 0, recordEvents: false });
      const eq = applyCommand(p, content, { type: "equip", slot: "weapon", instanceId: extra.id }, { contentTimeMs: 0 });
      const cls = applyCommand(p, content, { type: "setActiveClass", classId: "mage" }, { contentTimeMs: 0 });
      const during = prepareFight(p, content, p.adventure.run!, { contentTimeMs: 0, recordEvents: false });
      if (!eq.ok || !eq.queued || !cls.ok || !cls.queued) throw new Error("changes were not queued");
      if (before.summary !== during.summary && canonicalJson(before.summary) !== canonicalJson(during.summary)) {
        throw new Error("fight changed after a queued build change");
      }
      applyCommand(p, content, { type: "advance", ms: 60_000 }, { contentTimeMs: 0 });
      return {
        hash: profileHash(p, { fight: before.summary }),
        detail: `queued ok; after boundary class=${p.character.activeClassId}, weapon=${String(p.equipment.weapon)}`,
      };
    },
  },
];

export function runSelfTest(
  content: ContentIndex,
  golden: GoldenFile | null,
  now: () => number,
  only?: readonly string[],
): SelfTestResult[] {
  const results: SelfTestResult[] = [];
  for (const c of SELF_TEST_CASES) {
    if (only && !only.includes(c.id)) continue;
    const started = now();
    const expected = golden?.cases[c.id] ?? null;
    try {
      const out = c.run(content);
      results.push({
        id: c.id,
        description: c.description,
        expected,
        actual: out.hash,
        pass: expected !== null && expected === out.hash,
        detail: out.detail,
        ms: now() - started,
      });
    } catch (error) {
      results.push({
        id: c.id,
        description: c.description,
        expected,
        actual: "",
        pass: false,
        detail: "",
        ms: now() - started,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

/** Golden file must match the loaded rules and content, or every case is meaningless. */
export function goldenMatches(golden: GoldenFile, content: ContentIndex, rulesVersion: string): string | null {
  if (golden.rulesVersion !== rulesVersion) return `golden rules ${golden.rulesVersion} != core ${rulesVersion}`;
  if (golden.contentHash !== content.hash) return `golden content hash differs from loaded content`;
  return null;
}
