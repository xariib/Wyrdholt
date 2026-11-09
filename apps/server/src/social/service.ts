import { randomBytes, randomUUID } from "node:crypto";
import { partySnapshot, replayPartyFight, runPartyDungeon, type ContentIndex } from "@emberbound/game-core";
import type { PartyFightRecord } from "@emberbound/shared-types";
import type { AccountIdentity, AuthorityProfile, AuthorityStore, ProfileChange } from "../authority/profiles";
import type { DungeonReceipt, Guild, GuildRaid, RaidReceipt, SocialState } from "./state";

const DAY = 24 * 60 * 60 * 1_000;
const PROJECT_COST = 60;
const REQUEST_ID = /^[a-z0-9][a-z0-9_-]{0,79}$/i;
const PROFILE_ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const error = (message: string) => ({ ok: false as const, error: message });
const ok = { ok: true as const };
type Roster = [AuthorityProfile, AuthorityProfile, AuthorityProfile];

function areFriends(state: SocialState, a: string, b: string): boolean {
  return state.friendRequests[a]?.includes(b) === true && state.friendRequests[b]?.includes(a) === true;
}

function shareGuild(state: SocialState, a: string, b: string): boolean {
  return Boolean(state.memberships[a] && state.memberships[a] === state.memberships[b]);
}

function credit(profile: AuthorityProfile, gold: number): ProfileChange {
  if (!Number.isSafeInteger(profile.profile.gold + gold) || !Number.isSafeInteger(profile.revision + 1)) throw new Error("Profile counter exhausted");
  const update = { ...profile, profile: { ...profile.profile, gold: profile.profile.gold + gold }, revision: profile.revision + 1 };
  return { accountId: profile.accountId, revision: profile.revision, update };
}

export class SocialAuthority {
  constructor(private readonly content: ContentIndex, private readonly store: AuthorityStore, private readonly now = Date.now) {}

  private commit(state: SocialState, profiles: ProfileChange[] = []) {
    return this.store.commitSocial(state.revision, { ...state, revision: state.revision + 1 }, profiles);
  }

  private async actor(identity: AccountIdentity) {
    return identity.accountId ? this.store.read(identity.accountId) : null;
  }

  async view(identity: AccountIdentity) {
    const profile = await this.actor(identity);
    if (!profile) return error("Create a character first.");
    const state = await this.store.readSocial();
    const id = profile.profileId;
    const guildId = state.memberships[id];
    const guild = guildId ? state.guilds[guildId] : undefined;
    const friends = state.friendRequests[id] ?? [];
    const guilds = Object.values(state.guilds);
    const invitations = guilds.filter(g => g.invites.includes(id)).map(g => ({ id: g.id, name: g.name }));
    const roster = [...new Set([...friends.filter(friend => areFriends(state, id, friend)), ...(guild?.members ?? [])])]
      .filter(candidate => candidate !== id && state.borrowing[candidate] === true);
    const borrowable = await Promise.all(roster.map(async candidate => {
      const record = await this.store.readProfile(candidate);
      return record && { id: candidate, name: record.profile.character.name, classId: record.profile.character.activeClassId, level: record.profile.character.level };
    }));
    const publicGuild = guild && { ...guild, raids: guild.raids.map(({ receipts: _receipts, claimed: _claimed, contentHash: _hash, ...raid }) => raid) };
    const claimableRaids = guilds.flatMap(g => g.raids.filter(raid => raid.complete && !raid.claimed.includes(id)
      && raid.receipts.some(r => (r.damage100 > 0 || r.adds > 0) && r.party.includes(id)))
      .map(raid => ({ id: raid.id, name: this.content.raids.get(raid.raidId)?.name ?? raid.raidId })));
    return {
      ...ok, profileId: id, borrowing: state.borrowing[id] === true, guild: publicGuild, invitations, claimableRaids, borrowable: borrowable.filter(Boolean),
      friendRequests: Object.entries(state.friendRequests).filter(([from, recipients]) => recipients.includes(id) && !areFriends(state, id, from)).map(([from]) => from),
      dungeons: [...this.content.dungeons.values()].map(d => ({ id: d.id, name: d.name, rewardGold: d.rewardGold, unlocked: profile.profile.adventure.zones[d.unlockZoneId]?.cleared === true })),
      raids: [...this.content.raids.values()].map(r => ({ id: r.id, name: r.name, phases: r.phases.map(p => ({ damageGoal100: p.damageGoal100, addGoal: p.addGoal })) })),
    };
  }

