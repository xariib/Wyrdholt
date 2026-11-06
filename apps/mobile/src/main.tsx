import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { session } from "./game/session";
import { prewarmOfflineWorker } from "./game/offlineRunner";
import { DEV_TOOLS } from "./platform/device";
import { dispatchBack, watchNativeBack } from "./platform/backNavigation";
import { watchLifecycle } from "./platform/lifecycle";
import { perfMonitor } from "./platform/perfMonitor";
import "./styles/app.css";
import "./styles/wyrdholt-tokens.css";
import "./styles/immersive.css";

// P2 investigation: all static imports are loaded, parsed and evaluated at this point.
perfMonitor.mark("js");

// Enforce the game viewport even when a host page supplies its own <head> (private preview host).
const VIEWPORT = "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover";
let viewportMeta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
if (!viewportMeta) {
  viewportMeta = document.createElement("meta");
  viewportMeta.name = "viewport";
  document.head.appendChild(viewportMeta);
}
viewportMeta.content = VIEWPORT;

// iOS only applies :active styles when a touch listener exists.
document.addEventListener("touchstart", () => undefined, { passive: true });
// Block pinch-zoom gestures that ignore the viewport meta tag (iOS Safari).
document.addEventListener("gesturestart", (e) => e.preventDefault());

perfMonitor.start();
prewarmOfflineWorker();

watchNativeBack();
watchLifecycle({
  onBackground: () => session.handleBackground(),
  onForeground: () => void session.handleForeground(),
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

void session.init();

if (DEV_TOOLS) {
  // Test hook for automated smoke tests (spike builds only).
  (window as unknown as { __ember: unknown }).__ember = {
    exportSave: () => session.exportSave(),
    simulatedMs: () => session.profile?.clock.simulatedMs ?? 0,
    perf: () => perfMonitor.snapshot(),
    back: dispatchBack,
  };
}
