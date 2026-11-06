import type { ZoneDef } from "@emberbound/shared-types";
import type { ContentIndex, Profile } from "@emberbound/game-core";

/**
 * Presentation mapping for the zone list. No game rules here: unlocks, clears and
 * activities come from the profile; commands still go through the session.
 */
export type ZoneStatus = "locked" | "open" | "cleared";

export interface ZoneView {
  zone: ZoneDef;
  status: ZoneStatus;
  /** Zone that unlocks this one (for the locked hint). */
  unlockedBy: ZoneDef | null;
  bestStage: number;
  completions: number;
  minLevel: number;
  maxLevel: number;
  isCurrent: boolean;
}

export function playableZones(content: ContentIndex): ZoneDef[] {
  return content.snapshot.zones.filter((z) => z.implemented && !z.hidden).sort((a, b) => a.order - b.order);
}

export function zoneViews(profile: Profile, content: ContentIndex): ZoneView[] {
  const zones = playableZones(content);
  return zones.map((zone) => {
    const zp = profile.adventure.zones[zone.id];
    const levels = zone.stages.map((s) => s.level);
    return {
      zone,
      status: zp?.cleared ? "cleared" : zp?.unlocked ? "open" : "locked",
      unlockedBy: zones.find((z) => z.unlocks.includes(zone.id)) ?? null,
      bestStage: zp?.bestStage ?? 0,
      completions: zp?.completions ?? 0,
      minLevel: Math.min(...levels),
      maxLevel: Math.max(...levels),
      isCurrent: profile.adventure.zoneId === zone.id && profile.adventure.activity !== "idle",
    };
  });
}

/**
 * The safe Farm target after a failed Push: the highest cleared zone, or the first
 * zone's trail when nothing is cleared yet (the same choice offline catch-up makes).
 */
export function safeFarmZone(profile: Profile, content: ContentIndex): ZoneDef {
  const zones = playableZones(content);
  const cleared = zones.filter((z) => profile.adventure.zones[z.id]?.cleared);
  return cleared[cleared.length - 1] ?? zones[0]!;
}
