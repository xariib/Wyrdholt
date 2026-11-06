import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const bridge = vi.hoisted(() => ({
  platform: "android", readFile: vi.fn(), writeFile: vi.fn(), deleteFile: vi.fn(), rename: vi.fn(),
}));
vi.mock("@capacitor/core", async (original) => {
  const real = await original<typeof import("@capacitor/core")>();
  return { ...real, Capacitor: { ...real.Capacitor, getPlatform: () => bridge.platform, isNativePlatform: () => bridge.platform !== "web" } };
});
vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA" }, Encoding: { UTF8: "utf8" },
  Filesystem: bridge,
}));
import { FilesystemWeb } from "@capacitor/filesystem/dist/esm/web";
import { CapacitorSaveFs, SAVE_LOCK_NAME, withStorageOwnership } from "../src/platform/storage";
import { isMissingFile, SaveStorageError } from "../src/platform/storageErrors";

beforeEach(() => { vi.resetAllMocks(); bridge.platform = "android"; });
afterEach(() => vi.unstubAllGlobals());
const nativeError = (code: string | number) => Object.assign(new Error("synthetic storage failure"), { code });

describe("Filesystem 8.1.3 actual adapter and missing classification", () => {
  it.each(["android", "ios"])("maps only native missing on %s read/remove", async platform => {
    bridge.platform = platform;
    bridge.readFile.mockRejectedValue(nativeError("OS-PLUG-FILE-0008"));
    bridge.deleteFile.mockRejectedValue(nativeError("OS-PLUG-FILE-0008"));
    const fs = new CapacitorSaveFs();
    await expect(fs.read("save")).resolves.toBeNull();
    await expect(fs.remove("save")).resolves.toBeUndefined();
  });
  it.each(["0004", "0005", "0006", "0007", "0009", "0010", "0011", "0012", "0013", "9999"])("propagates native %s on read and remove", async suffix => {
    const error = nativeError("OS-PLUG-FILE-" + suffix);
    bridge.readFile.mockRejectedValue(error);
    bridge.deleteFile.mockRejectedValue(error);
    const fs = new CapacitorSaveFs();
    await expect(fs.read("save")).rejects.toMatchObject({ name: "SaveStorageError", operation: "read", code: error.code });
    await expect(fs.remove("save")).rejects.toMatchObject({ name: "SaveStorageError", operation: "remove", code: error.code });
  });
  it.each([new Error("File does not exist."), nativeError(8), nativeError("ENOENT"), { message: "missing" }, Object.assign(new Error("missing"), { code: undefined })])("does not classify native lookalikes as missing: %s", async error => {
    bridge.readFile.mockRejectedValue(error);
    bridge.deleteFile.mockRejectedValue(error);
    await expect(new CapacitorSaveFs().read("save")).rejects.toBeInstanceOf(SaveStorageError);
    await expect(new CapacitorSaveFs().remove("save")).rejects.toBeInstanceOf(SaveStorageError);
  });
  it("write and rename missing codes are failures", async () => {
    const error = nativeError("OS-PLUG-FILE-0008");
    bridge.writeFile.mockRejectedValue(error); bridge.rename.mockRejectedValue(error);
    const fs = new CapacitorSaveFs();
    await expect(fs.write("save", "text")).rejects.toMatchObject({ operation: "write", code: error.code });
    await expect(fs.rename("temp", "save")).rejects.toMatchObject({ operation: "rename", code: error.code });
    expect(isMissingFile(error, "android", "write")).toBe(false);
    expect(isMissingFile(error, "android", "rename")).toBe(false);
  });
  it("Blob decode exceptions never become missing", async () => {
    bridge.platform = "web";
    bridge.readFile.mockResolvedValue({ data: { text: async () => { throw new Error("File does not exist."); } } });
    await expect(new CapacitorSaveFs().read("save")).rejects.toMatchObject({ operation: "decode" });
    bridge.readFile.mockResolvedValue({ data: new Blob(["æøå"]) });
    await expect(new CapacitorSaveFs().read("save")).resolves.toBe("æøå");
  });
  it("keeps Directory.Data, UTF8 and canonical paths", async () => {
    bridge.readFile.mockResolvedValue({ data: "" });
    bridge.writeFile.mockResolvedValue(undefined); bridge.rename.mockResolvedValue(undefined);
    const fs = new CapacitorSaveFs();
    await expect(fs.read("saves/profile.json")).resolves.toBe("");
    await fs.write("saves/profile.tmp.json", "text"); await fs.rename("a", "b");
    expect(bridge.readFile).toHaveBeenCalledWith({ path: "saves/profile.json", directory: "DATA", encoding: "utf8" });
    expect(bridge.writeFile).toHaveBeenCalledWith({ path: "saves/profile.tmp.json", data: "text", directory: "DATA", encoding: "utf8", recursive: true });
    expect(bridge.rename).toHaveBeenCalledWith({ from: "a", to: "b", directory: "DATA", toDirectory: "DATA" });
  });
  it.each(["readFile", "deleteFile"] as const)("uses installed FilesystemWeb %s missing error, while real DB errors propagate", async operation => {
    bridge.platform = "web";
    const web = new FilesystemWeb();
    const db = vi.spyOn(web as unknown as { dbRequest(action: string, args: unknown[]): Promise<unknown> }, "dbRequest");
    db.mockResolvedValue(undefined);
    bridge.readFile.mockImplementation(options => web.readFile(options));
    bridge.deleteFile.mockImplementation(options => web.deleteFile(options));
    const fs = new CapacitorSaveFs();
    if (operation === "readFile") await expect(fs.read("save")).resolves.toBeNull();
    else await expect(fs.remove("save")).resolves.toBeUndefined();
    for (const name of ["UnknownError", "SecurityError", "QuotaExceededError", "InvalidStateError"]) {
      db.mockRejectedValue(new DOMException("transaction failed", name));
      if (operation === "readFile") await expect(fs.read("save")).rejects.toMatchObject({ operation: "read" });
      else await expect(fs.remove("save")).rejects.toMatchObject({ operation: "remove" });
    }
  });
  it.each([new Error("Parent file does not exist."), new DOMException("File does not exist.", "Error"), { message: "File does not exist." }, Object.assign(new Error("File does not exist."), { code: undefined })])("rejects web missing lookalikes: %s", error => {
    expect(isMissingFile(error, "web", "read")).toBe(false);
  });
});

