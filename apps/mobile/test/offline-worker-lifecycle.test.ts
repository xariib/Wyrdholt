import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CONTENT } from "@emberbound/game-content";
import { ContentIndex, createProfile, cloneProfile, simulateOffline } from "@emberbound/game-core";
class FakeWorker extends EventTarget {
  static last: FakeWorker;
  listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  terminate = vi.fn();
  postMessage = vi.fn((data: {id: number; profile: unknown}) => queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", {data: {...data, ok: true, summary: {}}}))));
  constructor() { super(); FakeWorker.last = this; }
  override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) { if(listener) { const set = this.listeners.get(type) ?? new Set(); set.add(listener); this.listeners.set(type,set); } super.addEventListener(type,listener,options); }
  override removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) { if(listener) this.listeners.get(type)?.delete(listener); super.removeEventListener(type,listener,options); }
}
const content = new ContentIndex(CONTENT);
const profile = () => createProfile(content,{name:"Test",activeClassId:"monk",alternateClassId:"mage",masterSeed:1,nowWallMs:0});
beforeEach(()=>{vi.resetModules();vi.stubGlobal("Worker",FakeWorker);});
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
it("releases per-job listeners after repeated successful worker returns", async()=>{
 const {runOfflineCatchUp} = await import("../src/game/offlineRunner");
 for(let i=0;i<20;i++) await runOfflineCatchUp(profile(),1000,1000,{content});
 expect(FakeWorker.last.listeners.get("message")?.size).toBe(0);
 expect(FakeWorker.last.listeners.get("error")?.size).toBe(1); // permanent worker health listener only
});
it("releases timed-out job listeners before the deterministic fallback", async()=>{
 vi.useFakeTimers();const {runOfflineCatchUp,prewarmOfflineWorker}=await import("../src/game/offlineRunner");
 prewarmOfflineWorker();FakeWorker.last.postMessage.mockImplementation(()=>{});
 const result=runOfflineCatchUp(profile(),1000,1000,{content});await vi.advanceTimersByTimeAsync(60031);
 expect((await result).mode).toBe("main-thread-fallback");
 expect(FakeWorker.last.listeners.get("message")?.size).toBe(0);
 expect(FakeWorker.last.listeners.get("error")?.size).toBe(1);
 expect(FakeWorker.last.terminate).toHaveBeenCalledOnce();
});

it("can recreate the worker on the next return after a background-time timeout", async()=>{
 vi.useFakeTimers();const {runOfflineCatchUp,prewarmOfflineWorker}=await import("../src/game/offlineRunner");
 prewarmOfflineWorker();const oldWorker=FakeWorker.last;oldWorker.postMessage.mockImplementation(()=>{});
 const input=profile(), reference=cloneProfile(input);
 const summary=simulateOffline(reference,content,3_600_000,3_600_000);
 const result=runOfflineCatchUp(input,3_600_000,3_600_000,{content});
 // Worker transport does not observe visibility; fire its deadline while the app is notionally backgrounded.
 await vi.advanceTimersByTimeAsync(60031);const fallback=await result;
 expect(fallback.mode).toBe("main-thread-fallback");expect(fallback.profile).toEqual(reference);expect(fallback.summary).toEqual(summary);
 const next=runOfflineCatchUp(fallback.profile,3_600_000,7_200_000,{content});await vi.advanceTimersByTimeAsync(31);
 expect((await next).mode).toBe("worker");expect(FakeWorker.last).not.toBe(oldWorker);
 oldWorker.dispatchEvent(new Event("error")); // a retired worker cannot disable its replacement
 const third=runOfflineCatchUp(fallback.profile,1000,7_201_000,{content});await vi.advanceTimersByTimeAsync(31);
 expect((await third).mode).toBe("worker");
});
