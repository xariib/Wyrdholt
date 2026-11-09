import { CONTENT } from "@emberbound/game-content";
import { canonicalJson, ContentIndex, currentSeason, sha256Hex } from "@emberbound/game-core";
import type { SeasonDef } from "@emberbound/shared-types";

const DAY = 86_400_000;
const format = "wyrdholt-live-config/1";
const identifier = /^[a-z][a-z0-9_]{0,39}$/;
type Data = Record<string, unknown>;

function object(value: unknown): value is Data {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

/** A manifest schedules versioned ladder templates and their associated events. */
export function loadLiveConfig(input: unknown = { format, version: "bundled", rotations: [] }) {
  if (!object(input) || input.format !== format || typeof input.version !== "string" || !identifier.test(input.version)
    || !Array.isArray(input.rotations) || input.rotations.length > 48) throw new Error("Invalid live configuration");
  const base = CONTENT.longTerm!;
  const rotations = input.rotations.map((rotation: unknown): SeasonDef => {
    if (!object(rotation) || typeof rotation.id !== "string" || !identifier.test(rotation.id)
      || typeof rotation.template !== "string" || typeof rotation.name !== "string" || rotation.name.trim().length < 3 || rotation.name.length > 40
      || !integer(rotation.startMs, DAY, 4_102_444_800_000) || rotation.startMs % DAY !== 0
      || !integer(rotation.days, 21, 56) || !integer(rotation.tierDays, 1, 14)) throw new Error("Invalid live rotation");
    const template = base.seasons.find(season => season.boss.id === rotation.template);
    if (!template) throw new Error(`Unknown season template ${rotation.template}`);
    return {
      ...template, name: rotation.name.trim(), startMs: rotation.startMs, endMs: rotation.startMs + rotation.days * DAY,
      tierIntervalMs: rotation.tierDays * DAY, boss: { ...template.boss, id: `season_${rotation.id}` },
      rule: { ...template.rule, id: `${rotation.id}_rule` },
      titles: ["Challenger", "Veteran", "Champion"].map(title => `${rotation.name} ${title}`),
    };
  });
  const content = new ContentIndex({ ...CONTENT, longTerm: { ...base, seasons: [...base.seasons, ...rotations] } });
  const hash = sha256Hex(canonicalJson({ version: input.version, content: content.longTermHash }));
  return { version: input.version, hash, content };
}

export function liveEvents(config: ReturnType<typeof loadLiveConfig>, atMs: number) {
  const active = currentSeason(config.content, atMs)?.boss.id;
  return { version: config.version, hash: config.hash, atMs, active: active ?? null,
    events: [...config.content.seasons.values()].sort((a, b) => a.startMs - b.startMs).map(s => ({
      kind: "season_ladder" as const, id: s.boss.id, name: s.name, boss: s.boss.name,
      startMs: s.startMs, endMs: s.endMs, tierIntervalMs: s.tierIntervalMs,
      rule: s.rule.name, relic: s.relicName, relicAttackBp: s.relicAttackBp, rewards: s.titles,
    })),
  };
}
