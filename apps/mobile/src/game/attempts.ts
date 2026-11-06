import { masteryRank, type ContentIndex, type Profile } from "@emberbound/game-core";

/**
 * Push attempt history (C1 retune): shows the player that progress is working — how much enemy
 * HP was left at each attempt, and what changed in the build between attempts.
 * Presentation only: kept in local storage next to the save, never read by game-core.
 */
export interface Attempt {
  atWallMs: number;
  zoneId: string;
  outcome: "cleared" | "failed";
  /** 1-based stage where the run ended (stagesTotal when cleared). */
  stage: number;
  stagesTotal: number;
  /** Enemy HP left at the failure, in basis points of the stage's total (0 when cleared). */
  enemyLeftBp: number;
  source: "online" | "offline";
  classId: string;
  level: number;
  rank: number;
  /** Equipped base item per slot. */
  gear: Record<string, string>;
}

const KEY = "emberbound.attempts.v1";
const PER_ZONE = 8;

type Store = Record<string, Record<string, Attempt[]>>;

function characterKey(profile: Profile): string {
  return `${profile.createdAtWallMs}-${profile.masterSeed}`;
}

export interface RetryTarget {
  zoneId: string;
  stage: number;
}

let retryFallback: { key: string; target: RetryTarget | null } | undefined;

export function setRetryTarget(profile: Profile, target: RetryTarget | null): void {
  const key = `emberbound.retry.v1:${characterKey(profile)}`;
  try {
    if (target) globalThis.localStorage.setItem(key, JSON.stringify(target));
    else globalThis.localStorage.removeItem(key);
    retryFallback = undefined;
  } catch {
    retryFallback = { key, target };
  }
}

export function retryTarget(profile: Profile, content: ContentIndex): RetryTarget | null {
  if (profile.adventure.activity === "push") return null;
  const key = `emberbound.retry.v1:${characterKey(profile)}`;
  try {
    const target: RetryTarget | null = retryFallback?.key === key
      ? retryFallback.target
      : JSON.parse(globalThis.localStorage.getItem(key) ?? "null");
    if (!target) return null;
    const zone = content.zones.get(target.zoneId);
    const progress = profile.adventure.zones[target.zoneId];
    return zone?.implemented && !zone.hidden && progress?.unlocked && !progress.cleared
      && Number.isInteger(target.stage) && target.stage > 0 && target.stage <= zone.stages.length ? target : null;
  } catch {
    return null;
  }
}

function read(): Store {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    return raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    return {};
  }
}

function write(store: Store): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(store));
  } catch {
    // Storage full or unavailable: the history is a convenience only.
  }
}

/** The build a player would recognize: class, level, Mastery rank and equipped items. */
export function buildState(profile: Profile, content: ContentIndex): Pick<Attempt, "classId" | "level" | "rank" | "gear"> {
  const classId = profile.character.activeClassId;
  const gear: Record<string, string> = {};
  for (const [slot, id] of Object.entries(profile.equipment)) {
    const inst = profile.inventory.instances.find((i) => i.id === id);
    if (inst) gear[slot] = inst.baseId;
  }
  return { classId, level: profile.character.level, rank: masteryRank(content, classId, profile.character.masteryXp[classId] ?? 0), gear };
}

export function recordAttempt(
  profile: Profile,
  content: ContentIndex,
  result: { zoneId: string; cleared: boolean; stage: number; stagesTotal: number; enemyHp100: number; enemyMaxHp100: number },
  source: Attempt["source"],
  atWallMs: number,
  state: Pick<Attempt, "classId" | "level" | "rank" | "gear"> = buildState(profile, content),
): void {
  const store = read();
  const byZone = (store[characterKey(profile)] ??= {});
  const list = (byZone[result.zoneId] ??= []);
  list.push({
    atWallMs,
    zoneId: result.zoneId,
    outcome: result.cleared ? "cleared" : "failed",
    stage: result.cleared ? result.stagesTotal : result.stage,
    stagesTotal: result.stagesTotal,
    enemyLeftBp: result.cleared || result.enemyMaxHp100 <= 0 ? 0 : Math.round((10_000 * result.enemyHp100) / result.enemyMaxHp100),
    source,
    ...state,
  });
  if (list.length > PER_ZONE) list.splice(0, list.length - PER_ZONE);
  write(store);
  setRetryTarget(profile, result.cleared ? null : { zoneId: result.zoneId, stage: result.stage });
}

export function attemptHistory(profile: Profile, zoneId: string): Attempt[] {
  return read()[characterKey(profile)]?.[zoneId] ?? [];
}

/** What changed in the build between two attempts, in player terms. */
export function buildChanges(prev: Attempt, cur: Pick<Attempt, "classId" | "level" | "rank" | "gear">, content: ContentIndex): string[] {
  const out: string[] = [];
  if (cur.classId !== prev.classId) out.push(`class ${content.classDef(prev.classId).name} → ${content.classDef(cur.classId).name}`);
  if (cur.level !== prev.level) out.push(`level ${prev.level} → ${cur.level}`);
  if (cur.classId === prev.classId && cur.rank !== prev.rank) out.push(`Mastery M${prev.rank} → M${cur.rank}`);
  const slots = new Set([...Object.keys(prev.gear), ...Object.keys(cur.gear)]);
  let changed = 0;
  for (const s of slots) if (prev.gear[s] !== cur.gear[s]) changed += 1;
  if (changed > 0) out.push(`${changed} new ${changed === 1 ? "item" : "items"} equipped`);
  return out;
}

/** "Boss 35%" / "stage 5 · 40%" / "cleared" for one attempt. */
export function attemptLabel(a: Attempt, content: ContentIndex): string {
  if (a.outcome === "cleared") return "cleared";
  const role = content.zone(a.zoneId).stages[a.stage - 1]?.role;
  const where = role === "boss" ? "Boss" : role === "elite" ? `Elite (stage ${a.stage})` : `stage ${a.stage}`;
  return `${where} ${Math.round(a.enemyLeftBp / 100)}%`;
}
