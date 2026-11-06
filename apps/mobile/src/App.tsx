import { useCallback, useEffect, useState, type ReactNode } from "react";
import { registerBackAction } from "./platform/backNavigation";
import { session } from "./game/session";
import { retryTarget } from "./game/attempts";
import { DEV_TOOLS } from "./platform/device";
import { Busy, Header, ToastView } from "./ui/components/Common";
import { NavIcon } from "./ui/components/icons";
import { DebugPanel, PerfOverlay } from "./ui/debug/DebugPanel";
import { totalNew } from "./ui/gearModel";
import { useUi } from "./ui/hooks";
import { OfflineOverlay, RunResultOverlay } from "./ui/overlays/Overlays";
import { AdventureScreen } from "./ui/screens/Adventure";
import { ChallengesScreen } from "./ui/screens/Challenges";
import { CharacterScreen } from "./ui/screens/Character";
import { CreateCharacterScreen } from "./ui/screens/CreateCharacter";
import { GearScreen, type GearFocus } from "./ui/screens/Gear";
import { AppUpdates } from "./ui/screens/AppUpdates";
import { SaveRecoveryScreen } from "./ui/screens/SaveRecovery";

type Tab = "adventure" | "character" | "gear" | "challenges";

const TABS: { id: Tab; label: string }[] = [
  { id: "adventure", label: "Adventure" },
  { id: "character", label: "Character" },
  { id: "gear", label: "Gear" },
  { id: "challenges", label: "Challenges" },
];

function readOverlayPref(): boolean {
  try {
    return localStorage.getItem("ember.perfOverlay") === "1";
  } catch {
    return false;
  }
}

export function App() {
  const ui = useUi();
  const [tab, setTab] = useState<Tab>("adventure");
  const [debugOpen, setDebugOpen] = useState(false);
  const [overlay, setOverlayState] = useState(readOverlayPref);
  const [gearFocus, setGearFocus] = useState<GearFocus | "new" | null>(null);
  const clearFocus = useCallback(() => setGearFocus(null), []);

  useEffect(() => registerBackAction(() => {
    if (tab === "adventure") return false;
    setTab("adventure");
    return true;
  }), [tab]);

  const setOverlay = (value: boolean) => {
    setOverlayState(value);
    try {
      localStorage.setItem("ember.perfOverlay", value ? "1" : "0");
    } catch {
      /* per-viewer convenience only */
    }
  };

  // A retained profile is a paused observation, never permission to render/play.
  if (ui.phase === "storage-blocked" || ui.save.gate.mode === "blocked") {
    return <div className="app immersive"><SaveRecoveryScreen /></div>;
  }
  if (ui.phase === "loading" || ui.save.gate.mode === "uninspected") {
    return (
      <div className="app immersive">
        <div className="center-screen" role="status" aria-label="Checking saved adventure" aria-busy="true">
          <div className="spinner" />
        </div>
      </div>
    );
  }
  if (ui.phase === "error") {
    return (
      <div className="app immersive">
        <div className="center-screen">
          <h2>Something went wrong</h2>
          <div className="small muted">Your adventure is paused. Check the saved adventure before continuing.</div>
          <SaveRecoveryScreen />
        </div>
      </div>
    );
  }
  if (ui.phase === "create" || !ui.profile) {
    if (ui.save.gate.mode !== "verified-empty" || !ui.save.gate.canCreate) {
      return <div className="app immersive"><SaveRecoveryScreen /></div>;
    }
    return (
      <div className="app immersive">
        <CreateCharacterScreen />
      </div>
    );
  }

  const { profile, runResult } = ui;
  const newCount = totalNew(profile);
  const retry = retryTarget(profile, session.content);
  const openGear = (focus: GearFocus | "new" | null) => {
    setGearFocus(focus);
    setTab("gear");
  };
  const retryPush = (zoneId: string) => {
    if (!session.dispatch({ type: "startPush", zoneId }).ok) return;
    session.dismissOffline();
    setGearFocus(null);
    setTab("adventure");
  };
  const retryAction: ReactNode = retry && (
    <button className="btn primary block" onClick={() => retryPush(retry.zoneId)}>
      Retry {session.content.zone(retry.zoneId).name}
    </button>
  );

  return (
    <div className="app immersive">
      <Header profile={profile} {...(DEV_TOOLS ? { onDebug: () => setDebugOpen(true) } : {})} />
      <main className="screen adventure-screen" hidden={tab !== "adventure"}>
        <AdventureScreen profile={profile} active={tab === "adventure" && !debugOpen} nextAttempt={retry && !ui.runResult && !ui.offline && (
          <section className="panel stack" aria-label="Next attempt">
            <div className="panel-title">Next attempt</div>
            <p className="small muted">Last Push: {session.content.zone(retry.zoneId).name} · stage {retry.stage}</p>
            {newCount > 0 && <button className="btn block" onClick={() => openGear("new")}>Review new gear ({newCount})</button>}
            {retryAction}
          </section>
        )} />
      </main>
      {tab === "character" && (
        <main className="screen character-screen">
          <AppUpdates />
          <CharacterScreen profile={profile} />
        </main>
      )}
      {tab === "gear" && (
        <main className="screen gear-screen">
          <GearScreen profile={profile} focus={gearFocus} onFocusHandled={clearFocus} retryAction={ui.offline || runResult ? null : retryAction} />
        </main>
      )}
      {tab === "challenges" && (
        <main className="screen">
          <ChallengesScreen />
        </main>
      )}

      <nav className="nav">
        {TABS.map((t) => (
          <button key={t.id} className={`nav-btn ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
            <NavIcon name={t.id} />
            {t.label}
            {t.id === "gear" && newCount > 0 && <span className="nav-badge">{newCount > 99 ? "99+" : newCount}</span>}
          </button>
        ))}
      </nav>

      {ui.offline && (
        <OfflineOverlay
          data={ui.offline}
          onReview={(focus) => {
            session.dismissOffline();
            openGear(focus);
          }}
          retryAction={retryAction}
        />
      )}
      {!ui.offline && runResult && (
        <RunResultOverlay result={runResult} profile={profile} newCount={newCount}
          onReview={openGear} onRetry={() => retryPush(runResult.zoneId)} />
      )}
      {ui.busy && <Busy text={ui.busy} />}
      {debugOpen && <DebugPanel onClose={() => setDebugOpen(false)} overlay={overlay} setOverlay={setOverlay} />}
      {DEV_TOOLS && overlay && <PerfOverlay />}
      <ToastView toast={ui.toast} />
    </div>
  );
}
