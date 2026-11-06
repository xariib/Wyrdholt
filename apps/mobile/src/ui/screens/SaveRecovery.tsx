import { useEffect, useRef, useState } from "react";
import { session, type ActionOutcome, type GateInfo, type SaveSlot } from "../../game/session";
import { useUi } from "../hooks";
import { CreateCharacterScreen } from "./CreateCharacter";

const REASONS: Record<NonNullable<GateInfo["reason"]>, string> = {
  unsupported: "A saved adventure uses a version this build cannot open.",
  corrupt: "A saved adventure could not be read as a valid save.",
  io: "The saved adventure could not be read or written reliably.",
  rules: "A saved adventure belongs to a different game version.",
  "storage-changed": "The saved adventure changed while it was being checked.",
  ownership: "The saved adventure is in use elsewhere or could not be accessed safely.",
  profile: "The saved adventure could not be loaded safely.",
};
const SLOT_NAMES: Record<SaveSlot, string> = { main: "Main", temp: "Temporary", backup: "Backup" };
const SLOT_STATUS = { missing: "Not found", valid: "Readable", unsupported: "Unsupported version", corrupt: "Invalid save", error: "Could not read" };

/** Player-safe wording: never expose raw payloads, stacks or internal stages. */
export function actionFailureText(result: ActionOutcome): string {
  switch (result.status) {
    case "blocked": return "The saved adventure is paused. Check it before trying again.";
    case "failed": return "The action could not be completed. The saved adventure may have changed; check it before continuing.";
    case "skipped": return "This action is no longer current. Check the saved adventure and try again.";
    case "rejected": return result.reason === "busy" ? "Another action is still in progress. Please wait."
      : result.reason === "confirmation" ? "The confirmation is no longer current. Review and confirm again."
      : result.reason === "not-empty" ? "A saved adventure already exists. It cannot be replaced by creating a character."
      : "The action is not valid. Check your input and try again.";
    case "created": case "imported": case "reset": return "";
  }
}

