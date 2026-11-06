import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

// Presentation-only back stack: top overlay first, tab navigation second.
const actions: Array<{ handle: () => boolean; priority: number }> = [];
export function registerBackAction(handle: () => boolean, priority = 0): () => void {
  const action = { handle, priority };
  actions.push(action);
  return () => { const index = actions.indexOf(action); if (index >= 0) actions.splice(index, 1); };
}
export function dispatchBack(): boolean {
  const ordered = [...actions].reverse().sort((a, b) => b.priority - a.priority);
  return ordered.some(action => action.handle());
}
export function watchNativeBack(): () => void {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") return () => undefined;
  let disposed = false;
  let remove: (() => void) | undefined;
  void App.addListener("backButton", () => {
    if (!dispatchBack()) void App.minimizeApp();
  }).then(listener => {
    if (disposed) void listener.remove();
    else remove = () => { void listener.remove(); };
  });
  return () => { disposed = true; remove?.(); };
}
