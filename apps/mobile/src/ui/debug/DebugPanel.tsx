import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { GOLDEN, RULES_VERSION, SAVE_SCHEMA_VERSION, goldenMatches, masteryRank, runSelfTest, type GoldenFile, type SelfTestResult } from "@emberbound/game-core";
import { session, type SaveIntent } from "../../game/session";
import { BUILD_ID, BUILD_TIME, GIT_COMMIT, GIT_BRANCH, engineDescription, memoryInfo, platformName } from "../../platform/device";
import { P1_WINDOW_MS, perfMonitor, type CatchUpTiming, type StartupMark } from "../../platform/perfMonitor";
import { duration, number } from "../format";
import { Sheet } from "../components/Common";
import { useUi } from "../hooks";
import { actionFailureText, SaveRecoveryScreen } from "../screens/SaveRecovery";

const ArtGallery = lazy(() => import("./ArtGallery"));

/** Developer tools for the device checkpoint (not part of the player UX). */
export function DebugPanel({ onClose, overlay, setOverlay }: { onClose: () => void; overlay: boolean; setOverlay: (v: boolean) => void }) {
  const ui = useUi();
  const [artOpen, setArtOpen] = useState(false);
  const [results, setResults] = useState<SelfTestResult[] | null>(null);
  const [running, setRunning] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [resetIntent, setResetIntent] = useState<SaveIntent | null>(null);
  const [importIntent, setImportIntent] = useState<SaveIntent | null>(null);
  const [pending, setPending] = useState(false);
  const working = useRef(false), mounted = useRef(true), status = useRef<HTMLParagraphElement>(null);
  const [actionStatus, setActionStatus] = useState("");
  const [importText, setImportText] = useState("");
  const content = session.content;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setImportIntent(null); setResetIntent(null); }, [ui.save.gate.generation]);
  useEffect(() => { if (pending || actionStatus) status.current?.focus(); }, [pending, actionStatus]);
  const close = () => { if (!working.current) onClose(); };
  const begin = () => {
    const current = session.getSnapshot();
    if (working.current || current.busy || current.phase !== "playing" || current.save.gate.mode !== "writable") return false;
    working.current = true; setPending(true); setActionStatus("Working…"); return true;
  };
  const finish = () => { working.current = false; if (mounted.current) setPending(false); };
  const previewImport = () => {
    if (working.current) return;
    setResetIntent(null); setImportIntent(null);
    const result = session.prepareImport(importText);
    if (result.status === "ready") { setImportIntent(result.intent); setActionStatus("Review the replacement below, then confirm separately."); }
    else setActionStatus(actionFailureText(result));
  };
  const confirmImport = async () => {
    const intent = importIntent;
    if (!intent || intent.generation !== session.getSnapshot().save.gate.generation || !begin()) return;
    try {
      const result = await session.importSave(importText, intent);
      if (!mounted.current) return;
      const current = session.getSnapshot();
      if (result.status === "imported" && current.save.gate.mode === "writable" && current.phase === "playing"
        && current.save.gate.generation === intent.generation + 1 && current.save.mainHash === result.receipt.mainHash) {
        setImportText(""); setImportIntent(null); onClose();
      } else { setImportIntent(null); setActionStatus(actionFailureText(result) || "The replacement is no longer current. Check the saved adventure."); }
    } catch { if (mounted.current) setActionStatus("The replacement could not be completed. Check the saved adventure."); }
    finally { finish(); }
  };
  const previewReset = () => {
    if (working.current) return;
    setImportIntent(null); setResetIntent(null);
    const result = session.prepareReset();
    if (result.status === "ready") { setResetIntent(result.intent); setActionStatus("Review the deletion below, then confirm separately."); }
    else setActionStatus(actionFailureText(result));
  };
  const confirmReset = async () => {
    const intent = resetIntent;
    if (!intent || intent.generation !== session.getSnapshot().save.gate.generation || !begin()) return;
    try {
      const result = await session.resetSave(intent);
      if (!mounted.current) return;
      const current = session.getSnapshot();
      if (result.status === "reset" && result.verifiedEmpty && current.save.gate.mode === "verified-empty"
        && current.save.gate.generation === result.generation && current.save.gate.canCreate) onClose();
      else { setResetIntent(null); setActionStatus(actionFailureText(result) || "Deletion could not be verified. Check the saved adventure."); }
    } catch { if (mounted.current) setActionStatus("Deletion could not be completed. Check the saved adventure."); }
    finally { finish(); }
  };
  const benchmark = async (hours: number, keep: boolean) => {
    const before = session.getSnapshot();
    if (!begin()) return;
    setImportIntent(null); setResetIntent(null);
    try {
      await session.simulateOfflineReturn(hours, keep);
      if (!mounted.current) return;
      const current = session.getSnapshot();
      const freshResult = current.offline !== null && current.offline !== before.offline && current.offline.kept === keep;
      const currentOwner = current.save.gate.generation === before.save.gate.generation + (keep ? 1 : 0);
      if (current.phase === "playing" && current.save.gate.mode === "writable" && !current.busy && freshResult && currentOwner
        && (!keep || (current.save.mainHash !== null && current.save.lastSavedWallMs !== null))) onClose();
      else setActionStatus("The requested result was not confirmed. Check the saved adventure before continuing.");
    } catch { if (mounted.current) setActionStatus("The offline test could not be completed."); }
    finally { finish(); }
  };
  const golden = GOLDEN as GoldenFile;
  const goldenProblem = goldenMatches(golden, content, RULES_VERSION);

  const runTest = () => {
    setRunning(true);
    setResults(null);
    setTimeout(() => {
      const r = runSelfTest(content, golden, () => performance.now());
      setResults(r);
      setRunning(false);
    }, 50);
  };

  const share = async (value: string) => {
    if (working.current || value === "") { setActionStatus("No readable text is available to copy."); return; }
    try {
      await navigator.clipboard.writeText(value);
      setText(`Copied ${value.length} characters to the clipboard.\n\n${value.slice(0, 2000)}`);
    } catch {
      setText(value);
    }
  };

  if (ui.phase === "storage-blocked" || ui.save.gate.mode === "blocked" || ui.save.gate.mode === "uninspected") return <SaveRecoveryScreen />;
  const unavailable = pending || ui.busy !== null || ui.phase !== "playing" || ui.save.gate.mode !== "writable";
  const passCount = results?.filter((r) => r.pass).length ?? 0;
  const totalMs = results?.reduce((a, r) => a + r.ms, 0) ?? 0;
  const renderer = (window as unknown as { __emberRenderer?: { info(): { logicalWidth: number; logicalHeight: number; scale: number; renderer: string } } }).__emberRenderer;
  const rinfo = renderer?.info();

  if (artOpen) return <Suspense fallback={<Sheet onClose={() => setArtOpen(false)}>Loading Art Preview…</Sheet>}><ArtGallery onClose={() => setArtOpen(false)}/></Suspense>;

  return (
    <Sheet onClose={close}>
      <div className="row spread">
        <h2 style={{ fontSize: 19 }}>Developer tools</h2>
        <button className="btn small ghost" disabled={pending} onClick={close}>
          Close
        </button>
      </div>

      <p ref={status} role="status" aria-live="polite" tabIndex={-1}>{actionStatus}</p>
      <button className="btn" disabled={unavailable} onClick={() => setArtOpen(true)}>Art Preview</button>
      <ProgressCheck />

      <section className="panel stack">
        <div className="panel-title">Build</div>
        <div className="mono">
          build {BUILD_ID} ({BUILD_TIME})
          <br />
          git {GIT_COMMIT} · branch {GIT_BRANCH}
          <br />
          save schema {ui.profile?.schema ?? SAVE_SCHEMA_VERSION}
          <br />
          {ui.profile && `class ${ui.profile.character.activeClassId} · M${masteryRank(content, ui.profile.character.activeClassId, ui.profile.character.masteryXp[ui.profile.character.activeClassId] ?? 0)}`}
          <br />
          {platformName()} · {engineDescription()}
          <br />
          rules {RULES_VERSION}
          <br />
          content {content.snapshot.contentVersion} · {content.hash.slice(0, 16)}…
          <br />
          renderer {rinfo ? `${rinfo.renderer} ${rinfo.logicalWidth}×${rinfo.logicalHeight} ×${rinfo.scale}` : "not mounted"}
          <br />
          memory {memoryInfo() ?? "not exposed by this engine"}
          <br />
          save {ui.save.storage} · {ui.save.bytes} bytes · loaded from {ui.save.loadedFrom}
          {ui.save.problems.length > 0 && ` · problems: ${ui.save.problems.join("; ")}`}
        </div>
        <label className="row">
          <input type="checkbox" checked={overlay} onChange={(e) => setOverlay(e.target.checked)} style={{ width: 22, height: 22 }} />
          Performance overlay
        </label>
      </section>

      <section className="panel stack">
        <div className="panel-title">
          B1 · Determinism self-test
          {results && <span className={passCount === results.length ? "pass" : "fail"}>{passCount === results.length ? "ALL PASS" : "FAIL"}</span>}
        </div>
        <div className="small muted">Runs the golden fixtures in this engine and compares complete-result hashes with Node.</div>
        {goldenProblem && <div className="fail small">{goldenProblem}</div>}
        <button className="btn primary block" disabled={running} onClick={runTest}>
          {running ? "Running…" : "Run determinism self-test"}
        </button>
        {results && (
          <div>
            <div className="small muted">
              {passCount}/{results.length} pass · {totalMs.toFixed(0)} ms
            </div>
            {results.map((r) => (
              <div key={r.id} className="selftest-row">
                <span className={r.pass ? "pass" : "fail"}>{r.pass ? "PASS" : "FAIL"}</span>
                <span style={{ flex: 1 }}>
                  {r.id}
                  <div className="mono faint">
                    {r.actual.slice(0, 16)} {r.pass ? "" : `≠ ${String(r.expected).slice(0, 16)}`} {r.error ?? ""}
                  </div>
                </span>
                <span className="faint">{r.ms.toFixed(0)}ms</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel stack">
        <div className="panel-title">P3 · Offline catch-up</div>
        <div className="small muted">
          Last 8-hour benchmark: {perfMonitor.lastBenchmark ? timingText(perfMonitor.lastBenchmark) : "none yet"}
        </div>
        <button className="btn primary block" disabled={unavailable} onClick={() => void benchmark(8, false)}>
          Benchmark 8-hour catch-up (discard result)
        </button>
        <button className="btn block" disabled={unavailable} onClick={() => void benchmark(8, true)}>
          Simulate 8-hour offline return (keep result)
        </button>
        <button
          className="btn block"
          disabled={unavailable}
          onClick={() => void benchmark(content.snapshot.config.offlineCapMs / 3_600_000, true)}
        >
          Simulate a full {Math.round(content.snapshot.config.offlineCapMs / 3_600_000)}-hour absence (keep result)
        </button>
      </section>

      <section className="panel stack">
        <div className="panel-title">Test helpers</div>
        <button className="btn block" disabled={unavailable} onClick={() => session.grantSampleGear()}>
          Grant sample gear (Gear UX evaluation)
        </button>
        <button className="btn block" disabled={unavailable} onClick={() => session.unlockAllZones()}>
          Unlock all zones (visual check only; spoils the pacing test)
        </button>
        <button className="btn block" disabled={unavailable} onClick={() => void share(JSON.stringify(session.currentFightRecord(), null, 2))}>
          Copy current fight record (replay in Node)
        </button>
        <button className="btn block" disabled={unavailable} onClick={() => void share(session.exportSave())}>
          Copy save file
        </button>
        <textarea
          id="import-save"
          aria-label="Save text to import"
          disabled={pending}
          className="mono"
          rows={3}
          placeholder="Paste a save file here to reproduce it (replaces this character)"
          value={importText}
          onChange={(e) => { setImportText(e.target.value); setImportIntent(null); setActionStatus(""); }}
          style={{ width: "100%", background: "#0c111c", color: "var(--text)", border: "1px solid var(--line)" }}
        />
        <button
          className="btn block"
          disabled={unavailable || !ui.save.gate.canImport || importText.length === 0}
          onClick={previewImport}
        >
          Review pasted save
        </button>
        {importIntent && importIntent.generation === ui.save.gate.generation && <section className="panel stack" aria-label="Confirm save replacement">
          <p>This replaces the current character with the pasted saved adventure. Continue only if you intend to replace it.</p>
          <button className="btn gold block" disabled={unavailable} onClick={() => void confirmImport()}>Confirm replacement</button>
          <button className="btn ghost block" disabled={pending} onClick={() => { setImportIntent(null); setActionStatus(""); }}>Cancel replacement</button>
        </section>}
        <button className="btn block" disabled={unavailable || !ui.save.gate.canReset} onClick={previewReset}>Review character deletion</button>
        {resetIntent && resetIntent.generation === ui.save.gate.generation && <section className="panel stack" aria-label="Confirm character deletion">
          <p>This deletes the character and its save files. This is a developer test action.</p>
          <button className="btn gold block" disabled={unavailable} onClick={() => void confirmReset()}>Confirm character deletion</button>
          <button className="btn ghost block" disabled={pending} onClick={() => { setResetIntent(null); setActionStatus(""); }}>Cancel deletion</button>
        </section>}
      </section>

      {text && (
        <section className="panel stack">
          <div className="panel-title">Output</div>
          <textarea className="mono" readOnly value={text} rows={8} style={{ width: "100%", background: "#0c111c", color: "var(--text)", border: "1px solid var(--line)" }} />
        </section>
      )}
    </Sheet>
  );
}

/** Measurement overlay for P1/P2 (median FPS, dips below 50 FPS, startup). */
export function PerfOverlay() {
  const [snap, setSnap] = useState(perfMonitor.snapshot());
  useEffect(() => {
    const timer = setInterval(() => setSnap(perfMonitor.snapshot()), 500);
    return () => clearInterval(timer);
  }, []);
  const medianOk = snap.medianFps >= 55;
  const dipOk = snap.longestDipMs <= 1000;
  const windowOk = snap.windowMs >= P1_WINDOW_MS;
  return (
    <div className="perf-overlay">
      <div>{BUILD_ID}</div>
      <div>
        fps <b>{snap.fps}</b> · frame {snap.frameMsAvg.toFixed(1)} / max {snap.frameMsMax.toFixed(0)} ms
      </div>
      <div className={medianOk ? "ok" : "bad"}>median fps {snap.medianFps.toFixed(1)}</div>
      <div className={dipOk ? "ok" : "bad"}>longest &lt;50fps {snap.longestDipMs} ms</div>
      <div className={windowOk ? "ok" : undefined}>
        window {(snap.windowMs / 1000).toFixed(0)} s {windowOk ? "" : `(P1 needs ${P1_WINDOW_MS / 1000} s)`}
      </div>
      <div>startup {snap.startupMs ?? "-"} ms</div>
      <div>{startupBreakdown(snap.startupMarks)}</div>
      <div>P3 8h bench {snap.lastBenchmark ? timingText(snap.lastBenchmark) : "-"}</div>
      <div>
        last return {snap.lastCatchUp?.kind === "return" ? `${duration(snap.lastCatchUp.simulatedMs)} → ${timingText(snap.lastCatchUp)}` : "-"}
      </div>
      <div>{memoryInfo() ?? "memory n/a"}</div>
      <button className="btn small block" style={{ marginTop: 6, minHeight: 36 }} onClick={() => perfMonitor.reset()}>
        Start measurement
      </button>
    </div>
  );
}

function timingText(t: CatchUpTiming): string {
  return `${t.totalMs} ms total · ${t.computeMs} ms compute · ${t.mode}`;
}

/** "js 1800 · save +120 · catch-up +272 · combat 3400" (ms since page start; + = phase length). */
function startupBreakdown(m: Partial<Record<StartupMark, number>>): string {
  const step = (from: number | undefined, to: number | undefined) =>
    from !== undefined && to !== undefined ? `+${to - from}` : "-";
  return [
    `js ${m.js ?? "-"}`,
    `save ${step(m.js, m.saveLoaded)}`,
    `catch-up ${step(m.saveLoaded, m.catchUpDone)}`,
    `combat ${m.combatDrawn ?? "-"}`,
  ].join(" · ");
}

/**
 * Playtest progress check (C1 investigation): how much of the real time since the character
 * was created has been simulated, what the character is doing now, and what the last offline
 * settlement changed. Read-only.
 */
function ProgressCheck() {
  const ui = useUi();
  const p = ui.profile;
  if (!p) return null;
  const content = session.content;
  const realMs = Math.max(1, Date.now() - p.createdAtWallMs);
  const run = p.adventure.run;
  const last = session.lastSettlement;
  return (
    <section className="panel stack" data-testid="progress-check">
      <div className="panel-title">Progress check</div>
      <div className="mono small">
        since created {duration(realMs)} · simulated {duration(p.clock.simulatedMs)} ({Math.round((100 * p.clock.simulatedMs) / realMs)}%)
        <br />
        offline settlements {p.stats.offlineSettlements} · fights {number(p.stats.fights)} ({p.stats.defeats} lost) · runs {number(p.stats.runsStarted)}
        <br />
        now: {p.adventure.activity}
        {run ? ` · ${run.mode} ${content.zone(run.zoneId).name} stage ${run.stageIndex + 1}` : ""}
        <br />
        level {p.character.level} ({number(p.character.xp)} XP) ·{" "}
        {Object.entries(p.character.masteryXp)
          .map(([id, xp]) => `${id}${id === p.character.activeClassId ? "*" : ""} M${masteryRank(content, id, xp)} (${number(xp)})`)
          .join(" · ")}
        {last && (
          <>
            <br />
            last offline: away {duration(last.requestedMs)}, simulated {duration(last.simulatedMs)} as {last.classAtStart} · XP +{number(last.characterXp)} ·
            mastery {Object.entries(last.masteryByClass).map(([id, v]) => `${id} +${number(v)}`).join(", ") || "+0"} · {number(last.fights)} fights ·{" "}
            {last.targets.map((t) => `${t.mode} ${content.zone(t.zoneId).name}`).join(" → ") || "no activity"}
            {last.resumedFrom ? ` · resumed: ${last.resumedFrom}` : ""}
          </>
        )}
      </div>
    </section>
  );
}
