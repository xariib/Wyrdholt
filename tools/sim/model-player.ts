/**
 * Model player for pacing simulations (C1). A measuring stick, not a game feature:
 * its gear heuristic is NOT an in-game "Equip Best".
 *
 * Schedule (local time), see docs/design/C1_ADVENTURE.md §3:
 * - day 0: install at 19:00, 30-minute first session
 * - day >= 1: sessions at 08:00 (10 min), 12:30 (10 min), 19:00 (20 min)
 * - offline between sessions, capped by content (8 h)
 *
 * In a session, after a failed Push the player farms, and retries the Push when the
 * build has changed since the failure (level, mastery rank or gear), checked every 5 minutes.
 */
import { SLOT_ORDER, type SlotId } from "@emberbound/shared-types";
import {
  FightCache,
  advanceAdventure,
  applyCommand,
  createProfile,
  currentBuild,
  masteryRank,
  resolveHeroStats,
  simulateOffline,
  type AdventureEvent,
  type ContentIndex,
  type Profile,
} from "@emberbound/game-core";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const INSTALL_AT = 19 * HOUR; // day 0, 19:00

export interface Session {
  startMs: number; // wall time since day 0 00:00
  lengthMs: number;
}

/** Daily check-in patterns (local time, minutes). "model" is the C1 calibration schedule. */
export const SCHEDULES: Record<string, { atHour: number; minutes: number }[]> = {
  model: [
    { atHour: 8, minutes: 10 },
    { atHour: 12.5, minutes: 10 },
    { atHour: 19, minutes: 20 },
  ],
  twice: [
    { atHour: 8, minutes: 10 },
    { atHour: 19, minutes: 20 },
  ],
  once: [{ atHour: 19, minutes: 20 }],
};

export function schedule(days: number, pattern = "model"): Session[] {
  const daily = SCHEDULES[pattern];
  if (!daily) throw new Error(`unknown schedule ${pattern}`);
  const out: Session[] = [{ startMs: INSTALL_AT, lengthMs: 30 * MIN }];
  for (let d = 1; d <= days; d += 1) {
    for (const s of daily) out.push({ startMs: d * DAY + s.atHour * HOUR, lengthMs: s.minutes * MIN });
  }
  return out;
}

export interface ClearRecord {
  zoneId: string;
  wallMs: number;
  day: number;
  simHours: number;
  level: number;
  mastery: number;
  pushAttempts: number;
  failStages: number[];
}

export interface NightRecord {
  day: number;
  simulatedMs: number;
  drops: number;
  byRarity: Record<string, number>;
  fights: number;
  levelBefore: number;
  levelAfter: number;
  masteryBefore: number;
  masteryAfter: number;
  computeMs: number;
}

export interface PushAttempt {
  wallMs: number;
  simHours: number;
  zoneId: string;
  cleared: boolean;
  /** 1-based stage where the run ended. */
  stage: number;
  /** Enemy HP left at a failure, share of the stage's total (0 when cleared). */
  enemyLeft: number;
  level: number;
  rank: number;
  /** Equipped item instance ids, for "did the gear change" checks. */
  gear: string;
  offline: boolean;
}

export interface PlayerReport {
  classId: string;
  seed: number;
  /** Check-in pattern (SCHEDULES key). */
  schedule: string;
  /** Every Push run's end, in order. */
  pushLog: PushAttempt[];
  clears: ClearRecord[];
  /** level -> { day, simHours } when first reached */
  levels: Record<number, { day: number; simHours: number }>;
  mastery: Record<number, { day: number; simHours: number }>;
  nights: NightRecord[];
  firstSession: { level: number; mastery: number; clears: string[]; drops: number };
  /** zone -> role -> victory durations (ms) */
  durations: Record<string, Record<string, number[]>>;
  pushAttempts: Record<string, number>;
  failStages: Record<string, number[]>;
  final: { day: number; level: number; mastery: number; gold: number; items: number };
  /**
   * Cumulative earned XP at every session start and end, and every 5 minutes in a session
   * (for tools/sim/fit-tables.ts).
   * Counted from rewards, so it keeps growing past the level and mastery caps.
   */
  timeline: TimelineSample[];
  /** State when the player opens the game (after the offline settlement), per session. */
  sessionStarts: { wallMs: number; simHours: number; level: number; rank: number; masteryXp: number; xp: number; items: number; equipped: string[] }[];
}

export interface TimelineSample {
  simHours: number;
  /** Wall time of the sample (ms since day 0 00:00). */
  wallMs: number;
  xp: number;
  masteryXp: number;
  /** Zone being farmed or pushed at the sample. */
  zoneId: string | null;
}