  async setBorrowing(identity: AccountIdentity, enabled: boolean) {
    const profile = await this.actor(identity);
    if (!profile || typeof enabled !== "boolean") return error("Invalid borrowing preference.");
    const state = await this.store.readSocial();
    state.borrowing[profile.profileId] = enabled;
    return await this.commit(state) ? ok : error("Social state changed. Retry.");
  }

  async friend(identity: AccountIdentity, other: string, add: boolean) {
    const profile = await this.actor(identity);
    if (!profile || typeof add !== "boolean" || !PROFILE_ID.test(other) || other === profile.profileId || !await this.store.readProfile(other)) {
      return error("Unknown friend.");
    }
    const state = await this.store.readSocial();
    const outgoing = state.friendRequests[profile.profileId] ?? [];
    state.friendRequests[profile.profileId] = add ? [...new Set([...outgoing, other])] : outgoing.filter(id => id !== other);
    return await this.commit(state) ? ok : error("Social state changed. Retry.");
  }

  private async roster(state: SocialState, leader: AuthorityProfile, allies: unknown, guildOnly: boolean): Promise<Roster | null> {
    if (!Array.isArray(allies) || allies.length !== 2 || allies.some(id => typeof id !== "string" || !PROFILE_ID.test(id))
      || new Set([leader.profileId, ...allies]).size !== 3) return null;
    const available = (id: string) => state.borrowing[id] === true
      && (shareGuild(state, leader.profileId, id) || (!guildOnly && areFriends(state, leader.profileId, id)));
    if (!allies.every(available)) return null;
    const [first, second] = await Promise.all(allies.map(id => this.store.readProfile(id)));
    return first && second ? [leader, first, second] : null;
  }

  async dungeon(identity: AccountIdentity, requestId: string, dungeonId: string, allies: unknown) {
    const leader = await this.actor(identity);
    const dungeon = this.content.dungeons.get(dungeonId);
    if (!leader || !dungeon || typeof requestId !== "string" || !REQUEST_ID.test(requestId)) return error("Invalid dungeon entry.");
    const state = await this.store.readSocial();
    const key = `${leader.profileId}/${requestId}`;
    const prior = state.dungeonReceipts[key];
    if (prior) return prior.dungeonId === dungeonId && Array.isArray(allies) && allies.length === 2 && allies.every((id, i) => id === prior.party[i + 1])
      ? { ...ok, receipt: prior } : error("Request ID was already used.");
    if (!leader.profile.adventure.zones[dungeon.unlockZoneId]?.cleared) return error(`Clear ${this.content.zone(dungeon.unlockZoneId).name} to enter.`);
    const atMs = this.now();
    const day = Math.floor(atMs / DAY);
    if (!Number.isSafeInteger(atMs) || atMs < leader.profile.clock.lastSettledWallMs) return error("Authority time unavailable.");
    if ((state.lastDungeonStart[leader.profileId] ?? -1) >= day) return error("This character already led a dungeon today.");
    const roster = await this.roster(state, leader, allies, false);
    if (!roster) return error("Choose two different opted-in friends or guildmates.");
    const members = roster.map(p => partySnapshot(this.content, p.profileId, p.revision, p.profile)) as PartyFightRecord["members"];
    const result = runPartyDungeon(this.content, dungeonId, members, randomBytes(4).readUInt32LE());
    const party: DungeonReceipt["party"] = [roster[0].profileId, roster[1].profileId, roster[2].profileId];
    const receipt: DungeonReceipt = {
      requestId, dungeonId, party, won: result.won, atMs, rewards: [],
      fights: result.fights.map(f => ({ record: f.record, hash: f.hash, outcome: f.summary.outcome, durationMs: f.summary.durationMs })),
    };
    const changes: ProfileChange[] = [];
    for (const member of roster) {
      const recent = state.dailyDungeonRewards[member.profileId];
      const count = recent?.day === day ? recent.count : 0;
      if (result.won && count < 3 && (recent?.day ?? -1) <= day) {
        changes.push(credit(member, dungeon.rewardGold));
        state.dailyDungeonRewards[member.profileId] = { day, count: count + 1 };
        receipt.rewards.push({ profileId: member.profileId, gold: dungeon.rewardGold });
      } else changes.push({ accountId: member.accountId, revision: member.revision });
    }
    const guildId = state.memberships[leader.profileId];
    const guild = guildId ? state.guilds[guildId] : undefined;
    if (guild && result.won) guild.marks += dungeon.guildMarks;
    state.dungeonReceipts[key] = receipt;
    state.lastDungeonStart[leader.profileId] = day;
    if (await this.commit(state, changes)) return { ...ok, receipt };
    const saved = (await this.store.readSocial()).dungeonReceipts[key];
    return saved?.dungeonId === dungeonId && saved.party.every((id, i) => id === party[i]) ? { ...ok, receipt: saved } : error("Party or profile changed. Retry.");
  }

