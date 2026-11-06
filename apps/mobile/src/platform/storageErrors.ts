export type StorageOperation = "read" | "decode" | "write" | "remove" | "rename" | "ownership";

export function storageErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

/** Filesystem 8.1.3: native codes and web errors are different contracts. */
export function isMissingFile(error: unknown, platform: string, operation: StorageOperation): boolean {
  if (operation !== "read" && operation !== "remove") return false;
  if (platform === "android" || platform === "ios") return storageErrorCode(error) === "OS-PLUG-FILE-0008";
  return platform === "web" && error instanceof Error && error.name === "Error"
    && !("code" in error) && error.message === "File does not exist.";
}

/** The original error stays private to the adapter/controller, outside UiState. */
export class SaveStorageError extends Error {
  readonly code: string | undefined;
  constructor(readonly operation: StorageOperation, readonly path: string, readonly original: unknown) {
    super(`Save storage ${operation} failed.`, { cause: original });
    this.name = "SaveStorageError";
    this.code = storageErrorCode(original);
  }
}