const dayOf = (wallMs: number) => Math.floor(wallMs / DAY);

export function runModelPlayer(
  content: ContentIndex,
  options: {
    classId: string;
    alternateClassId: string;
    seed: number;
    days: number;
    /** Check-in pattern (SCHEDULES); default "model". */
    schedule?: string;
    /**
     * Human-behavior probe: the last session of each day ends with one more foreground Push;
     * if it fails, the player closes the app on the result screen (activity stays idle).
     */
    leaveOnFailedPush?: boolean;
    /**
     * Offline-storage experiment: simulated time for an absence of `awayMs` (the content's
     * offlineCapMs must be at least the curve's maximum). Default: the content cap.
     */
    offlineCurve?: (awayMs: number) => number;
    /** Human-behavior probe: never change gear (starter gear only). */
    noGearChanges?: boolean;
    /**
     * Human-behavior probe (A40 playtest save): after a failed Push, tap the big Farm button
     * of the zone being pushed ("Repeat stage 1 safely" = that zone's trail) instead of
     * farming the strongest cleared zone, and leave the game on that trail.
     */
    farmPushZoneTrail?: boolean;
    /** QA-only observation on a detached copy; cannot change the model or product profile. */
    observeSessionEnd?: (profile: Profile, session: Session) => void;
  },
): PlayerReport {
  const profile = createProfile(content, {
    name: "Model",
    activeClassId: options.classId,
    alternateClassId: options.alternateClassId,
    masterSeed: options.seed,
    nowWallMs: INSTALL_AT,
  });
  const cache = new FightCache(4);
  let simMs = 0;
  let wallNow = INSTALL_AT;
  const report: PlayerReport = {
    classId: options.classId,
    seed: options.seed,
    schedule: options.schedule ?? "model",
    pushLog: [],
    clears: [],
    levels: {},
    mastery: {},
    nights: [],
    firstSession: { level: 1, mastery: 1, clears: [], drops: 0 },
    durations: {},
    pushAttempts: {},
    failStages: {},
    final: { day: 0, level: 1, mastery: 1, gold: 0, items: 0 },
    timeline: [],
    sessionStarts: [],
  };
  let earnedXp = 0;
  let earnedMastery = 0;
  const sample = () =>
    report.timeline.push({
      simHours: simMs / HOUR,
      wallMs: wallNow,
      xp: earnedXp,
      masteryXp: earnedMastery,
      zoneId: profile.adventure.run?.zoneId ?? null,
    });
  const rank = () => masteryRank(content, profile.character.activeClassId, profile.character.masteryXp[profile.character.activeClassId] ?? 0);
  const noteProgress = (wallMs: number) => {
    const lvl = profile.character.level;
    for (let l = 2; l <= lvl; l += 1) report.levels[l] ??= { day: dayOf(wallMs), simHours: simMs / HOUR };
    const r = rank();
    for (let m = 2; m <= r; m += 1) report.mastery[m] ??= { day: dayOf(wallMs), simHours: simMs / HOUR };
  };

  // Wall time for events: during a session it is the session clock; offline events
  // are seen when the player returns (reported at the next session start).
  let eventWallMs = wallNow;
  let inOffline = false;
  const onEvent = (e: AdventureEvent) => {
    if (e.type === "fightSettled") {
      earnedXp += e.xp;
      earnedMastery += e.mastery;
      if (e.outcome === "victory") {
        const zone = (report.durations[e.zoneId] ??= {});
        (zone[e.role] ??= []).push(e.durationMs);
      }
    } else if (e.type === "runEnded" && e.result.kind !== "cleared" && e.result.mode === "push") {
      (report.failStages[e.result.zoneId] ??= []).push(e.result.stage);
    }
    if (e.type === "runEnded" && e.result.mode === "push") {
      const r = e.result;
      report.pushLog.push({
        wallMs: eventWallMs,
        simHours: simMs / HOUR,
        zoneId: r.zoneId,
        cleared: r.kind === "cleared",
        stage: r.stage,
        enemyLeft: r.kind === "cleared" || r.enemyMaxHp100 <= 0 ? 0 : r.enemyHp100 / r.enemyMaxHp100,
        level: profile.character.level,
        rank: rank(),
        gear: Object.values(profile.equipment).join(","),
        offline: inOffline,
      });
    } else if (e.type === "zoneCleared") {
      const cache = content.zone(e.zoneId).cache;
      earnedXp += cache.xp;
      earnedMastery += cache.mastery;
    }
    if (e.type === "zoneCleared" && e.firstClear) {
      report.clears.push({
        zoneId: e.zoneId,
        wallMs: eventWallMs,
        day: dayOf(eventWallMs),
        simHours: simMs / HOUR,
        level: profile.character.level,
        mastery: rank(),
        pushAttempts: report.pushAttempts[e.zoneId] ?? 0,
        failStages: [...(report.failStages[e.zoneId] ?? [])],
      });
    }
  };

  const zonesInOrder = content.snapshot.zones.filter((z) => z.implemented && !z.hidden).sort((a, b) => a.order - b.order);
  const pushTarget = () => zonesInOrder.find((z) => profile.adventure.zones[z.id]?.unlocked && !profile.adventure.zones[z.id]?.cleared);
  const farmTarget = () => [...zonesInOrder].reverse().find((z) => profile.adventure.zones[z.id]?.cleared) ?? zonesInOrder[0]!;
  const opts = { contentTimeMs: 0, cache };

  const startPush = () => {
    const z = pushTarget();
    if (!z) return false;
    const already = profile.adventure.activity === "push" && profile.adventure.run?.zoneId === z.id;
    const ok = applyCommand(profile, content, { type: "startPush", zoneId: z.id }, opts).ok;
    // Every new or resumed Push is one attempt (continuing a running Push is not).
    if (ok && !already) report.pushAttempts[z.id] = (report.pushAttempts[z.id] ?? 0) + 1;
    return ok;
  };
  const startFarm = () =>
    applyCommand(profile, content, { type: "startFarm", zoneId: (options.farmPushZoneTrail ? pushTarget() : undefined)?.id ?? farmTarget().id }, opts);
  const buildKey = () => `${profile.character.level}/${rank()}/${Object.values(currentBuild(profile).equipment).join(",")}`;
  let failedWith: string | null = null;

  const sessions = schedule(options.days, options.schedule);
  const equip = (p: Profile, c: ContentIndex) => {
    if (!options.noGearChanges) equipUpgrades(p, c);
  };
  for (let i = 0; i < sessions.length; i += 1) {
    const session = sessions[i]!;
    // ---- offline since the previous session (not before the first one)
    if (i > 0) {
      const away = session.startMs - wallNow;
      const before = { level: profile.character.level, mastery: rank(), items: profile.inventory.instances.length };
      eventWallMs = session.startMs;
      const t0 = performance.now();
      inOffline = true;
      const summary = simulateOffline(profile, content, options.offlineCurve ? options.offlineCurve(away) : away, 0, { onEvent });
      inOffline = false;
      const computeMs = performance.now() - t0;
      simMs += summary.simulatedMs;
      noteProgress(session.startMs);
      if (away >= 8 * HOUR) {
        const byRarity: Record<string, number> = {};
        const newItems = profile.inventory.instances.slice(before.items);
        for (const inst of newItems) {
          const r = content.item(inst.baseId).rarity;
          byRarity[r] = (byRarity[r] ?? 0) + 1;
        }
        report.nights.push({
          day: dayOf(session.startMs),
          simulatedMs: summary.simulatedMs,
          drops: summary.itemsFound,
          byRarity,
          fights: summary.fights,
          levelBefore: before.level,
          levelAfter: profile.character.level,
          masteryBefore: before.mastery,
          masteryAfter: rank(),
          computeMs,
        });
      }
    }
    // ---- session start: gear, then Push the next zone or Farm
    wallNow = session.startMs;
    sample();
    report.sessionStarts.push({
      wallMs: session.startMs,
      simHours: simMs / HOUR,
      level: profile.character.level,
      rank: rank(),
      masteryXp: profile.character.masteryXp[profile.character.activeClassId] ?? 0,
      xp: profile.character.xp,
      items: profile.inventory.instances.length,
      // After the session's gear check (equipUpgrades runs right after this sample).
      equipped: [],
    });
    equip(profile, content);
    report.sessionStarts[report.sessionStarts.length - 1]!.equipped = Object.values(profile.equipment).map(
      (id) => profile.inventory.instances.find((x) => x.id === id)?.baseId ?? "?",
    );
    failedWith = null;
    if (!startPush()) startFarm();
    if (profile.adventure.activity === "idle") startFarm();

    // ---- active play in 30 s steps
    let left = session.lengthMs;
    let sinceCheck = 0;
    let sinceSample = 0;
    while (left > 0) {
      const step = Math.min(30_000, left);
      eventWallMs = wallNow;
      advanceAdventure(profile, content, step, { offline: false, onEvent, ...opts });
      simMs += step;
      wallNow += step;
      left -= step;
      noteProgress(wallNow);
      sinceCheck += step;
      sinceSample += step;
      // Same sample hours for every player (fit-tables.ts pools them by index).
      if (sinceSample >= 5 * MIN && left > 0) {
        sinceSample = 0;
        sample();
      }
      if (profile.adventure.activity === "idle") {
        // Online defeat stops the activity: farm safe content until the build changes.
        equip(profile, content);
        failedWith = buildKey();
        startFarm();
      } else if (failedWith !== null && sinceCheck >= 5 * MIN) {
        sinceCheck = 0;
        equip(profile, content);
        if (buildKey() !== failedWith && pushTarget()) {
          failedWith = null;
          startPush();
        }
      }
    }
    if (i === 0) {
      report.firstSession = {
        level: profile.character.level,
        mastery: rank(),
        clears: report.clears.map((c) => c.zoneId),
        drops: profile.inventory.instances.length - content.snapshot.starterItems.length,
      };
    }
    // ---- leaving: equip, then Push if there is new content (offline tries once, then farms)
    sample();
    equip(profile, content);
    const lastOfDay = i + 1 >= sessions.length || dayOf(sessions[i + 1]!.startMs) !== dayOf(session.startMs);
    if (options.leaveOnFailedPush && lastOfDay && pushTarget()) {
      // One more try in the foreground before bed; a failure leaves the result screen open.
      startPush();
      for (let t = 0; t < 10 * MIN && profile.adventure.activity === "push"; t += 5_000) {
        advanceAdventure(profile, content, 5_000, { offline: false, onEvent, ...opts });
        simMs += 5_000;
        wallNow += 5_000;
      }
      if (profile.adventure.activity === "idle") continue;
    }
    if (options.farmPushZoneTrail && pushTarget() && failedWith !== null) {
      // Leaves the game farming the trail it fell back to.
      if (profile.adventure.activity === "idle") startFarm();
      continue;
    }
    if (!startPush()) {
      const run = profile.adventure.run;
      const target = farmTarget();
      if (!(profile.adventure.activity === "farm" && run?.zoneId === target.id)) startFarm();
    }
    options.observeSessionEnd?.(structuredClone(profile), session);
  }

  report.final = {
    day: dayOf(wallNow),
    level: profile.character.level,
    mastery: rank(),
    gold: profile.gold,
    items: profile.inventory.instances.length,
  };
  return report;
}

