import { App } from "@capacitor/app";
import { useCallback, useEffect, useRef, useState } from "react";
import { session } from "../../game/session";
import { AppUpdater, hasAppUpdater, type UpdateProgress, type UpdateState } from "../../platform/appUpdater";
import { Sheet } from "../components/Common";

type Phase = "loading" | "checking" | "downloading" | "installing";
const UPDATE_CHECK_INTERVAL = 30 * 60 * 1000;

export function AppUpdates({ menuOpen }: { menuOpen: boolean }) {
  return hasAppUpdater() ? <UpdateControl menuOpen={menuOpen} /> : null;
}

function UpdateControl({ menuOpen }: { menuOpen: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<UpdateState | null>(null);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [checked, setChecked] = useState(false);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [notice, setNotice] = useState("");
  const working = useRef(false);
  const lastCheck = useRef<number | null>(null);

  useEffect(() => {
    if (!menuOpen) setOpen(false);
  }, [menuOpen]);

  useEffect(() => {
    const listener = AppUpdater.addListener("progress", setProgress);
    return () => { void listener.then(handle => handle.remove()).catch(() => {}); };
  }, []);

  const perform = useCallback(async (next: Phase, action: () => Promise<UpdateState>, quiet = false) => {
    if (working.current) return;
    working.current = true;
    setPhase(next);
    if (!quiet) setNotice("");
    try {
      setState(await action());
      if (next === "checking") {
        setChecked(true);
        setNotice("");
      }
    } catch (error) {
      if (!quiet) setNotice(error instanceof Error ? error.message : "The update could not be completed. Try again.");
      if (next === "installing" || next === "downloading") {
        try { setState(await AppUpdater.getState()); } catch { /* keep the last known release */ }
      }
    } finally {
      working.current = false;
      setPhase(null);
    }
  }, []);

  const check = useCallback((automatic: boolean) => {
    if (automatic && lastCheck.current !== null && Date.now() - lastCheck.current < UPDATE_CHECK_INTERVAL) return;
    void perform("checking", async () => {
      lastCheck.current = Date.now();
      if (automatic) {
        const current = await AppUpdater.getState();
        setState(current);
        if (!current.supported) return current;
      }
      return AppUpdater.check();
    }, automatic);
  }, [perform]);

  useEffect(() => {
    const refresh = () => check(true);
    refresh();
    const resume = App.addListener("resume", refresh).catch(() => null);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, UPDATE_CHECK_INTERVAL);
    return () => {
      window.clearInterval(timer);
      void resume.then(handle => handle?.remove()).catch(() => {});
    };
  }, [check]);

  const install = () => perform("installing", async () => {
    const saved = await session.saveNow();
    if (saved.status !== "saved") throw new Error("Your adventure could not be saved. Check your save before installing.");
    await AppUpdater.install();
    const current = await AppUpdater.getState();
    if (current.ready) setNotice("The installer closed. Tap Install update to try again.");
    return current;
  });

  if (!menuOpen) return null;

  const close = () => { if (!working.current) setOpen(false); };
  const percent = progress ? Math.min(100, Math.floor(100 * progress.received / progress.total)) : 0;
  const status = phase === "loading" ? "Reading installed version…"
    : phase === "checking" ? "Checking for updates…"
    : phase === "downloading" ? (percent >= 100 ? "Verifying download…" : "Downloading update…")
    : phase === "installing" ? "Saving your adventure and opening Android’s installer…"
    : state?.ready ? "Download verified. Confirm the installation in Android, then tap Open."
    : state?.available ? `Version ${state.version} is available.`
    : state && !state.supported ? "In-game updates are available in the release-signed Android build."
    : checked ? (state?.published ? "Wyrdholt is up to date." : "No Android release has been published yet.")
    : "";

  return <>
    <button className={`btn block${state?.available ? " primary" : ""}`} onClick={() => {
      setOpen(true);
      if (!state) void perform("loading", () => AppUpdater.getState());
    }}>App updates{state?.available ? ` · ${state.version} available` : ""}</button>
    {open && <Sheet label="App updates" onClose={close}>
      <div className="row spread">
        <h2>App updates</h2>
        <button className="btn small ghost sheet-close" aria-label="Close app updates" disabled={phase !== null} onClick={close}>×</button>
      </div>
      {state && <p className="small muted">Installed version {state.currentVersion}</p>}
      <p role="status">{status}</p>
      {notice && <p role="alert">{notice}</p>}
      {phase === "downloading" && <>
        <progress aria-label="Update download" value={percent} max={100} style={{ width: "100%" }} />
        <p className="small">{percent}%</p>
        <button className="btn ghost block" onClick={() => void AppUpdater.cancel().catch(() => {})}>Cancel download</button>
      </>}
      {phase === null && (!state || state.supported) && <>
        {state?.ready ? <button className="btn primary block" onClick={() => void install()}>Install update</button>
          : state?.available && <button className="btn primary block" onClick={() => {
            setProgress(null);
            void perform("downloading", () => AppUpdater.download());
          }}>Download update{state.bytes ? ` · ${(state.bytes / 1048576).toFixed(1)} MB` : ""}</button>}
        <button className="btn block" onClick={() => check(false)}>Check for updates</button>
      </>}
    </Sheet>}
  </>;
}
