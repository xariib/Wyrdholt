import type { FightOutcome, PartyFightRecord } from "@emberbound/shared-types";

export interface DungeonReceipt {
  requestId: string;
  dungeonId: string;
  party: [string, string, string];
  won: boolean;
  atMs: number;
  fights: { record: PartyFightRecord; hash: string; outcome: FightOutcome; durationMs: number }[];
  rewards: { profileId: string; gold: number }[];
}

export interface RaidReceipt {
  requestId: string;
  profileId: string;
  party: [string, string, string];
  phase: number;
  record: PartyFightRecord;
  hash: string;
  damage100: number;
  adds: number;
  atMs: number;
}

export interface GuildRaid {
  id: string;
  raidId: string;
  contentHash: string;
  startsAtMs: number;
  endsAtMs: number;
  phase: number;
  damage100: number;
  adds: number;
  complete: boolean;
  receipts: RaidReceipt[];
  claimed: string[];
}

export interface Guild {
  id: string;
  name: string;
  ownerId: string;
  members: string[];
  invites: string[];
  marks: number;
  expeditionTable: boolean;
  raids: GuildRaid[];
}

export interface SocialState {
  revision: number;
  borrowing: Record<string, boolean>;
  friendRequests: Record<string, string[]>;
  dungeonReceipts: Record<string, DungeonReceipt>;
  lastDungeonStart: Record<string, number>;
  dailyDungeonRewards: Record<string, { day: number; count: number }>;
  guilds: Record<string, Guild>;
  memberships: Record<string, string>;
}

export const emptySocialState = (): SocialState => ({
  revision: 0, borrowing: {}, friendRequests: {}, dungeonReceipts: {}, lastDungeonStart: {}, dailyDungeonRewards: {}, guilds: {}, memberships: {},
});
