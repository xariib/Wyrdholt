import type { MechanicDef, MasteryTrackDef } from "@emberbound/shared-types";
import type { ContentIndex } from "./index";
import { resolveClassMechanics } from "../character/progression";
import { BP } from "../math/fixed";

/**
 * Class-kit and item-effect validation (C2). Runs when content is loaded, so a bad
 * technique or effect fails at startup and in tests instead of silently mid-fight.
 */
export function validateKits(content: ContentIndex): void {
  const snapshot = content.snapshot;
  const itemMechanicIds = new Map<string, string>();
  for (const item of snapshot.items) {
    for (const m of item.effect?.mechanics ?? []) {
      checkMechanic(m, `item ${item.id}`);
      const other = itemMechanicIds.get(m.id);
      if (other !== undefined && other !== item.id) throw new Error(`item ${item.id}: mechanic id ${m.id} already used by item ${other}`);
      itemMechanicIds.set(m.id, item.id);
    }
  }

  for (const track of snapshot.masteryTracks) validateTrack(track, itemMechanicIds);

  for (const cls of snapshot.classes) {
    if (!cls.implemented) continue;
    const track = content.track(cls.masteryTrackId);
    for (let rank = 1; rank <= track.maxRank; rank += 1) {
      const label = `class ${cls.id} M${rank}`;
      let kit: MechanicDef[];
      try {
        kit = resolveClassMechanics(content, cls.id, rank);
      } catch (error) {
        throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      }
      for (const m of kit) checkMechanic(m, label);
      checkKitReferences(kit, label);
    }
  }
}

function validateTrack(track: MasteryTrackDef, itemMechanicIds: ReadonlyMap<string, string>): void {
  const seen = new Set<string>();
  let lastRank = 0;
  for (const technique of track.techniques) {
    const label = `track ${track.id} technique ${technique.id}`;
    if (!track.milestones.includes(technique.unlockRank)) throw new Error(`${label}: unlock rank ${technique.unlockRank} is not a milestone`);
    if (technique.unlockRank < lastRank) throw new Error(`${label}: techniques must be in unlock order`);
    lastRank = technique.unlockRank;
    for (const m of technique.add ?? []) {
      if (seen.has(m.id)) throw new Error(`${label}: duplicate mechanic id ${m.id}`);
      if (itemMechanicIds.has(m.id)) throw new Error(`${label}: mechanic id ${m.id} is also an item effect id`);
      seen.add(m.id);
      checkMechanic(m, label);
    }
  }
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);

function range(value: number | undefined, min: number, max: number, field: string, label: string): void {
  if (value === undefined) return;
  if (!isInt(value) || value < min || value > max) throw new Error(`${label}: ${field} ${String(value)} outside ${min}..${max}`);
}

/** Parameter sanity for one mechanic (after patches). */
export function checkMechanic(m: MechanicDef, label: string): void {
  const where = `${label} mechanic ${m.id}`;
  if (!m.id) throw new Error(`${label}: mechanic without id`);
  const r = m as unknown as Record<string, number | undefined>;
  range(r.every, 1, 1_000, "every", where);
  range(r.chanceBp, 0, BP, "chanceBp", where);
  range(r.potencyBp, 0, 10 * BP, "potencyBp", where);
  range(r.cooldownMs, 0, 600_000, "cooldownMs", where);
  range(r.durationMs, 1, 600_000, "durationMs", where);
  range(r.tickMs, 1, 600_000, "tickMs", where);
  range(r.maxStacks, 1, 20, "maxStacks", where);
  range(r.hasteBp, 0, 5 * BP, "hasteBp", where);
  range(r.thresholdBp, 1, BP, "thresholdBp", where);
  range(r.bonusBp, 0, 10 * BP, "bonusBp", where);
  range(r.pierceBp, 0, BP, "pierceBp", where);
  range(r.requiresTargetHpBelowBp, 1, BP, "requiresTargetHpBelowBp", where);
  range(r.targets, 1, 2, "targets", where);
  range(r.appliesDots, 0, 1, "appliesDots", where);
  range(r.minStacks, 1, 20, "minStacks", where);
  range(r.startBp, 0, BP, "startBp", where);
  range(r.capBp, 1, BP, "capBp", where);
  if (m.kind === "on_hit_dot" && m.tickMs > m.durationMs) throw new Error(`${where}: tickMs longer than durationMs`);
  if (m.kind === "ward" && m.startBp > m.capBp) throw new Error(`${where}: startBp ${m.startBp} above capBp ${m.capBp}`);
}

/** Cross-references inside one resolved class kit. */
function checkKitReferences(kit: readonly MechanicDef[], label: string): void {
  const hasteStatuses = new Set(kit.flatMap((m) => (m.kind === "nth_hit_haste" ? [m.statusId] : [])));
  for (const m of kit) {
    if (m.kind === "nth_hit_extra_damage" && m.requiresStatus !== undefined && !hasteStatuses.has(m.requiresStatus)) {
      throw new Error(`${label}: ${m.id} requires status ${m.requiresStatus}, which the kit never grants`);
    }
    if (m.kind === "stack_burst") {
      const dot = kit.find((d) => d.kind === "on_hit_dot" && d.statusId === m.statusId);
      if (!dot || dot.kind !== "on_hit_dot") throw new Error(`${label}: ${m.id} bursts ${m.statusId}, which the kit never applies`);
      if (dot.maxStacks < m.minStacks) {
        throw new Error(`${label}: ${m.id} needs ${m.minStacks} ${m.statusId} stacks but the kit caps them at ${dot.maxStacks}`);
      }
    }
    if (m.kind === "nth_attack_split" || m.kind === "on_damaged_retaliate") {
      if (m.appliesDots === 1 && !kit.some((d) => d.kind === "on_hit_dot")) {
        throw new Error(`${label}: ${m.id} applies class DoTs, but the kit has none`);
      }
    }
  }
}
