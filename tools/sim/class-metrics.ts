/**
 * Per-class combat metrics for balance reports (tools only; floats allowed here).
 * Everything is measured against a fixed ContentIndex, so the caller decides whether
 * zone budgets are the shipped ones or a calibration.
 */
import type { StageRole } from "@emberbound/shared-types";
import type { ContentIndex, ExecutedFight } from "@emberbound/game-core";
import type { ExpectedBuild } from "./expected-builds";
import { median, probeFightDetailed } from "./probe";

export interface RoleMetrics {
  /** Median fight length in seconds. */
  seconds: number;
  /** Median effective damage per second over the fight. */
  dps: number;
  /** Share of all hero damage by source (sums to 1). */
  sources: { basic: number; class: number; item: number };
  /** Share of all hero damage that came from DoT ticks. */
  dotShare: number;
  /** Share of all hero damage per mechanic id ("basic" for plain attacks). */
  byMechanic: Record<string, number>;
  /** Mean procs per fight, per mechanic id. */
  procs: Record<string, number>;
  /** Only with enemy damage on: wins / fights, median hero HP left (share of max). */
  winRate?: number;
  hpLeft?: number;
  /** Only with enemy damage on: healing / damage taken. */
  healPerTaken?: number;
}

/** Map a tick's status line back to the mechanic that owns it. */
function statusOwners(fight: ExecutedFight): Map<string, string> {
  const owners = new Map<string, string>();
  for (const m of fight.hero.mechanics) if ("statusId" in m) owners.set(m.statusId, m.id);
  return owners;
}

/**
 * Metrics for every stage of one role in a zone, `seeds` fights per stage, from full HP.
 * With `damageOff` the content should have zero enemy damage (pure damage output).
 */
export function roleMetrics(
  content: ContentIndex,
  classId: string,
  build: ExpectedBuild,
  zoneId: string,
  role: StageRole,
  seeds: number,
  withSurvival: boolean,
): RoleMetrics {
  const zone = content.zone(zoneId);
  const seconds: number[] = [];
  const dps: number[] = [];
  const hpLeft: number[] = [];
  let wins = 0;
  let fights = 0;
  let healed = 0;
  let taken = 0;
  const src = { basic: 0, class: 0, item: 0 };
  let dot = 0;
  let total = 0;
  const byMechanic: Record<string, number> = {};
  const procs: Record<string, number> = {};
  zone.stages.forEach((stage, i) => {
    if (stage.role !== role) return;
    for (let s = 1; s <= seeds; s += 1) {
      const fight = probeFightDetailed(content, classId, build, zoneId, i, s * 7919);
      const sum = fight.summary;
      const c = sum.counters;
      fights += 1;
      const secs = sum.durationMs / 1000;
      if (sum.outcome === "victory") {
        wins += 1;
        seconds.push(secs);
      }
      dps.push(c.damageDealt100 / 100 / Math.max(0.001, secs));
      hpLeft.push(sum.hero.hp100 / sum.hero.maxHp100);
      healed += c.healing100;
      taken += c.damageTaken100;
      src.basic += c.damageBasic100;
      src.class += c.damageClass100;
      src.item += c.damageItem100;
      dot += c.damageDot100;
      total += c.damageDealt100;
      for (const [id, n] of Object.entries(c.procs)) procs[id] = (procs[id] ?? 0) + n;
      const owners = statusOwners(fight);
      for (const e of fight.events ?? []) {
        if (e.type === "hit" && e.src === "hero") {
          const key = String(e.via);
          byMechanic[key] = (byMechanic[key] ?? 0) + Number(e.eff);
        } else if (e.type === "tick" && e.tgt !== "hero") {
          const key = owners.get(String(e.status)) ?? String(e.status);
          byMechanic[key] = (byMechanic[key] ?? 0) + Number(e.eff);
        }
      }
    }
  });
  const share = (x: number) => (total > 0 ? x / total : 0);
  return {
    seconds: seconds.length ? median(seconds) : Number.NaN,
    dps: median(dps),
    sources: { basic: share(src.basic), class: share(src.class), item: share(src.item) },
    dotShare: share(dot),
    byMechanic: Object.fromEntries(Object.entries(byMechanic).map(([k, v]) => [k, share(v)])),
    procs: Object.fromEntries(Object.entries(procs).map(([k, v]) => [k, v / Math.max(1, fights)])),
    ...(withSurvival
      ? { winRate: wins / Math.max(1, fights), hpLeft: median(hpLeft), healPerTaken: healed / Math.max(1, taken) }
      : {}),
  };
}
