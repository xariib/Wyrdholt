import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContentIndex, MemorySaveFs, DEFAULT_SAVE_PATHS } from "@emberbound/game-core";
import { CONTENT } from "@emberbound/game-content";

// Controlled public-store and actual JSX callback probes. Effect callbacks are
// executed explicitly for cleanup tests: this is NOT React DOM/effect scheduling,
// focus, touch, browser/unmount acceptance or native storage testing.
const h = vi.hoisted(() => ({ session: {} as any, props: [] as any[], updates: [] as any[], effects: [] as any[], index: 0 }));
vi.mock("react", async original => {
  const real = await original<typeof import("react")>();
  return { ...real, useState: (initial: any) => { const index = h.index++; const [value] = real.useState(initial); return [value, (next: any) => h.updates.push({ index, value: next })]; },
    useEffect: (effect: any, deps: any) => { h.effects.push(effect); real.useEffect(effect, deps); } };
});
vi.mock("react/jsx-runtime", async original => {
  const real = await original<typeof import("react/jsx-runtime")>();
  const wrap = (fn: any) => (type: any, props: any, key: any) => { h.props.push({ type, props }); return fn(type, props, key); };
  return { ...real, jsx: wrap(real.jsx), jsxs: wrap(real.jsxs) };
});
vi.mock("react/jsx-dev-runtime", async original => {
  const real = await original<typeof import("react/jsx-dev-runtime")>();
  return { ...real, jsxDEV: (...args: Parameters<typeof real.jsxDEV>) => { h.props.push({ type: args[0], props: args[1] }); return real.jsxDEV(...args); } };
});
vi.mock("../src/game/session", () => ({ session: new Proxy({}, { get(_target, key) { const value = h.session[key]; return typeof value === "function" ? value.bind(h.session) : value; } }) }));
vi.mock("../src/ui/hooks", () => ({ useUi: () => h.session.getSnapshot() }));
vi.mock("../src/ui/components/icons", () => ({ SpriteImage: () => null }));
vi.mock("../src/platform/perfMonitor", () => ({ perfMonitor: { mark: vi.fn(), markStartup: vi.fn(), pause: vi.fn(), start: vi.fn(), recordCatchUp: vi.fn() } }));
import { SaveRecoveryScreen } from "../src/ui/screens/SaveRecovery";
const gate = (mode: string, generation: number) => ({ mode, generation, slots: [], canCreate: mode === "verified-empty", canImport: false, canReset: false });
function deferred() { let resolve!: (v?: any) => void, reject!: (v: any) => void; const promise = new Promise<any>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
function messages() { return h.updates.filter(x => x.index === 1).map(x => x.value).join("|"); }
function pending() { return h.updates.filter(x => x.index === 0).map(x => x.value); }
function render(resume: boolean) {
  h.props = []; h.index = 0; h.effects = [];
  renderToStaticMarkup(createElement(SaveRecoveryScreen));
  const label = resume ? "Continue" : "Check again (read only)";
  return h.props.find(x => x.type === "button" && x.props.children === label).props.onClick;
}
function fixture(resume: boolean) {
  let ui: any = { version: 1, phase: "storage-blocked", save: { gate: gate(resume ? "writable" : "blocked", 20) } };
  const listeners = new Set<() => void>();
  const publish = (mode: string, generation: number, phase = resume ? "loading" : "storage-blocked") => {
    ui = { ...ui, version: ui.version + 1, phase, save: { gate: gate(mode, generation) } }; for (const l of listeners) l();
  };
  const q = deferred();
  const start = vi.fn(() => { publish(ui.save.gate.mode, ui.save.gate.generation); publish("uninspected", ui.save.gate.generation + 1); return q.promise; });
  h.session = { content: new ContentIndex(CONTENT), getSnapshot: () => ui, subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; }, retryStorage: start, init: start };
  return { q, start, publish, listeners, get ui() { return ui; } };
}
beforeEach(() => { h.updates = []; h.props = []; h.effects = []; h.index = 0; vi.stubGlobal("requestAnimationFrame", () => 0); vi.stubGlobal("cancelAnimationFrame", () => {}); });

