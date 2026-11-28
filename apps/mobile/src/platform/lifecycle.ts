import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

export interface LifecycleHandlers {
  onBackground(): void;
  onForeground(): void;
}

/**
 * Foreground/background notifications. Backgrounding and closing are never death:
 * the session saves on background and settles elapsed time on foreground.
 */
export function watchLifecycle(handlers: LifecycleHandlers): () => void {
  let active = document.visibilityState === "visible";
  if (!active) handlers.onBackground();
  let disposed = false;
  const set = (next: boolean): void => {
    if (disposed || next === active) return;
    active = next;
    if (next) handlers.onForeground();
    else handlers.onBackground();
  };
  const onVisibility = (): void => set(document.visibilityState === "visible");
  const onPageHide = (): void => set(false);
  const onPageShow = (): void => set(document.visibilityState === "visible");
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", onPageShow);

  const removers: Array<() => void> = [];
  if (Capacitor.isNativePlatform()) {
    const register = (handle: Promise<{ remove(): Promise<void> }>) => {
      void handle.then(h => {
        if (disposed) void h.remove();
        else removers.push(() => void h.remove());
      }).catch(error => console.warn("Could not register app lifecycle listener.", error));
    };
    register(App.addListener("appStateChange", ({ isActive }) => set(isActive)));
    register(App.addListener("pause", () => set(false)));
    register(App.addListener("resume", () => set(true)));
  }
  return () => {
    disposed = true;
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("pageshow", onPageShow);
    for (const r of removers) r();
  };
}