describe("native queue and cooperative web ownership", () => {
  it("serializes native operations and recovers the tail after rejection", async () => {
    const seen: number[] = [];
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    const first = withStorageOwnership(async () => { seen.push(1); await wait; throw new Error("first"); });
    const firstCheck = expect(first).rejects.toThrow("first");
    const second = withStorageOwnership(async () => { seen.push(2); return "second"; });
    await Promise.resolve(); expect(seen).toEqual([1]); release();
    await firstCheck; await expect(second).resolves.toBe("second"); expect(seen).toEqual([1, 2]);
  });
  it("fails closed without Web Locks or when occupied", async () => {
    bridge.platform = "web";
    vi.stubGlobal("navigator", {});
    const work = vi.fn(async () => "write");
    await expect(withStorageOwnership(work)).rejects.toMatchObject({ operation: "ownership" });
    vi.stubGlobal("navigator", { locks: { request: async (_name: string, _options: unknown, callback: (lock: null) => Promise<unknown>) => callback(null) } });
    await expect(withStorageOwnership(work)).rejects.toMatchObject({ operation: "ownership" });
    expect(work).not.toHaveBeenCalled();
  });
  it("uses a stable exclusive lock for the entire awaited operation and propagates rejection", async () => {
    bridge.platform = "web";
    const seen: string[] = [];
    const request = vi.fn(async (_name: string, _options: unknown, callback: (lock: { name: string }) => Promise<unknown>) => {
      seen.push("acquire"); try { return await callback({ name: SAVE_LOCK_NAME }); } finally { seen.push("release"); }
    });
    vi.stubGlobal("navigator", { locks: { request } });
    await expect(withStorageOwnership(async () => { seen.push("work"); await Promise.resolve(); seen.push("awaited"); return "ok"; })).resolves.toBe("ok");
    expect(seen).toEqual(["acquire", "work", "awaited", "release"]);
    expect(request).toHaveBeenCalledWith(SAVE_LOCK_NAME, { mode: "exclusive", ifAvailable: true }, expect.any(Function));
    await expect(withStorageOwnership(async () => { throw new Error("operation failed"); })).rejects.toThrow("operation failed");
  });
});
