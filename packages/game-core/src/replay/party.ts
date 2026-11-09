import type { PartyFightRecord, PartyMemberSnapshot } from "@emberbound/shared-types";
import { resolveHeroStats } from "../character/stats";
import { ArraySink, simulateFight } from "../combat/engine";
import type { ContentIndex } from "../content";
import { buildWaveEnemies } from "../encounter/budget";
import { canonicalJson } from "../hash/canonical";
import { sha256Hex } from "../hash/sha256";
import { currentBuild, equippedInstances, upgradeClassGear } from "../items/inventory";
import { deriveSeed } from "../math/prng";
import { cloneProfile } from "../profile/clone";
import type { Profile } from "../profile/types";
import { combineRuleEffects } from "../rules/modifiers";
import { ReplayMismatchError } from "./replay";

export function partySnapshot(content: ContentIndex, profileId: string, revision: number, profile: Profile): PartyMemberSnapshot {
  if (content.snapshot.starterWeapons && profile.contentVersion !== content.snapshot.contentVersion) {
    // The borrowed build starts a new fight independently of the owner's current fight.
    profile = cloneProfile(profile);
    upgradeClassGear(profile, content);
  }
  const build = currentBuild(profile);
  const itemInstances = [...equippedInstances(profile, build).values()];
  return JSON.parse(canonicalJson({ profileId, revision, build, itemInstances })) as PartyMemberSnapshot;
}

export function replayPartyFight(content: ContentIndex, record: PartyFightRecord) {
  if (record.format !== "emberbound-party-fight-record/1" || record.contentHash !== content.socialHash) {
    throw new ReplayMismatchError("Party fight content mismatch");
  }
  if (record.members.length !== 3 || new Set(record.members.map(m => m.profileId)).size !== 3) {
    throw new ReplayMismatchError("A party requires three distinct characters");
  }
  const { kind, id, wave } = record.encounter;
  const definition = kind === "dungeon" ? content.dungeons.get(id)?.waves[wave]
    : kind === "raid" ? content.raids.get(id)?.phases[wave] : undefined;
  if (!definition) throw new ReplayMismatchError("Unknown party encounter");
  const [lead, first, second] = record.members;
  const statsFor = (member: PartyMemberSnapshot) => {
    if (member.build.seasonRelicAttackBp !== undefined) throw new ReplayMismatchError("Season Relics apply in their own ladder");
    return resolveHeroStats(content, member.build, new Map(member.itemInstances.map(item => [item.id, item])));
  };
  const effects = combineRuleEffects(content, definition.ruleIds ?? []);
  const sink = new ArraySink();
  const summary = simulateFight({
    hero: statsFor(lead), companions: [statsFor(first), statsFor(second)], startHp100: null,
    enemies: buildWaveEnemies(content, definition, effects), effects, config: content.snapshot.config, seed: record.seed,
  }, sink);
  const events = sink.events;
  const hash = sha256Hex(canonicalJson({ record, events, summary }));
  return { record, summary, events, hash };
}

export function runPartyDungeon(content: ContentIndex, id: string, members: PartyFightRecord["members"], seed: number) {
  const dungeon = content.dungeons.get(id);
  if (!dungeon) throw new ReplayMismatchError("Unknown dungeon");
  const fights: ReturnType<typeof replayPartyFight>[] = [];
  for (let wave = 0; wave < dungeon.waves.length; wave += 1) {
    const record: PartyFightRecord = {
      format: "emberbound-party-fight-record/1", contentHash: content.socialHash,
      encounter: { kind: "dungeon", id, wave }, members, seed: deriveSeed(seed, `dungeon/${id}/${wave}`),
    };
    const fight = replayPartyFight(content, record);
    fights.push(fight);
    if (fight.summary.outcome !== "victory") break;
  }
  return { won: fights.length === dungeon.waves.length && fights.every(fight => fight.summary.outcome === "victory"), fights };
}
