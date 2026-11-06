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
  const set = (next: boolean): void => {
    if (next === active) return;
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
    void App.addListener("appStateChange", ({ isActive }) => set(isActive)).then((h) => removers.push(() => void h.remove()));
    void App.addListener("pause", () => set(false)).then((h) => removers.push(() => void h.remove()));
    void App.addListener("resume", () => set(true)).then((h) => removers.push(() => void h.remove()));
  }
  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("pageshow", onPageShow);
    for (const r of removers) r();
  };
}
