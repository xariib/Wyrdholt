import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmdirSync, unlinkSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONTENT } from "@emberbound/game-content";
import { activeBossAttempt, createInstance, replayFight, replayPartyFight } from "@emberbound/game-core";
import type { PartyFightRecord } from "@emberbound/shared-types";
import { verifyAuthorityReplay } from "../src/authority/commands";
import { ProfileAuthority } from "../src/authority/profiles";
import { SqliteAuthorityStore } from "../src/authority/sqlite";
import { createAuthorityHttp } from "../src/http";
import { liveEvents, loadLiveConfig } from "../src/live/config";

const DAY = 86_400_000;
const command = (requestId: string, revision: number, value: unknown) => ({ format: "wyrdholt-command/1", requestId, revision, command: value });

describe("authoritative profiles", () => {
  it("reopens the same account, content and command journal after a server restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "wyrdholt-authority-test-"));
    const file = join(directory, "test.sqlite");
    const { content } = loadLiveConfig();
    let store: SqliteAuthorityStore | undefined;
    try {
      store = new SqliteAuthorityStore(file);
      const authority = new ProfileAuthority(content, store, () => 10_000);
      const identity = { accountId: "persistent-account" };
      const created = await authority.create(identity, { name: "Persistent", activeClassId: "mage", alternateClassId: "ranger" }, "credential-hash");
      expect(created.ok).toBe(true);
      await authority.submit(identity, command("push", 0, { type: "startPush", zoneId: "greenfields" }));
      store.archiveContent(content.longTermHash, content.snapshot);
      store.close();
      store = undefined;
      store = new SqliteAuthorityStore(file);
      expect(store.authenticate("credential-hash")).toBe(identity.accountId);
      expect(await store.read(identity.accountId)).toMatchObject({ revision: 1, profile: { character: { name: "Persistent" } } });
      expect(store.journal(identity.accountId)).toHaveLength(1);
      expect(store.archivedContent(content.longTermHash)).toEqual(content.snapshot);
    } finally {
      store?.close();
      for (const target of [file, `${file}-wal`, `${file}-shm`]) if (existsSync(target)) unlinkSync(target);
      rmdirSync(directory);
    }
  });

  it("uses the account, rejects developer commands, and replays a single committed command under retry", async () => {
    const { content } = loadLiveConfig();
    const store = new SqliteAuthorityStore(":memory:");
    try {
      let now = 1000;
      const authority = new ProfileAuthority(content, store, () => now);
      const owner = { accountId: "owner" };
      const other = { accountId: "other" };
      const choice = { name: "Owner", activeClassId: "monk", alternateClassId: "mage" };
      expect((await authority.create(owner, choice)).ok).toBe(true);
      expect((await authority.create(owner, choice)).ok).toBe(false);
      expect((await authority.view(other)).ok).toBe(false);
      const before = (await store.read(owner.accountId))!.profile;
      const push = command("first", 0, { type: "startPush", zoneId: "greenfields" });
      expect((await authority.submit(owner, command("bad", 0, { type: "advance", ms: DAY }))).ok).toBe(false);
      expect((await authority.submit(owner, command("dev", 0, { type: "devUnlockZones" }))).ok).toBe(false);
      const results = await Promise.all([authority.submit(owner, push), authority.submit(owner, push)]);
      expect(results[0]).toEqual(results[1]);
      expect(results[0]).toMatchObject({ ok: true, revision: 1 });
      const [first] = store.journal(owner.accountId);
      expect(first).toBeDefined();
      expect(store.journal(owner.accountId)).toHaveLength(1);
      expect(verifyAuthorityReplay(content, before, first!)).toEqual((await store.read(owner.accountId))!.profile);
      expect(verifyAuthorityReplay(content, before, { ...first!, afterHash: "bogus" })).toBeNull();
      expect((await authority.submit(owner, command("first", 1, null))).ok).toBe(false);
      now += 30_000;
      const sync = await authority.submit(owner, command("sync", 1, null));
      expect(sync).toMatchObject({ ok: true, revision: 2 });
      expect((await store.read(owner.accountId))!.profile.clock.simulatedMs).toBe(30_000);
      expect((await authority.view(owner))).not.toHaveProperty("masterSeed");
    } finally { store.close(); }
  });
});

