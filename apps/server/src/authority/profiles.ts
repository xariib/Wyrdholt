import { randomBytes, randomUUID } from "node:crypto";
import { bossProgress, canonicalJson, createProfile, type ContentIndex, type Profile } from "@emberbound/game-core";
import { executeAuthorityCommand, parseCommandEnvelope, type CommandJournalEntry } from "./commands";
import type { SocialState } from "../social/state";

/** The transport supplies the authenticated account id. Requests carry no owner id. */
export interface AccountIdentity { accountId: string }
export interface CharacterChoice { name: string; activeClassId: string; alternateClassId: string }

export interface LeaderboardSubmission {
  format: "wyrdholt-leaderboard-submission/1";
  seasonId: string;
  revision: number;
}

export interface LeaderboardEntry {
  profileId: string;
  displayName: string;
  seasonId: string;
  tier: number;
  submittedAtMs: number;
}

export interface AuthorityProfile {
  accountId: string;
  profileId: string;
  revision: number;
  profile: Profile;
  lastCommand?: CommandJournalEntry;
  leaderboard: Record<string, LeaderboardEntry>;
}

/** Store implementations atomically commit a revision and its journal entry. */
export interface AuthorityStore {
  read(accountId: string): Promise<AuthorityProfile | null>;
  readProfile(profileId: string): Promise<AuthorityProfile | null>;
  insert(record: AuthorityProfile, credentialHash?: string): Promise<boolean>;
  commit(expectedRevision: number, record: AuthorityProfile, journal?: CommandJournalEntry): Promise<boolean>;
  rankings(seasonId: string): Promise<LeaderboardEntry[]>;
  readSocial(): Promise<SocialState>;
  commitSocial(expectedRevision: number, state: SocialState, profiles: ProfileChange[]): Promise<boolean>;
}

export interface ProfileChange { accountId: string; revision: number; update?: AuthorityProfile }

const refusal = (error: string) => ({ ok: false as const, error });
const receipt = (record: AuthorityProfile) => ({
  ok: true as const, profileId: record.profileId, revision: record.revision, result: record.lastCommand?.result ?? null,
});

export class ProfileAuthority {
  constructor(
    private readonly content: ContentIndex,
    private readonly store: AuthorityStore,
    private readonly now: () => number = Date.now,
  ) {}

  async create(identity: AccountIdentity, choice: CharacterChoice, credentialHash?: string) {
    if (!identity.accountId || typeof choice?.name !== "string" || typeof choice.activeClassId !== "string"
      || typeof choice.alternateClassId !== "string") return refusal("Invalid character request.");
    const atMs = this.now();
    if (!Number.isSafeInteger(atMs) || atMs < 0) return refusal("Authority time unavailable.");
    let profile: Profile;
    try {
      profile = createProfile(this.content, {
        name: choice.name, activeClassId: choice.activeClassId, alternateClassId: choice.alternateClassId,
        nowWallMs: atMs, masterSeed: randomBytes(4).readUInt32LE(),
      });
    } catch (error) {
      return refusal(error instanceof Error ? error.message : "Invalid character request.");
    }
    const record: AuthorityProfile = { accountId: identity.accountId, profileId: randomUUID(), profile, revision: 0, leaderboard: {} };
    return await this.store.insert(record, credentialHash) ? receipt(record) : refusal("This account already has a character.");
  }

  async view(identity: AccountIdentity) {
    const record = await this.store.read(identity.accountId);
    if (!record) return refusal("Create a character first.");
    const profile = record.profile;
    const ladders = Object.entries(profile.longTerm?.ladders ?? {}).map(([id, state]) => ({
      id, cleared: state.highestClearedTier, active: state.active?.record.encounter.tier ?? null, lastResult: state.lastResult,
    }));
    if (profile.ashenKing) ladders.push({ id: "ashen_king", cleared: profile.ashenKing.highestClearedTier,
      active: profile.ashenKing.active?.record.encounter.tier ?? null, lastResult: profile.ashenKing.lastResult });
    return { ok: true as const, profileId: record.profileId, revision: record.revision,
      character: profile.character, gold: profile.gold, adventure: profile.adventure, ladders,
      equipment: profile.equipment, pendingClassId: profile.pending?.activeClassId ?? null,
      inventory: profile.inventory.instances.map(item => ({ id: item.id, baseId: item.baseId, isNew: item.isNew })),
      lockedItems: profile.itemLocks?.lockedInstanceIds ?? [], forgeTransactionId: profile.forge?.nextTransactionId ?? 1,
    };
  }