export function SaveRecoveryScreen() {
  const ui = useUi(), gate = ui.save.gate;
  const [pending, setPending] = useState<"retry" | "continue" | null>(null);
  const [message, setMessage] = useState("");
  const [observation, setObservation] = useState<{ slot: SaveSlot; text: string; generation: number } | null>(null);
  const working = useRef(false), mounted = useRef(true), status = useRef<HTMLParagraphElement>(null);
  const operation = useRef<{ cancel: (notify: boolean) => void } | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current?.cancel(false); }; }, []);
  useEffect(() => { setObservation(null); setMessage(""); }, [gate.generation]);
  useEffect(() => { if (pending || message) status.current?.focus(); }, [pending, message]);

  const inspect = async (resume: boolean) => {
    if (working.current) return;
    const before = session.getSnapshot();
    if (resume && before.save.gate.mode !== "writable") return;
    working.current = true; setPending(resume ? "continue" : "retry"); setMessage(""); setObservation(null);
    let owner = before.save.gate.generation, publications = 0, starting = true, cancelled = false;
    let unsubscribe = () => {};
    const ticket = { cancel: (notify: boolean) => {
      cancelled = true; unsubscribe();
      if (operation.current !== ticket) return;
      operation.current = null; working.current = false;
      if (mounted.current) {
        setPending(null);
        if (notify) setMessage("The saved adventure changed during the check. Check again before continuing.");
      }
    } };
    operation.current = ticket;
    const owns = () => !cancelled && mounted.current && operation.current === ticket
      && session.getSnapshot().save.gate.generation === owner;
    // Public API trace in pinned PR3 (also statically checked in R4): init/retry
    // bump the phase, then refresh increments once and publishes uninspected,
    // all before the first await. bump installs snapshot.version before notifying
    // subscribers. Require both consecutive publications, not a post-call owner.
    // Nested calls before/inside either publication jump/repeat versions or add
    // publications: conservatively cancel rather than attributing their owner.
    unsubscribe = session.subscribe(() => {
      const current = session.getSnapshot();
      if (starting) {
        const expectedPhase = resume ? "loading" : "storage-blocked";
        if (publications === 0 && current.version === before.version + 1
          && current.phase === expectedPhase && current.save.gate.generation === owner) publications = 1;
        else if (publications === 1 && current.version === before.version + 2
          && current.phase === expectedPhase && current.save.gate.mode === "uninspected"
          && current.save.gate.generation === before.save.gate.generation + 1) {
          owner = current.save.gate.generation; publications = 2;
        } else ticket.cancel(true);
      } else if (current.save.gate.generation !== owner) ticket.cancel(true);
    });
    try {
      const task = resume ? session.init() : session.retryStorage();
      starting = false;
      await task;
      if (!owns()) { if (!cancelled) ticket.cancel(true); return; }
      // No complete startup trace means no evidence that this operation refreshed.
      if (publications !== 2) { ticket.cancel(true); return; }
      const current = session.getSnapshot();
      if (current.save.gate.mode === "blocked" || current.phase === "error") {
        setMessage("The adventure is still paused. Review the file status below.");
      } else if (!resume && current.save.gate.mode === "writable") {
        setMessage("A compatible saved adventure was found. Select Continue to load it.");
      } else if (current.save.gate.mode === "verified-empty") {
        setMessage("No saved adventure was found. You can choose to create a character.");
      } else if (resume && current.phase !== "playing" && current.phase !== "catching-up") {
        setMessage("The adventure has not resumed. Check again before continuing.");
      }
    } catch {
      starting = false;
      if (owns()) setMessage("The check could not be completed. The adventure remains paused.");
      else if (!cancelled) ticket.cancel(true);
    } finally {
      unsubscribe();
      if (operation.current === ticket) {
        operation.current = null; working.current = false;
        if (mounted.current) setPending(null);
      }
    }
  };
  const showRaw = (slot: SaveSlot) => {
    if (working.current || gate.mode === "uninspected") return;
    const current = session.getSnapshot().save.gate;
    if (current.generation !== gate.generation) return;
    const info = current.slots.find(s => s.slot === slot);
    if (!info || info.status === "missing" || info.status === "error") { setMessage("No readable text was observed for this file."); return; }
    const text = session.readObservedSave(slot);
    if (text === null) { setMessage("No readable text was observed for this file."); return; }
    setObservation({ slot, text, generation: current.generation }); setMessage("");
  };
  const raw = observation?.generation === gate.generation ? observation : null;
  const download = () => {
    if (!raw || working.current || session.getSnapshot().save.gate.generation !== raw.generation) return;
    try {
      const url = URL.createObjectURL(new Blob([raw.text], { type: "text/plain;charset=utf-8" }));
      const link = document.createElement("a"); link.href = url; link.download = `observed-${raw.slot}.txt`;
      try { link.click(); } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
      setMessage("Observed text download requested. This does not resume the adventure or verify the current file.");
    } catch { setMessage("The observed text could not be downloaded. You can still select and copy it above."); }
  };
  if (!pending && gate.mode === "verified-empty" && gate.canCreate) return <CreateCharacterScreen />;
  return <main className="screen stack" aria-labelledby="save-recovery-title" aria-busy={!!pending}>
    <section className="panel stack">
      <h2 id="save-recovery-title">Adventure paused</h2>
      <p>{gate.mode === "uninspected" ? "Checking the saved adventure…" : gate.reason ? REASONS[gate.reason] : "Check the saved adventure before continuing."}</p>
      <p className="small muted">Automatic changes are paused. A previous attempt may have changed some files. The status below describes the last check.</p>
      <p ref={status} tabIndex={-1} role="status" aria-live="polite">{pending === "retry" ? "Checking files without making changes…" : pending === "continue" ? "Loading your adventure…" : message}</p>
      <button className="btn block" style={{ minHeight: 44 }} disabled={!!pending || gate.mode === "uninspected"} onClick={() => void inspect(false)}>Check again (read only)</button>
      {gate.mode === "writable" && <button className="btn primary block" style={{ minHeight: 44 }} disabled={!!pending} onClick={() => void inspect(true)}>Continue</button>}
    </section>
    <section className="panel stack" aria-label="Observed save file status">
      <div className="panel-title">Last observed file status</div>
      {gate.slots.length === 0 && <p className="small muted">No files have been checked yet.</p>}
      {gate.slots.map(s => <div className="stack" key={s.slot}>
        <span><b>{SLOT_NAMES[s.slot]}</b> · {SLOT_STATUS[s.status]}</span>
        {s.schema !== undefined && <span className="small muted">Save format {s.schema}</span>}
        {s.errorCode && <details><summary>Read details</summary><span className="mono small">{s.errorCode}</span></details>}
        {s.status !== "missing" && s.status !== "error" && <button className="btn block" style={{ minHeight: 44 }} disabled={!!pending || gate.mode === "uninspected"} onClick={() => showRaw(s.slot)}>View observed {s.slot} text</button>}
      </div>)}
    </section>
    {raw && <section className="panel stack">
      <h3>Observed {SLOT_NAMES[raw.slot]} text</h3>
      <p className="small muted">This is the exact text from the last successful read. It may predate a failed write and is not a verified backup of the current file.</p>
      <textarea aria-label={`Observed ${raw.slot} text`} className="mono" readOnly value={raw.text} rows={8} style={{ width: "100%" }} />
      <button className="btn block" style={{ minHeight: 44 }} onClick={download} disabled={!!pending}>Download observed text</button>
      <button className="btn ghost block" style={{ minHeight: 44 }} onClick={() => setObservation(null)}>Hide text</button>
    </section>}
  </main>;
}
