import { parseSave, type ParseResult } from "./codec";

/**
 * Crash-safe save writing, independent of the storage backend.
 * The mobile app implements SaveFileAdapter with Capacitor Filesystem
 * (native app storage on Android/iOS, IndexedDB in the browser build).
 */
export interface SaveFileAdapter {
  read(path: string): Promise<string | null>;
  write(path: string, data: string): Promise<void>;
  remove(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

export interface SavePaths {
  main: string;
  temp: string;
  backup: string;
}

export const DEFAULT_SAVE_PATHS: SavePaths = {
  main: "saves/profile.json",
  temp: "saves/profile.tmp.json",
  backup: "saves/profile.bak.json",
};

/**
 * 1. write temp  2. verify temp  3. copy current main to backup
 * 4. replace main with temp.
 * At every crash point at least one valid save (main, temp or backup) exists.
 */
export async function writeSaveSafely(fs: SaveFileAdapter, data: string, paths: SavePaths = DEFAULT_SAVE_PATHS): Promise<void> {
  await fs.write(paths.temp, data);
  const check = await fs.read(paths.temp);
  if (check !== data || !parseSave(check).ok) {
    throw new Error("Save verification failed; previous save kept.");
  }
  const current = await fs.read(paths.main);
  if (current !== null && parseSave(current).ok) {
    await fs.write(paths.backup, current);
  }
  if (current !== null) await fs.remove(paths.main);
  await fs.rename(paths.temp, paths.main);
}

export type LoadOutcome =
  | { status: "loaded"; source: "main" | "temp" | "backup"; result: Extract<ParseResult, { ok: true }>; problems: string[] }
  | { status: "empty"; problems: string[] }
  | { status: "corrupt"; problems: string[] };

/** Newest valid save wins: main, then a verified temp, then backup. */
export async function loadSaveSafely(fs: SaveFileAdapter, paths: SavePaths = DEFAULT_SAVE_PATHS): Promise<LoadOutcome> {
  const problems: string[] = [];
  let sawData = false;
  const candidates: { source: "main" | "temp" | "backup"; path: string }[] = [
    { source: "main", path: paths.main },
    { source: "temp", path: paths.temp },
    { source: "backup", path: paths.backup },
  ];
  const valid: { source: "main" | "temp" | "backup"; result: Extract<ParseResult, { ok: true }> }[] = [];
  for (const c of candidates) {
    let text: string | null = null;
    try {
      text = await fs.read(c.path);
    } catch (error) {
      problems.push(`${c.source}: read failed (${String(error)})`);
    }
    if (text === null) continue;
    sawData = true;
    const parsed = parseSave(text);
    if (parsed.ok) valid.push({ source: c.source, result: parsed });
    else problems.push(`${c.source}: ${parsed.reason}`);
  }
  if (valid.length === 0) return sawData ? { status: "corrupt", problems } : { status: "empty", problems };
  // Prefer the most recently saved valid file (main normally wins).
  valid.sort((a, b) => b.result.envelope.savedAtWallMs - a.result.envelope.savedAtWallMs);
  const best = valid[0]!;
  return { status: "loaded", source: best.source, result: best.result, problems };
}

/** In-memory adapter for tests and tools. `failAt` simulates a crash. */
export class MemorySaveFs implements SaveFileAdapter {
  readonly files = new Map<string, string>();
  failAt: { op: "write" | "remove" | "rename"; path?: string; after?: number } | null = null;
  private ops = 0;

  private maybeFail(op: "write" | "remove" | "rename", path: string): void {
    if (!this.failAt || this.failAt.op !== op) return;
    if (this.failAt.path !== undefined && this.failAt.path !== path) return;
    this.ops += 1;
    if (this.ops > (this.failAt.after ?? 0)) throw new Error(`simulated crash during ${op} ${path}`);
  }

  async read(path: string): Promise<string | null> {
    return this.files.get(path) ?? null;
  }
  async write(path: string, data: string): Promise<void> {
    this.maybeFail("write", path);
    this.files.set(path, data);
  }
  async remove(path: string): Promise<void> {
    this.maybeFail("remove", path);
    this.files.delete(path);
  }
  async rename(from: string, to: string): Promise<void> {
    this.maybeFail("rename", from);
    const data = this.files.get(from);
    if (data === undefined) throw new Error(`rename: missing ${from}`);
    this.files.set(to, data);
    this.files.delete(from);
  }
}