  async submit(identity: AccountIdentity, value: unknown) {
    const request = parseCommandEnvelope(value);
    if (!identity.accountId || !request) return refusal("Invalid command request.");
    const state = await this.store.read(identity.accountId);
    if (!state) return refusal("Create a character first.");
    const previous = state.lastCommand;
    if (previous?.request.requestId === request.requestId) {
      return canonicalJson(previous.request) === canonicalJson(request) ? receipt(state) : refusal("Request ID was already used.");
    }
    if (state.revision !== request.revision || state.revision === Number.MAX_SAFE_INTEGER) return refusal("Profile revision changed.");
    const atMs = this.now();
    if (!Number.isSafeInteger(atMs) || atMs < state.profile.clock.lastSettledWallMs) return refusal("Authority time unavailable.");
    const forgeSeed = request.command?.type === "forge" && request.command.input.transactionId === (state.profile.forge?.nextTransactionId ?? 1)
      ? randomBytes(4).readUInt32LE() : undefined;
    const next = executeAuthorityCommand(this.content, state.profile, request, atMs, forgeSeed);
    if (!next.ok) return next;
    const updated = { ...state, profile: next.profile, revision: state.revision + 1, lastCommand: next.entry };
    if (await this.store.commit(state.revision, updated, next.entry)) return receipt(updated);
    const latest = await this.store.read(identity.accountId);
    return latest?.lastCommand && canonicalJson(latest.lastCommand.request) === canonicalJson(request)
      ? receipt(latest) : refusal("Profile revision changed.");
  }

  async submitLeaderboard(identity: AccountIdentity, input: LeaderboardSubmission) {
    if (!identity.accountId || input?.format !== "wyrdholt-leaderboard-submission/1" || !this.content.seasons.has(input.seasonId)) {
      return refusal("Invalid leaderboard submission.");
    }
    const state = await this.store.read(identity.accountId);
    if (!state) return refusal("Create a character first.");
    const tier = bossProgress(state.profile, input.seasonId)?.highestClearedTier ?? 0;
    if (tier === 0) return refusal("Clear a tier on the authority profile first.");
    const existing = state.leaderboard[input.seasonId];
    if (existing && existing.tier >= tier) return { ok: true as const, entry: existing, revision: state.revision };
    if (state.revision !== input.revision || state.revision === Number.MAX_SAFE_INTEGER) return refusal("Profile revision changed.");
    const submittedAtMs = this.now();
    if (!Number.isSafeInteger(submittedAtMs) || submittedAtMs < state.profile.clock.lastSettledWallMs) return refusal("Authority time unavailable.");
    const entry: LeaderboardEntry = { profileId: state.profileId, displayName: state.profile.character.name, seasonId: input.seasonId, tier, submittedAtMs };
    const updated = { ...state, revision: state.revision + 1, leaderboard: { ...state.leaderboard, [input.seasonId]: entry } };
    return await this.store.commit(state.revision, updated) ? { ok: true as const, entry, revision: updated.revision } : refusal("Profile revision changed.");
  }

  async leaderboard(seasonId: string): Promise<LeaderboardEntry[]> {
    if (!this.content.seasons.has(seasonId)) return [];
    const results = await this.store.rankings(seasonId);
    return results.sort((a, b) => b.tier - a.tier || a.submittedAtMs - b.submittedAtMs || a.profileId.localeCompare(b.profileId));
  }
}