/** Simulation-only gear heuristic: per slot, the owned item with the best stat score. */
function equipUpgrades(profile: Profile, content: ContentIndex): void {
  const owned = new Map<SlotId, Map<string, number>>();
  for (const inst of profile.inventory.instances) {
    const slot = content.item(inst.baseId).slot;
    const bySlot = owned.get(slot) ?? new Map<string, number>();
    if (!bySlot.has(inst.baseId)) bySlot.set(inst.baseId, inst.id);
    owned.set(slot, bySlot);
  }
  for (const slot of SLOT_ORDER) {
    const candidates = owned.get(slot);
    if (!candidates || candidates.size < 2) continue;
    const build = currentBuild(profile);
    let bestId = build.equipment[slot];
    let bestScore = bestId === undefined ? -1 : score(profile, content, build.equipment);
    for (const id of candidates.values()) {
      if (id === build.equipment[slot]) continue;
      const s = score(profile, content, { ...build.equipment, [slot]: id });
      if (s > bestScore) {
        bestScore = s;
        bestId = id;
      }
    }
    if (bestId !== undefined && bestId !== build.equipment[slot]) {
      applyCommand(profile, content, { type: "equip", slot, instanceId: bestId }, { contentTimeMs: 0 });
    }
  }
}

function score(profile: Profile, content: ContentIndex, equipment: Partial<Record<SlotId, number>>): number {
  const build = { ...currentBuild(profile), equipment };
  const instances = new Map<number, (typeof profile.inventory.instances)[number]>();
  for (const id of Object.values(equipment)) {
    const inst = profile.inventory.instances.find((i) => i.id === id);
    if (inst) instances.set(id!, inst);
  }
  const s = resolveHeroStats(content, build, instances);
  const d = s.display;
  const dps = d.attack * (d.attackRateMilli / 1000) * (1 + (d.critBp / 10_000) * 0.5);
  const ehp = d.hp * (1 + d.armor / 100);
  const effects = s.activeEffects.filter((e) => e.source === "item").length;
  return dps * Math.sqrt(ehp) * (1 + 0.08 * effects);
}
