import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CONTENT } from "@emberbound/game-content";
import { ContentIndex } from "@emberbound/game-core";
import type { ActionOutcome, GateInfo, SaveIntent, UiState } from "../src/game/session";

// Capture actual JSX event callbacks during React SSR. This is a Node consumer
// contract test, not a DOM/focus/browser or physical-device test. State setters
// are recorded, and seeded confirmations stand in for a previous preview render.
const h = vi.hoisted(() => ({
  ui: {} as UiState, props: [] as { type: unknown; props: Record<string, any> }[],
  index: 0, seeds: new Map<number, unknown>(), updates: [] as { index: number; value: unknown }[],
  session: {} as Record<string, any>,
}));
vi.mock("react", async original => {
  const real = await original<typeof import("react")>();
  return { ...real, useState: (initial: unknown) => {
    const index = h.index++, [value] = real.useState(h.seeds.has(index) ? h.seeds.get(index) : initial);
    return [value, (next: unknown) => { h.updates.push({ index, value: next }); }];
  } };
});
vi.mock("react/jsx-runtime", async original => {
  const real = await original<typeof import("react/jsx-runtime")>();
  const wrap = (fn: typeof real.jsx) => (type: unknown, props: Record<string, any>, key: unknown) => {
    h.props.push({ type, props }); return fn(type as any, props, key as any);
  };
  return { ...real, jsx: wrap(real.jsx), jsxs: wrap(real.jsxs) };
});
vi.mock("react/jsx-dev-runtime", async original => {
  const real = await original<typeof import("react/jsx-dev-runtime")>();
  return { ...real, jsxDEV: (...args: Parameters<typeof real.jsxDEV>) => {
    h.props.push({ type: args[0], props: args[1] }); return real.jsxDEV(...args);
  } };
});
let fixtureListener: (() => void) | null = null;
// Model the two synchronous public startup publications used by actual PR3.
// Existing configured method mocks/outcome assertions stay unchanged. These are
// controlled callback fixtures; actual constructor traces are checked separately.
vi.mock("../src/game/session", () => ({ session: new Proxy(h.session, { get(target, key) {
  if (key === "subscribe") return (listener: () => void) => { fixtureListener = listener; return () => { if (fixtureListener === listener) fixtureListener = null; }; };
  if (key !== "retryStorage" && key !== "init") return target[key as string];
  return (...args: unknown[]) => {
    const before = h.ui;
    h.ui = { ...before, version: before.version + 1, phase: key === "init" ? "loading" : "storage-blocked" };
    fixtureListener?.();
    h.ui = { ...h.ui, version: before.version + 2, save: { ...h.ui.save, gate: { ...h.ui.save.gate, mode: "uninspected", generation: before.save.gate.generation + 1 } } };
    fixtureListener?.();
    return target[key as string](...args);
  };
} }) }));

vi.mock("../src/ui/hooks", () => ({ useUi: () => h.ui }));
vi.mock("../src/platform/device", () => ({ DEV_TOOLS: true, BUILD_ID: "test", BUILD_TIME: "test", GIT_COMMIT: "fixture", GIT_BRANCH: "fixture", engineDescription: () => "Node mock", memoryInfo: () => null, platformName: () => "mock" }));
vi.mock("../src/platform/perfMonitor", () => ({ perfMonitor: { lastBenchmark: null, snapshot: () => ({}) }, P1_WINDOW_MS: 1 }));
vi.mock("../src/platform/backNavigation", () => ({ registerBackAction: () => () => {} }));
vi.mock("../src/ui/components/icons", () => ({ SpriteImage: () => null, NavIcon: () => null }));
vi.mock("../src/ui/components/Common", () => ({
  Sheet: ({ children }: { children: any }) => createElement("div", null, children),
  Header: () => { throw new Error("Paused profile reached Header"); },
  Busy: () => null, ToastView: () => null,
}));
vi.mock("../src/ui/screens/Adventure", () => ({ AdventureScreen: () => { throw new Error("Paused profile reached gameplay"); } }));
vi.mock("../src/ui/screens/Character", () => ({ CharacterScreen: () => null }));
vi.mock("../src/ui/screens/Gear", () => ({ GearScreen: () => null }));
vi.mock("../src/ui/gearModel", () => ({ totalNew: () => { throw new Error("Paused profile reached Profile computation"); } }));
vi.mock("../src/ui/overlays/Overlays", () => ({ OfflineOverlay: () => null, RunResultOverlay: () => null }));
import { App } from "../src/App";
import { SaveRecoveryScreen, actionFailureText } from "../src/ui/screens/SaveRecovery";
import { CreateCharacterScreen } from "../src/ui/screens/CreateCharacter";
import { DebugPanel } from "../src/ui/debug/DebugPanel";

