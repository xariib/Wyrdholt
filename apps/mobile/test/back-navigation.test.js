import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@capacitor/core", () => ({Capacitor: {isNativePlatform: () => true, getPlatform: () => "android"}}));
vi.mock("@capacitor/app", () => ({App: {addListener: vi.fn(), minimizeApp: vi.fn()}}));
import { App } from "@capacitor/app";
import { dispatchBack, registerBackAction, watchNativeBack } from "../src/platform/backNavigation";
/** @type {Array<() => void>} */
const cleanup = [];
afterEach(() => { cleanup.splice(0).reverse().forEach(fn => fn()); vi.clearAllMocks(); });
describe("Android presentation back stack", () => {
  it("closes only the top sheet before changing tabs", () => {
    const tab=vi.fn(()=>true), sheet=vi.fn(()=>true), modal=vi.fn(()=>true);
    cleanup.push(registerBackAction(tab),registerBackAction(sheet,10));
    const removeModal=registerBackAction(modal,10); cleanup.push(removeModal);
    expect(dispatchBack()).toBe(true);expect(modal).toHaveBeenCalledOnce();expect(sheet).not.toHaveBeenCalled();expect(tab).not.toHaveBeenCalled();
    removeModal();dispatchBack();expect(sheet).toHaveBeenCalledOnce();
  });
  it("consumes back while a blocking operation is displayed", () => {
    const tab=vi.fn(()=>true);cleanup.push(registerBackAction(tab),registerBackAction(()=>true,20));
    dispatchBack();expect(tab).not.toHaveBeenCalled();
  });
  it("returns control to the native fallback at the root", () => {
    cleanup.push(registerBackAction(()=>false));expect(dispatchBack()).toBe(false);
  });
  it("removes a native listener even if registration resolves after disposal", async () => {
    const remove=vi.fn(async()=>{});
    vi.mocked(App.addListener).mockResolvedValue({remove});
    const dispose=watchNativeBack();dispose();await Promise.resolve();expect(remove).toHaveBeenCalledOnce();
  });
});