describe("operation publications and symmetric completion fences", () => {
  it.each([false, true])("normal current resolve %s", async resume => {
    const f = fixture(resume), click = render(resume); click(); click(); expect(f.start).toHaveBeenCalledTimes(1);
    f.publish("writable", 21, resume ? "playing" : "storage-blocked"); f.q.resolve(gate("writable", 21)); await flush();
    expect(messages()).not.toContain("changed during"); if (!resume) expect(messages()).toContain("Select Continue"); expect(pending().at(-1)).toBe(null); expect(f.listeners.size).toBe(0);
  });
  it.each([false, true])("current rejection %s is readable, safe and cleaned", async resume => {
    const f = fixture(resume); render(resume)(); f.q.reject(Error("SECRET")); await flush(); expect(messages()).toContain("could not be completed"); expect(messages()).not.toContain("SECRET"); expect(pending().at(-1)).toBe(null); expect(f.listeners.size).toBe(0);
  });
  it.each([false, true])("synchronous API throw %s leaves no permanent pending", async resume => {
    const f = fixture(resume); f.start.mockImplementation(() => { throw Error("SECRET"); }); const click = render(resume); click(); await flush(); expect(messages()).toContain("could not be completed"); expect(pending().at(-1)).toBe(null); click(); await flush(); expect(f.start).toHaveBeenCalledTimes(2); expect(f.listeners.size).toBe(0);
  });
  it.each([false, true].flatMap(resume => ["before", "during"].flatMap(where => [false, true].map(observerFirst => ({ resume, where, observerFirst })))))("nested $where observerFirst=$observerFirst resume=$resume cancels", async ({ resume, where, observerFirst }) => {
    const f = fixture(resume); let nested = false;
    const trigger = () => { if (!nested && (where === "before" || f.ui.save.gate.mode === "uninspected")) { nested = true; f.publish("uninspected", f.ui.save.gate.generation + 1); f.publish("writable", f.ui.save.gate.generation); } };
    if (!observerFirst) f.listeners.add(trigger);
    if (observerFirst) { const subscribe = h.session.subscribe; h.session.subscribe = (l: () => void) => { const off = subscribe(l); f.listeners.add(trigger); return off; }; }
    render(resume)(); f.q.resolve(gate("writable", 21)); await flush(); expect(messages()).toContain("changed during"); expect(messages()).not.toContain("compatible saved adventure was found"); expect(messages()).not.toContain("has not resumed"); expect(pending().at(-1)).toBe(null);
  });
  it.each([false, true].flatMap(resume => ["resolve", "reject"].map(result => ({ resume, result }))))("later generation $result resume=$resume cannot overwrite newer local work", async ({ resume, result }) => {
    const f = fixture(resume), click = render(resume); click(); f.publish(resume ? "writable" : "blocked", 22, "storage-blocked");
    const next = deferred(); f.start.mockImplementation(() => { f.publish(f.ui.save.gate.mode, 22); f.publish("uninspected", 23); return next.promise; });
    click(); expect(f.start).toHaveBeenCalledTimes(2); const updates = h.updates.length;
    if (result === "reject") f.q.reject(Error("OLD_SECRET")); else f.q.resolve(gate("writable", 23)); await flush();
    expect(h.updates.length).toBe(updates); expect(pending().at(-1)).toBe(resume ? "continue" : "retry");
    f.publish("writable", 23, resume ? "playing" : "storage-blocked"); next.resolve(); await flush(); expect(pending().at(-1)).toBe(null); expect(messages()).not.toContain("OLD_SECRET"); expect(f.listeners.size).toBe(0);
  });
  it("missing startup publications cannot borrow a returned current gate", async () => {
    const f = fixture(false); f.start.mockImplementation(() => Promise.resolve(gate("writable", 20))); render(false)(); await flush(); expect(messages()).toContain("changed during"); expect(messages()).not.toContain("compatible saved adventure was found"); expect(pending().at(-1)).toBe(null);
  });
  it("executed cleanup cancels old ticket; old finally cannot clear a replacement", async () => {
    const f = fixture(false), click = render(false); const mount = h.effects[0], cleanup = mount(); click(); cleanup(); mount();
    const next = deferred(); f.start.mockImplementation(() => { f.publish("blocked", 21); f.publish("uninspected", 22); return next.promise; });
    click(); const updates = h.updates.length; f.q.reject(Error("OLD_SECRET")); await flush(); expect(h.updates.length).toBe(updates); expect(pending().at(-1)).toBe("retry"); next.reject(Error("CURRENT_SECRET")); await flush(); expect(messages()).toContain("could not be completed"); expect(pending().at(-1)).toBe(null); expect(f.listeners.size).toBe(0);
  });
  it.each(["before", "during"])("actual PR3 subscriber nested retry %s refresh conservatively cancels UI", async where => {
    for (const [key, value] of Object.entries({ __BUILD_ID__: "fixture", __BUILD_TIME__: "fixture", __GIT_COMMIT__: "fixture", __GIT_BRANCH__: "fixture", __DEV_TOOLS__: false })) vi.stubGlobal(key, value);
    const { GameSession } = await vi.importActual<typeof import("../src/game/session")>("../src/game/session");
    const fs = new MemorySaveFs(); fs.files.set(DEFAULT_SAVE_PATHS.main, "synthetic corrupt save");
    const actual = new GameSession({ fs, ownership: async work => work() }); await actual.init();
    h.session = actual; const nested: Promise<any>[] = []; let triggered = false;
    const off = actual.subscribe(() => {
      if (!triggered && (where === "before" || actual.getSnapshot().save.gate.mode === "uninspected")) {
        triggered = true; nested.push(actual.retryStorage());
      }
    });
    const spy = vi.spyOn(actual, "retryStorage"); render(false)();
    await Promise.all(spy.mock.results.map(r => r.value)); await Promise.all(nested); await flush(); off();
    expect(triggered).toBe(true); expect(messages()).toContain("changed during"); expect(messages()).not.toContain("compatible saved adventure was found");
    expect(pending().at(-1)).toBe(null); actual.handleBackground();
  });
  it.each([false, true])("actual PR3 constructor synchronous public trace resume=%s", async resume => {
    for (const [key, value] of Object.entries({ __BUILD_ID__: "fixture", __BUILD_TIME__: "fixture", __GIT_COMMIT__: "fixture", __GIT_BRANCH__: "fixture", __DEV_TOOLS__: false })) vi.stubGlobal(key, value);
    const { GameSession } = await vi.importActual<typeof import("../src/game/session")>("../src/game/session");
    const actual = new GameSession({ fs: new MemorySaveFs(), ownership: async work => work() });
    // Initial actual gate is uninspected; startup alone supplies verified-empty.
    const before = actual.getSnapshot(), trace: any[] = []; const off = actual.subscribe(() => trace.push(actual.getSnapshot()));
    const work = resume ? actual.init() : actual.retryStorage();
    expect(trace.slice(0, 2).map(s => [s.version - before.version, s.save.gate.generation - before.save.gate.generation, s.save.gate.mode])).toEqual([[1, 0, "uninspected"], [2, 1, "uninspected"]]);
    await work; off(); expect(actual.getSnapshot().save.gate.mode).toBe("verified-empty"); actual.handleBackground();
  });
});