const gate = (mode: GateInfo["mode"], generation = 10): GateInfo => ({ mode, generation,
  slots: [{ slot: "main", status: "valid" }, { slot: "temp", status: "missing" }, { slot: "backup", status: "missing" }],
  canCreate: mode === "verified-empty", canImport: mode === "verified-empty" || mode === "writable", canReset: mode === "writable",
  ...(mode === "blocked" ? { reason: "io" as const } : {}),
});
const receipt = { status: "saved" as const, savedAtWallMs: 42, bytes: 12, mainHash: "hash", readbackVerified: true as const, durability: "not-verified" as const };
const intent = (kind: SaveIntent["kind"]): SaveIntent => Object.freeze({ kind, generation: 10, snapshotHash: "snapshot", textHash: "text" });
function render(Component: any, props = {}) { h.index = 0; h.props = []; return renderToStaticMarkup(createElement(Component, props)); }
function label(children: any): string { return Array.isArray(children) ? children.map(label).join("") : typeof children === "string" || typeof children === "number" ? String(children) : children?.props ? label(children.props.children) : ""; }
function button(name: string) { const node = h.props.find(n => n.type === "button" && label(n.props.children) === name); expect(node, name).toBeDefined(); return node!.props; }
function input() { return h.props.find(n => n.type === "textarea" && n.props.id === "import-save")!.props; }
function debug(close = vi.fn()) { render(DebugPanel, { onClose: close, overlay: false, setOverlay: vi.fn() }); return close; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
beforeEach(() => {
  h.seeds.clear(); h.updates = []; h.props = []; h.index = 0;
  h.ui = { version: 1, phase: "playing", profile: null, offline: null, runResult: null, toast: null, notice: null, error: null, busy: null,
    save: { gate: gate("writable"), lastSavedWallMs: null, bytes: 0, mainHash: null, storage: "mock", loadedFrom: "main", problems: [] } };
  Object.assign(h.session, { content: new ContentIndex(CONTENT), getSnapshot: () => h.ui,
    createCharacter: vi.fn(), retryStorage: vi.fn(), init: vi.fn(), readObservedSave: vi.fn(),
    prepareImport: vi.fn(), importSave: vi.fn(), prepareReset: vi.fn(), resetSave: vi.fn(),
    simulateOfflineReturn: vi.fn(), exportSave: vi.fn(() => ""), lastSettlement: null });
  vi.stubGlobal("window", {});
});

describe("SG30 UI routes and read-only recovery", () => {
  it.each(["playing", "error", "create", "storage-blocked"] as const)("blocked gate wins over %s and retained profile", phase => {
    h.ui.phase = phase; h.ui.save.gate = gate("blocked");
    h.ui.profile = new Proxy({}, { get() { throw new Error("Profile inspected"); } }) as any;
    const html = render(App); expect(html).toContain("Adventure paused"); expect(html).not.toContain("Begin in Greenfields"); expect(html).not.toContain("Reset save");
  });
  it("uninspected renders loading and cannot create", () => { h.ui.phase = "create"; h.ui.save.gate = gate("uninspected"); expect(render(App)).toContain("Checking saved adventure"); expect(h.session.createCharacter).not.toHaveBeenCalled(); });
  it("missing profile with writable gate is not permission to create", () => { expect(render(App)).toContain("Adventure paused"); });
  it("verified-empty alone exposes explicit create", () => { h.ui.phase = "create"; h.ui.save.gate = gate("verified-empty"); expect(render(App)).toContain("Begin in Greenfields"); expect(h.session.createCharacter).not.toHaveBeenCalled(); });
  it("compatible retry is read-only and Continue is a separate action", async () => {
    h.ui.phase = "storage-blocked"; h.ui.save.gate = gate("blocked");
    h.session.retryStorage.mockImplementation(async () => { h.ui.save.gate = gate("writable", 11); return h.ui.save.gate; });
    render(SaveRecoveryScreen); await button("Check again (read only)").onClick();
    // UI handler is fire-and-forget; let its await continuation complete.
    await Promise.resolve(); expect(h.session.retryStorage).toHaveBeenCalledTimes(1); expect(h.session.init).not.toHaveBeenCalled();
    expect(h.updates.some(u => String(u.value).includes("Select Continue"))).toBe(true);
    render(SaveRecoveryScreen); expect(button("Continue")).toBeDefined();
    h.session.init.mockImplementation(async () => { h.ui.save.gate = gate("writable", 12); h.ui.phase = "playing"; });
    button("Continue").onClick(); await Promise.resolve(); expect(h.session.init).toHaveBeenCalledTimes(1);
  });
  it("retry double-submit is locally guarded and newer generation cannot report success", async () => {
    const d = deferred<GateInfo>(); h.ui.phase = "storage-blocked"; h.ui.save.gate = gate("blocked");
    h.session.retryStorage.mockImplementation(() => { h.ui.save.gate = gate("uninspected", 11); return d.promise; });
    render(SaveRecoveryScreen); const click = button("Check again (read only)").onClick; click(); click();
    expect(h.session.retryStorage).toHaveBeenCalledTimes(1); h.ui.save.gate = gate("writable", 12); d.resolve(h.ui.save.gate); await Promise.resolve();
    expect(h.updates.some(u => String(u.value).includes("changed during the check"))).toBe(true);
  });
  it("raw access preserves exact text and never resumes", () => {
    h.ui.phase = "storage-blocked"; h.ui.save.gate = gate("blocked"); h.session.readObservedSave.mockReturnValue(" \r\n{broken}\t ");
    render(SaveRecoveryScreen); button("View observed main text").onClick();
    expect(h.updates.find(u => u.index === 2)?.value).toEqual({ slot: "main", text: " \r\n{broken}\t ", generation: 10 });
    expect(h.session.init).not.toHaveBeenCalled(); expect(h.session.resetSave).not.toHaveBeenCalled();
  });
  it("null raw observation is not export success and missing/error slots offer no view", () => {
    h.ui.phase = "storage-blocked"; h.ui.save.gate = gate("blocked"); h.session.readObservedSave.mockReturnValue(null);
    render(SaveRecoveryScreen); button("View observed main text").onClick();
    expect(h.updates.some(u => String(u.value).includes("No readable text"))).toBe(true);
    h.ui.save.gate.slots = [{ slot: "main", status: "error" }, { slot: "backup", status: "missing" }];
    expect(render(SaveRecoveryScreen)).not.toContain("View observed");
  });
  it("pending recovery disables retry, Continue and observed access", () => {
    h.ui.phase = "storage-blocked"; h.seeds.set(0, "retry"); render(SaveRecoveryScreen);
    expect(button("Check again (read only)").disabled).toBe(true); expect(button("Continue").disabled).toBe(true); expect(button("View observed main text").disabled).toBe(true);
  });
  it("retry failure reports pause and cannot resume", async () => {
    h.ui.phase = "storage-blocked"; h.ui.save.gate = gate("blocked"); h.session.retryStorage.mockRejectedValue(new Error("private payload"));
    render(SaveRecoveryScreen); button("Check again (read only)").onClick(); await Promise.resolve();
    expect(h.session.init).not.toHaveBeenCalled(); expect(JSON.stringify(h.updates)).toContain("could not be completed"); expect(JSON.stringify(h.updates)).not.toContain("private payload");
  });
  it("Continue is awaited, guarded against double tap and detects stale generation", async () => {
    h.ui.phase = "storage-blocked"; const d = deferred<void>();
    h.session.init.mockImplementation(() => { h.ui.save.gate = gate("uninspected", 11); return d.promise; });
    render(SaveRecoveryScreen); const click = button("Continue").onClick; click(); click(); expect(h.session.init).toHaveBeenCalledTimes(1);
    h.ui.save.gate = gate("writable", 12); d.resolve(); await Promise.resolve(); expect(JSON.stringify(h.updates)).toContain("changed during the check");
  });
  it("raw download uses the exact observed text and cannot unlock storage", async () => {
    const raw = " \r\n{broken}\t "; h.ui.phase = "storage-blocked"; h.ui.save.gate = gate("blocked"); h.seeds.set(2, { slot: "main", text: raw, generation: 10 });
    const clicked = vi.fn(); let downloaded: Blob | undefined;
    vi.spyOn(URL, "createObjectURL").mockImplementation(blob => { downloaded = blob as Blob; return "blob:fixture"; });
    vi.stubGlobal("document", { createElement: () => ({ click: clicked }) });
    render(SaveRecoveryScreen); button("Download observed text").onClick(); expect(downloaded?.size).toBe(new TextEncoder().encode(raw).length); expect(await downloaded?.text()).toBe(raw); expect(clicked).toHaveBeenCalledOnce(); expect(h.ui.save.gate.mode).toBe("blocked"); expect(h.session.init).not.toHaveBeenCalled();
  });
});

describe("SG30 typed create/import/reset consumers", () => {
  it("create awaits and double-submit is guarded", async () => {
    h.ui.phase = "create"; h.ui.save.gate = gate("verified-empty"); const d = deferred<ActionOutcome>(); h.session.createCharacter.mockReturnValue(d.promise);
    render(CreateCharacterScreen); const click = button("Begin in Greenfields").onClick; click(); click();
    expect(h.session.createCharacter).toHaveBeenCalledTimes(1); expect(h.updates.some(u => u.index === 4 && u.value === true)).toBe(true);
    d.resolve({ status: "failed", stage: "main-readback", storageMayHaveChanged: true }); await Promise.resolve();
    expect(h.updates.some(u => u.index === 3 && String(u.value).includes("could not be completed"))).toBe(true);
  });
  it.each(["blocked", "skipped", "rejected"] as const)("create %s is not success", async status => {
    h.ui.save.gate = gate("verified-empty"); h.session.createCharacter.mockResolvedValue(status === "blocked" ? { status, reason: "io", generation: 10 } : status === "skipped" ? { status, reason: "stale-generation" } : { status, reason: "invalid", message: "raw stack must not show" });
    render(CreateCharacterScreen); button("Begin in Greenfields").onClick(); await Promise.resolve();
    expect(h.updates.some(u => u.index === 3 && typeof u.value === "string" && u.value.length > 0)).toBe(true); expect(JSON.stringify(h.updates)).not.toContain("raw stack");
  });
  it("prepare import receives untrimmed text and never commits on preview", () => {
    const text = " \n{}\t ", original = intent("import"); h.seeds.set(8, text); h.session.prepareImport.mockReturnValue({ status: "ready", intent: original });
    debug(); button("Review pasted save").onClick(); expect(h.session.prepareImport).toHaveBeenCalledWith(text); expect(h.session.importSave).not.toHaveBeenCalled(); expect(h.updates.find(u => u.index === 5 && u.value)?.value).toBe(original);
  });
  it("import uses the same intent object; only imported closes", async () => {
    const original = intent("import"), text = " \n{}\t "; h.seeds.set(5, original); h.seeds.set(8, text);
    h.session.importSave.mockImplementation(async () => { h.ui.save.gate = gate("writable", 11); h.ui.save.mainHash = receipt.mainHash; return { status: "imported", receipt }; });
    const close = debug(); button("Confirm replacement").onClick(); await Promise.resolve();
    expect(h.session.importSave.mock.calls[0]).toEqual([text, original]); expect(h.session.importSave.mock.calls[0][1]).toBe(original); expect(close).toHaveBeenCalledTimes(1);
  });
  it.each(["failed", "blocked", "skipped"] as const)("import %s retains text and does not close", async status => {
    h.seeds.set(5, intent("import")); h.seeds.set(8, "original text");
    h.session.importSave.mockResolvedValue(status === "failed" ? { status, stage: "rename", storageMayHaveChanged: true } : status === "blocked" ? { status, reason: "io", generation: 10 } : { status, reason: "stale-generation" });
    const close = debug(); button("Confirm replacement").onClick(); await Promise.resolve();
    expect(close).not.toHaveBeenCalled(); expect(h.updates.some(u => u.index === 8)).toBe(false); expect(h.updates.some(u => u.index === 7 && String(u.value) !== "Working…")).toBe(true);
  });
  it("text change cancels import intent; stale generation hides confirm", () => {
    h.seeds.set(5, intent("import")); debug(); input().onChange({ target: { value: "changed" } }); expect(h.updates.some(u => u.index === 5 && u.value === null)).toBe(true);
    h.ui.save.gate = gate("writable", 11); expect(render(DebugPanel, { onClose: vi.fn(), overlay: false, setOverlay: vi.fn() })).not.toContain("Confirm replacement");
  });
  it("reset preview never deletes; confirmed reset uses original object and verified empty", async () => {
    const original = intent("reset"); h.session.prepareReset.mockReturnValue({ status: "ready", intent: original });
    debug(); button("Review character deletion").onClick(); expect(h.session.resetSave).not.toHaveBeenCalled();
    h.seeds.set(4, original); h.session.resetSave.mockImplementation(async () => { h.ui.save.gate = gate("verified-empty", 11); return { status: "reset", verifiedEmpty: true, generation: 11 }; });
    const close = debug(); button("Confirm character deletion").onClick(); await Promise.resolve(); expect(h.session.resetSave.mock.calls[0][0]).toBe(original); expect(close).toHaveBeenCalledTimes(1);
  });
  it("failed reset does not close or announce empty", async () => {
    h.seeds.set(4, intent("reset")); h.session.resetSave.mockResolvedValue({ status: "failed", stage: "reset-remove", storageMayHaveChanged: true });
    const close = debug(); button("Confirm character deletion").onClick(); await Promise.resolve(); expect(close).not.toHaveBeenCalled(); expect(JSON.stringify(h.updates)).not.toContain("verified empty");
  });
  it.each([false, true])("resolved %s benchmark without fresh result is not persistence success", async keep => {
    h.session.simulateOfflineReturn.mockResolvedValue(undefined); const close = debug();
    button(keep ? "Simulate 8-hour offline return (keep result)" : "Benchmark 8-hour catch-up (discard result)").onClick(); await Promise.resolve();
    expect(close).not.toHaveBeenCalled(); expect(h.updates.some(u => String(u.value).includes("not confirmed"))).toBe(true);
  });
  it("kept benchmark with blocked gate does not close despite new result", async () => {
    h.session.simulateOfflineReturn.mockImplementation(async () => { h.ui.save.gate = gate("blocked", 11); h.ui.offline = { kept: true } as any; });
    const close = debug(); button("Simulate 8-hour offline return (keep result)").onClick(); await Promise.resolve(); expect(close).not.toHaveBeenCalled();
  });
  it("blocked DEV exposes recovery and no reset/import", () => { h.ui.save.gate = gate("blocked"); const close = debug(); expect(h.props.some(n => label(n.props.children) === "Review character deletion")).toBe(false); expect(close).not.toHaveBeenCalled(); });
  it("empty export is not copied", () => { debug(); button("Copy save file").onClick(); expect(h.updates.some(u => String(u.value).includes("No readable text"))).toBe(true); });
  it("failure wording does not expose stage or payload", () => { expect(actionFailureText({ status: "failed", stage: "rename", errorCode: "raw stack", storageMayHaveChanged: true })).not.toMatch(/rename|raw stack/); });
  it("pending create disables every submission and class choice", () => { h.ui.save.gate = gate("verified-empty"); h.seeds.set(4, true); render(CreateCharacterScreen); expect(button("Begin in Greenfields").disabled).toBe(true); expect(h.props.filter(n => n.type === "button" && n.props.className?.startsWith("class-option")).every(n => n.props.disabled)).toBe(true); });
  it("pending DEV disables confirm and textarea", () => { h.seeds.set(5, intent("import")); h.seeds.set(6, true); debug(); expect(button("Confirm replacement").disabled).toBe(true); expect(input().disabled).toBe(true); });
  it("import double-confirm is locally guarded and a newer owner cannot close", async () => {
    h.seeds.set(5, intent("import")); const d = deferred<ActionOutcome>(); h.session.importSave.mockReturnValue(d.promise);
    const close = debug(), click = button("Confirm replacement").onClick; click(); click(); expect(h.session.importSave).toHaveBeenCalledTimes(1);
    h.ui.save.gate = gate("writable", 12); h.ui.save.mainHash = receipt.mainHash; d.resolve({ status: "imported", receipt }); await Promise.resolve(); expect(close).not.toHaveBeenCalled();
  });
  it("reset receipt without verified-empty post-state cannot close", async () => { h.seeds.set(4, intent("reset")); h.session.resetSave.mockResolvedValue({ status: "reset", verifiedEmpty: true, generation: 11 }); const close = debug(); button("Confirm character deletion").onClick(); await Promise.resolve(); expect(close).not.toHaveBeenCalled(); });
  it.each([false, true])("fresh %s benchmark closes only with matching owner and result", async keep => {
    h.session.simulateOfflineReturn.mockImplementation(async () => { h.ui = { ...h.ui, offline: { kept: keep } as any, save: { ...h.ui.save, gate: gate("writable", keep ? 11 : 10), ...(keep ? { mainHash: "hash", lastSavedWallMs: 42 } : {}) } }; });
    const close = debug(); button(keep ? "Simulate 8-hour offline return (keep result)" : "Benchmark 8-hour catch-up (discard result)").onClick(); await Promise.resolve(); expect(close).toHaveBeenCalledOnce();
  });
});
