import { DatabaseSync } from "node:sqlite";
import type { ContentSnapshot } from "@emberbound/shared-types";
import type { CommandJournalEntry } from "./commands";
import type { AuthorityProfile, AuthorityStore, ProfileChange } from "./profiles";
import { emptySocialState, type SocialState } from "../social/state";

function readJson<T>(row: Record<string, unknown> | undefined): T | null {
  return typeof row?.body === "string" ? JSON.parse(row.body) as T : null;
}

export class SqliteAuthorityStore implements AuthorityStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS profiles (
        account_id TEXT PRIMARY KEY, profile_id TEXT UNIQUE NOT NULL,
        credential_hash TEXT UNIQUE, revision INTEGER NOT NULL, body TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS command_journal (
        account_id TEXT NOT NULL REFERENCES profiles(account_id), revision INTEGER NOT NULL,
        body TEXT NOT NULL, PRIMARY KEY (account_id, revision)
      );
      CREATE TABLE IF NOT EXISTS social (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1), revision INTEGER NOT NULL, body TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS content_archive (hash TEXT PRIMARY KEY, body TEXT NOT NULL);
    `);
    this.db.prepare("INSERT OR IGNORE INTO social VALUES (1, 0, ?)").run(JSON.stringify(emptySocialState()));
  }

  close(): void { this.db.close(); }

  authenticate(credentialHash: string): string | null {
    const row = this.db.prepare("SELECT account_id FROM profiles WHERE credential_hash = ?").get(credentialHash);
    return typeof row?.account_id === "string" ? row.account_id : null;
  }

  async read(accountId: string): Promise<AuthorityProfile | null> {
    return readJson(this.db.prepare("SELECT body FROM profiles WHERE account_id = ?").get(accountId));
  }

  async readProfile(profileId: string): Promise<AuthorityProfile | null> {
    return readJson(this.db.prepare("SELECT body FROM profiles WHERE profile_id = ?").get(profileId));
  }

  async insert(record: AuthorityProfile, credentialHash?: string): Promise<boolean> {
    return this.db.prepare("INSERT OR IGNORE INTO profiles VALUES (?, ?, ?, ?, ?)")
      .run(record.accountId, record.profileId, credentialHash ?? null, record.revision, JSON.stringify(record)).changes === 1;
  }

  private transaction(work: () => boolean): boolean {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const committed = work();
      this.db.exec(committed ? "COMMIT" : "ROLLBACK");
      return committed;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private replace(revision: number, record: AuthorityProfile): boolean {
    return record.revision === revision + 1 && this.db.prepare(
      "UPDATE profiles SET revision = ?, body = ? WHERE account_id = ? AND profile_id = ? AND revision = ?",
    ).run(record.revision, JSON.stringify(record), record.accountId, record.profileId, revision).changes === 1;
  }

  async commit(expectedRevision: number, record: AuthorityProfile, journal?: CommandJournalEntry): Promise<boolean> {
    return this.transaction(() => {
      if (!this.replace(expectedRevision, record)) return false;
      if (journal) this.db.prepare("INSERT INTO command_journal VALUES (?, ?, ?)").run(record.accountId, record.revision, JSON.stringify(journal));
      return true;
    });
  }

  journal(accountId: string): CommandJournalEntry[] {
    return this.db.prepare("SELECT body FROM command_journal WHERE account_id = ? ORDER BY revision").all(accountId)
      .map(row => readJson<CommandJournalEntry>(row)!);
  }

  archiveContent(hash: string, content: ContentSnapshot): void {
    this.db.prepare("INSERT OR IGNORE INTO content_archive VALUES (?, ?)").run(hash, JSON.stringify(content));
  }

  archivedContent(hash: string): ContentSnapshot | null {
    return readJson(this.db.prepare("SELECT body FROM content_archive WHERE hash = ?").get(hash));
  }

  async rankings(seasonId: string) {
    return this.db.prepare("SELECT body FROM profiles").all().flatMap(row => {
      const entry = readJson<AuthorityProfile>(row)?.leaderboard[seasonId];
      return entry ? [entry] : [];
    });
  }

  async readSocial(): Promise<SocialState> {
    return readJson<SocialState>(this.db.prepare("SELECT body FROM social WHERE singleton = 1").get())!;
  }

  async commitSocial(expectedRevision: number, state: SocialState, profiles: ProfileChange[]): Promise<boolean> {
    if (state.revision !== expectedRevision + 1 || new Set(profiles.map(p => p.accountId)).size !== profiles.length) return false;
    return this.transaction(() => {
      for (const change of profiles) {
        if (change.update) {
          if (change.update.accountId !== change.accountId || !this.replace(change.revision, change.update)) return false;
        } else if (this.db.prepare("SELECT revision FROM profiles WHERE account_id = ?").get(change.accountId)?.revision !== change.revision) return false;
      }
      return this.db.prepare("UPDATE social SET revision = ?, body = ? WHERE singleton = 1 AND revision = ?")
        .run(state.revision, JSON.stringify(state), expectedRevision).changes === 1;
    });
  }
}