  async createGuild(identity: AccountIdentity, name: string) {
    const profile = await this.actor(identity);
    const trimmed = typeof name === "string" ? name.trim() : "";
    if (!profile || trimmed.length < 3 || trimmed.length > 24) return error("Guild names must be 3–24 characters.");
    const state = await this.store.readSocial();
    if (state.memberships[profile.profileId]) return error("Leave your current guild first.");
    const guild: Guild = { id: randomUUID(), name: trimmed, ownerId: profile.profileId, members: [profile.profileId], invites: [], marks: 0, expeditionTable: false, raids: [] };
    state.guilds[guild.id] = guild;
    state.memberships[profile.profileId] = guild.id;
    return await this.commit(state) ? { ...ok, guild } : error("Guild membership changed. Retry.");
  }

  async invite(identity: AccountIdentity, other: string) {
    const profile = await this.actor(identity);
    if (!profile || !PROFILE_ID.test(other) || !await this.store.readProfile(other)) return error("Unknown character.");
    const state = await this.store.readSocial();
    const guild = this.guildFor(state, profile.profileId);
    if (!guild || guild.ownerId !== profile.profileId || state.memberships[other]) return error("Only the guild leader can invite a free character.");
    guild.invites = [...new Set([...guild.invites, other])];
    return await this.commit(state) ? ok : error("Guild membership changed. Retry.");
  }

  async join(identity: AccountIdentity, guildId: string) {
    const profile = await this.actor(identity);
    if (!profile || !PROFILE_ID.test(guildId)) return error("Unknown guild.");
    const state = await this.store.readSocial();
    const guild = state.guilds[guildId];
    if (!guild || state.memberships[profile.profileId] || !guild.invites.includes(profile.profileId) || guild.members.length >= 20) {
      return error("An invitation and a free guild slot are required.");
    }
    guild.members.push(profile.profileId);
    guild.invites = guild.invites.filter(id => id !== profile.profileId);
    state.memberships[profile.profileId] = guildId;
    return await this.commit(state) ? ok : error("Guild membership changed. Retry.");
  }

  async leave(identity: AccountIdentity) {
    const profile = await this.actor(identity);
    if (!profile) return error("Create a character first.");
    const state = await this.store.readSocial();
    const guild = this.guildFor(state, profile.profileId);
    if (!guild) return ok;
    guild.members = guild.members.filter(id => id !== profile.profileId);
    delete state.memberships[profile.profileId];
    const successor = guild.members[0];
    if (!successor) guild.invites = [];
    else if (guild.ownerId === profile.profileId) guild.ownerId = successor;
    return await this.commit(state) ? ok : error("Guild membership changed. Retry.");
  }

  private guildFor(state: SocialState, profileId: string): Guild | undefined {
    const guildId = state.memberships[profileId];
    return guildId ? state.guilds[guildId] : undefined;
  }

  async completeProject(identity: AccountIdentity) {
    const profile = await this.actor(identity);
    if (!profile) return error("Create a character first.");
    const state = await this.store.readSocial();
    const guild = this.guildFor(state, profile.profileId);
    if (!guild || guild.ownerId !== profile.profileId) return error("Only the guild leader can spend guild marks.");
    if (guild.expeditionTable) return ok;
    if (guild.marks < PROJECT_COST) return error(`Earn ${PROJECT_COST} guild marks through dungeons.`);
    guild.marks -= PROJECT_COST;
    guild.expeditionTable = true;
    return await this.commit(state) ? ok : error("Guild project state changed. Retry.");
  }

  async openRaid(identity: AccountIdentity, raidId: string) {
    const profile = await this.actor(identity);
    const definition = this.content.raids.get(raidId);
    if (!profile || !definition) return error("Unknown raid.");
    const atMs = this.now();
    if (!Number.isSafeInteger(atMs) || atMs < profile.profile.clock.lastSettledWallMs) return error("Authority time unavailable.");
    const state = await this.store.readSocial();
    const guild = this.guildFor(state, profile.profileId);
    if (!guild || guild.ownerId !== profile.profileId || !guild.expeditionTable) return error("The guild leader needs a completed Expedition Table.");
    if (guild.raids.some(raid => raid.endsAtMs > atMs)) return error("The current raid window is still open.");
    const raid: GuildRaid = { id: randomUUID(), raidId, contentHash: this.content.socialHash, startsAtMs: atMs,
      endsAtMs: atMs + definition.durationMs, phase: 0, damage100: 0, adds: 0, complete: false, receipts: [], claimed: [] };
    guild.raids.push(raid);
    return await this.commit(state) ? { ...ok, raid } : error("Raid state changed. Retry.");
  }

