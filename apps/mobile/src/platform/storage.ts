import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import type { SaveFileAdapter } from "@emberbound/game-core";
import { isMissingFile, SaveStorageError } from "./storageErrors";

export type SaveOwnership = <T>(work: () => Promise<T>) => Promise<T>;
/** Stable across app versions; only cooperating same-origin writers participate. */
export const SAVE_LOCK_NAME = "wyrdholt-save/Directory.Data/saves";
let nativeTail: Promise<void> = Promise.resolve();

export const withStorageOwnership: SaveOwnership = async <T>(work: () => Promise<T>): Promise<T> => {
  if (Capacitor.isNativePlatform()) {
    const result = nativeTail.then(work);
    nativeTail = result.then(() => undefined, () => undefined);
    return result;
  }
  if (typeof navigator === "undefined" || !navigator.locks) {
    return Promise.reject(new SaveStorageError("ownership", SAVE_LOCK_NAME, new Error("Web Locks unavailable.")));
  }
  return await navigator.locks.request(SAVE_LOCK_NAME, { mode: "exclusive", ifAvailable: true }, (lock) => {
    if (!lock) throw new SaveStorageError("ownership", SAVE_LOCK_NAME, new Error("Save writer already owned."));
    return work();
  });
};

/**
 * Save files through Capacitor Filesystem.
 * - Android/iOS: files in the app's private data directory (not WebView storage,
 *   which the OS may clear).
 * - Browser build: Capacitor's web implementation (IndexedDB).
 * The crash-safe write sequence lives in game-core (writeSaveSafely).
 */
export class CapacitorSaveFs implements SaveFileAdapter {
  private readonly directory = Directory.Data;

  async read(path: string): Promise<string | null> {
    let result;
    try {
      result = await Filesystem.readFile({ path, directory: this.directory, encoding: Encoding.UTF8 });
    } catch (error) {
      if (isMissingFile(error, Capacitor.getPlatform(), "read")) return null;
      throw new SaveStorageError("read", path, error);
    }
    // A Blob decode failure is not a missing-file result from the bridge.
    try {
      return typeof result.data === "string" ? result.data : await result.data.text();
    } catch (error) {
      throw new SaveStorageError("decode", path, error);
    }
  }

  async write(path: string, data: string): Promise<void> {
    try {
      await Filesystem.writeFile({ path, data, directory: this.directory, encoding: Encoding.UTF8, recursive: true });
    } catch (error) { throw new SaveStorageError("write", path, error); }
  }

  async remove(path: string): Promise<void> {
    try {
      await Filesystem.deleteFile({ path, directory: this.directory });
    } catch (error) {
      if (!isMissingFile(error, Capacitor.getPlatform(), "remove")) throw new SaveStorageError("remove", path, error);
    }
  }

  async rename(from: string, to: string): Promise<void> {
    try {
      await Filesystem.rename({ from, to, directory: this.directory, toDirectory: this.directory });
    } catch (error) { throw new SaveStorageError("rename", from, error); }
  }
}

export function storageDescription(): string {
  return Capacitor.isNativePlatform()
    ? `Native app storage (${Capacitor.getPlatform()}, Directory.Data)`
    : "Browser IndexedDB (Capacitor Filesystem web implementation)";
}