describe("party and live authority over HTTP", () => {
  it("runs dungeons, guild raids and a seasonal ranking with retry-safe rewards", async () => {
    const config = loadLiveConfig();
    const { content } = config;
    const season = [...content.seasons.values()][0]!;
    let now = season.startMs + DAY;
    const store = new SqliteAuthorityStore(":memory:");
    const http = createAuthorityHttp(store, config, { origins: ["http://localhost:5173"], allowRegistration: true, now: () => now });
    await new Promise<void>(resolve => http.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
    type Api = Record<string, any>;
    const call = async (path: string, token?: string, body?: unknown): Promise<Api> => {
      const response = await fetch(`${origin}/v1/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return response.json() as Promise<Api>;
    };

    try {
      expect((await call("profile")).ok).toBe(false);
      const accounts = await Promise.all(["warrior", "mage", "ranger"].map(activeClassId => call("register", undefined, {
        name: `Tester ${activeClassId}`, activeClassId, alternateClassId: "monk",
      })));
      expect(accounts.every(account => account.ok)).toBe(true);
      for (const account of accounts) {
        const key = createHash("sha256").update(account.token).digest("hex");
        const record = (await store.read(store.authenticate(key)!))!;
        const profile = record.profile;
        profile.character.level = 30;
        profile.character.xp = content.levelTotals[29]!;
        const cls = content.classDef(profile.character.activeClassId);
        profile.character.masteryXp[cls.id] = content.masteryTotals(cls.masteryTrackId)[19]!;
        for (const zone of Object.values(profile.adventure.zones)) Object.assign(zone, { unlocked: true, cleared: true, completions: 1, bestStage: 10 });
        for (const item of CONTENT.items.filter(item => item.rarity === "legendary")) {
          profile.equipment[item.slot] = createInstance(profile, item.id, { isNew: false }).id;
        }
        expect(await store.commit(0, { ...record, revision: 1 })).toBe(true);
        expect((await call("borrowing", account.token, { enabled: true })).ok).toBe(true);
      }
      const [leader, first, second] = accounts;
      const guild = await call("guilds", leader!.token, { name: "Ashen Council" });
      for (const ally of [first!, second!]) {
        expect((await call("guilds/invite", leader!.token, { profileId: ally.profileId })).ok).toBe(true);
        expect((await call("guilds/join", ally.token, { guildId: guild.guild.id })).ok).toBe(true);
      }
      expect((await call("guilds/project", leader!.token, {})).ok).toBe(false);
      const alliesFor = (account: Api) => accounts.filter(ally => ally !== account).map(ally => ally.profileId);
      const attempt = { requestId: "briar-1", dungeonId: "briar_vault", allies: alliesFor(leader!) };
      expect((await call("dungeons", leader!.token, { ...attempt, allies: [first!.profileId, first!.profileId] })).ok).toBe(false);
      const pair = await Promise.all([call("dungeons", leader!.token, attempt), call("dungeons", leader!.token, attempt)]);
      expect(pair[0]).toEqual(pair[1]);
      expect(pair[0]).toMatchObject({ ok: true, receipt: { won: true } });
      const fight = pair[0]!.receipt.fights[0] as { record: PartyFightRecord; hash: string };
      expect(replayPartyFight(content, fight.record).hash).toBe(fight.hash);
      expect(new Set(replayPartyFight(content, fight.record).events.filter(event => event.type === "attack" && String(event.src).startsWith("hero")).map(event => event.src))).toEqual(new Set(["hero", "hero1", "hero2"]));
      expect((await call("profile", leader!.token)).gold).toBe(75);
      expect((await call("profile", first!.token)).gold).toBe(75);
      expect((await call("dungeons", leader!.token, { ...attempt, requestId: "different" })).ok).toBe(false);
      for (const ally of [first!, second!]) {
        expect((await call("dungeons", ally.token, { ...attempt, allies: alliesFor(ally) })).receipt.won).toBe(true);
      }
      expect((await call("guilds/project", first!.token, {})).ok).toBe(false);
      expect((await call("guilds/project", leader!.token, {})).ok).toBe(true);
      const opened = await call("raids", leader!.token, { raidId: "cinder_breach" });
      expect(opened.ok).toBe(true);
      const raidId = opened.raid.id;
      let complete = false;
      let firstReceipt: Api | undefined;
      for (let day = 0; day < 3 && !complete; day += 1) {
        for (const [index, account] of accounts.entries()) {
          const payload = { raidId, requestId: `raid-${day}-${index}`, allies: alliesFor(account) };
          const result = await call("raids/contribute", account.token, payload);
          expect(result.ok, String(result.error)).toBe(true);
          if (!firstReceipt) {
            firstReceipt = result;
            expect(await call("raids/contribute", account.token, payload)).toEqual(firstReceipt);
          }
          const social = await call("social", leader!.token);
          complete = social.guild.raids.find((raid: Api) => raid.id === raidId).complete;
          if (complete) break;
        }
        if (!complete) now += DAY;
      }
      expect(complete).toBe(true);
      const beforeClaim = (await call("profile", first!.token)).gold;
      expect((await call("raids/claim", first!.token, { raidId })).ok).toBe(true);
      expect((await call("raids/claim", first!.token, { raidId })).ok).toBe(true);
      expect((await call("profile", first!.token)).gold).toBe(beforeClaim + 300);

      const view = await call("profile", leader!.token);
      const event = await call("events");
      expect(event.active).toBe(season.boss.id);
      const start = await call("commands", leader!.token, command("season", view.revision, { type: "startBoss", bossId: season.boss.id, tier: 1, autoPush: false }));
      expect(start.ok).toBe(true);
      const profile = (await store.readProfile(view.profileId))!.profile;
      now += replayFight(content, activeBossAttempt(profile)!.record).summary.durationMs + 100;
      const settled = await call("commands", leader!.token, command("season-sync", start.revision, null));
      expect(settled.ok).toBe(true);
      const ranked = await call("leaderboard", leader!.token, { format: "wyrdholt-leaderboard-submission/1", seasonId: season.boss.id, revision: settled.revision, tier: 999 });
      expect(ranked.entry.tier).toBe(1);
      expect((await call(`leaderboard?season=${season.boss.id}`)).entries).toEqual([ranked.entry]);
      expect(store.archivedContent(fight.record.contentHash)).toEqual(content.snapshot);
    } finally {
      await new Promise<void>(resolve => http.close(() => resolve()));
      store.close();
    }
  });

  it("adds a future rotation without invalidating pinned seasons or raids and rejects overlap", () => {
    const base = loadLiveConfig();
    const [first, last] = [...base.content.seasons.values()];
    const manifest = { format: "wyrdholt-live-config/1", version: "winter", rotations: [{ id: "red_moon", template: first!.boss.id,
      name: "Red Moon", startMs: last!.endMs, days: 42, tierDays: 7 }] };
    const update = loadLiveConfig(manifest);
    expect(update.hash).not.toBe(base.hash);
    expect(update.content.seasonHashes.get(first!.boss.id)).toBe(base.content.seasonHashes.get(first!.boss.id));
    expect(update.content.socialHash).toBe(base.content.socialHash);
    expect(liveEvents(update, last!.endMs).active).toBe("season_red_moon");
    expect(() => loadLiveConfig({ ...manifest, rotations: [{ ...manifest.rotations[0], startMs: last!.startMs }] })).toThrow("Invalid season");
  });
});