  async contribute(identity: AccountIdentity, raidId: string, requestId: string, allies: unknown) {
    const profile = await this.actor(identity);
    if (!profile || !PROFILE_ID.test(raidId) || typeof requestId !== "string" || !REQUEST_ID.test(requestId)) return error("Invalid raid entry.");
    const state = await this.store.readSocial();
    const guild = this.guildFor(state, profile.profileId);
    const raid = guild?.raids.find(candidate => candidate.id === raidId);
    if (!raid) return error("This raid is unavailable.");
    const previous = raid.receipts.find(r => r.profileId === profile.profileId && r.requestId === requestId);
    if (previous) return Array.isArray(allies) && allies.length === 2 && allies.every((id, i) => id === previous.party[i + 1])
      ? { ...ok, receipt: previous } : error("Request ID was already used.");
    const atMs = this.now();
    if (!Number.isSafeInteger(atMs) || atMs < raid.startsAtMs || atMs >= raid.endsAtMs || raid.complete || raid.contentHash !== this.content.socialHash) {
      return error("This raid is unavailable.");
    }
    const day = Math.floor(atMs / DAY);
    const dayStart = day * DAY;
    const alreadyLed = Object.values(state.guilds).some(g => g.raids.some(candidate => candidate.endsAtMs > dayStart
      && candidate.receipts.some(r => r.profileId === profile.profileId && r.atMs >= dayStart)));
    if (alreadyLed) return error("You already led a raid attempt today.");
    const goal = this.content.raids.get(raid.raidId)?.phases[raid.phase];
    const roster = await this.roster(state, profile, allies, true);
    if (!goal || !roster) return error("Choose two different opted-in guildmates.");
    const members = roster.map(p => partySnapshot(this.content, p.profileId, p.revision, p.profile)) as PartyFightRecord["members"];
    const record: PartyFightRecord = {
      format: "emberbound-party-fight-record/1", contentHash: raid.contentHash, members,
      encounter: { kind: "raid", id: raid.raidId, wave: raid.phase }, seed: randomBytes(4).readUInt32LE(),
    };
    const fight = replayPartyFight(this.content, record);
    const [boss, ...adds] = fight.summary.enemies;
    const damage100 = Math.min(goal.damageGoal100 - raid.damage100, boss ? boss.maxHp100 - boss.hp100 : 0);
    const defeatedAdds = Math.min(goal.addGoal - raid.adds, adds.filter(add => !add.alive).length);
    const receipt: RaidReceipt = { requestId, profileId: profile.profileId, party: [members[0].profileId, members[1].profileId, members[2].profileId],
      phase: raid.phase, record, hash: fight.hash, damage100, adds: defeatedAdds, atMs };
    raid.receipts.push(receipt);
    raid.damage100 += damage100;
    raid.adds += defeatedAdds;
    if (raid.damage100 === goal.damageGoal100 && raid.adds === goal.addGoal) {
      raid.phase += 1;
      raid.damage100 = 0;
      raid.adds = 0;
      raid.complete = raid.phase === this.content.raids.get(raid.raidId)?.phases.length;
    }
    const changes = roster.map(p => ({ accountId: p.accountId, revision: p.revision }));
    return await this.commit(state, changes) ? { ...ok, receipt } : error("Raid phase or profile changed. Retry.");
  }

  async claimRaid(identity: AccountIdentity, raidId: string) {
    const profile = await this.actor(identity);
    if (!profile || !PROFILE_ID.test(raidId)) return error("Unknown raid.");
    const state = await this.store.readSocial();
    const raid = Object.values(state.guilds).flatMap(g => g.raids).find(r => r.id === raidId);
    const reward = raid && this.content.raids.get(raid.raidId)?.rewardGold;
    if (!raid?.complete || !reward || !raid.receipts.some(r => (r.damage100 > 0 || r.adds > 0) && r.party.includes(profile.profileId))) {
      return error("A contribution to a completed raid is required.");
    }
    if (raid.claimed.includes(profile.profileId)) return { ...ok, gold: reward };
    raid.claimed.push(profile.profileId);
    return await this.commit(state, [credit(profile, reward)]) ? { ...ok, gold: reward } : error("Raid rewards changed. Retry.");
  }
}
