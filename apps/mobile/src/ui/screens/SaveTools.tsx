import { useRef, useState } from "react";
import { session, type SaveIntent } from "../../game/session";
import { exportBackupFile } from "../../platform/saveBackup";
import { useUi } from "../hooks";
import { actionFailureText } from "./SaveRecovery";

type Review = { kind: "restore"; intent: SaveIntent; text: string; name: string; level: number }
  | { kind: "restart"; intent: SaveIntent };

export function SaveTools({ onChanged, restoreOnly = false }: { onChanged: () => void; restoreOnly?: boolean }) {
  const { save: { gate }, profile, busy } = useUi();
  const [status, setStatus] = useState("");
  const [working, setWorking] = useState(false);
  const [pasted, setPasted] = useState("");
  const [backupText, setBackupText] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const running = useRef(false);
  const pending = working || Boolean(busy);
  const confirmation = review?.intent.generation === gate.generation ? review : null;

  async function perform(action: () => Promise<void>, failure: string) {
    if (running.current || session.getSnapshot().busy) return;
    running.current = true;
    setWorking(true);
    setStatus("");
    try { await action(); }
    catch { setStatus(failure); }
    finally { running.current = false; setWorking(false); }
  }

  function reviewRestore(text: string) {
    setReview(null);
    if (!text.trim()) { setStatus("Choose a backup file or paste its contents."); return; }
    const result = session.prepareImport(text);
    if (result.status === "ready") {
      setReview({ kind: "restore", text, intent: result.intent, name: result.name, level: result.level });
      setStatus("");
    } else setStatus(result.status === "rejected" && result.reason === "invalid" ? "This backup is invalid or uses an incompatible game version." : actionFailureText(result));
  }

  function reviewRestart() {
    const result = session.prepareReset();
    setReview(result.status === "ready" ? { kind: "restart", intent: result.intent } : null);
    setStatus(result.status === "ready" ? "" : actionFailureText(result));
  }

  function confirm(action: Review) {
    void perform(async () => {
      const result = action.kind === "restore" ? await session.importSave(action.text, action.intent) : await session.resetSave(action.intent);
      const current = session.getSnapshot();
      setReview(null);
      if (result.status === "rejected" && result.reason === "confirmation" && current.save.gate.generation === action.intent.generation) {
        if (action.kind === "restore") reviewRestore(action.text);
        else reviewRestart();
        setStatus("Your current save advanced during the review. Confirm again to continue.");
        return;
      }
      if (result.status === "imported" && current.phase === "playing" && current.save.gate.mode === "writable"
        && current.save.gate.generation === action.intent.generation + 1 && current.save.mainHash === result.receipt.mainHash) {
        setPasted("");
        onChanged();
      } else if (result.status === "reset" && result.verifiedEmpty && current.save.gate.mode === "verified-empty"
        && current.save.gate.generation === result.generation) onChanged();
      else setStatus(actionFailureText(result) || "The change could not be verified. Check the saved adventure.");
    }, "The save action could not be completed.");
  }

  function exportFile() {
    void perform(async () => {
      const text = session.exportSave();
      if (!text) throw new Error("No backup is available.");
      const result = await exportBackupFile(text);
      setStatus(result === "saved" ? "Backup exported." : result === "downloaded" ? "Backup download started." : "Backup export cancelled.");
    }, "The backup file could not be exported. You can copy the backup text instead.");
  }

  function copy() {
    void perform(async () => {
      const text = session.exportSave();
      if (!text) throw new Error("No backup is available.");
      try {
        await navigator.clipboard.writeText(text);
        setBackupText("");
        setStatus("Backup copied to the clipboard.");
      } catch { setBackupText(text); setStatus("Select and copy the backup text below."); }
    }, "The backup is currently unavailable.");
  }

  return (
    <section className="panel stack save-tools" aria-label={restoreOnly ? "Restore a saved adventure" : "Save management"} aria-busy={working}>
      {!restoreOnly && <>
        <h2>Save management</h2>
        <p className="small muted">Keep a backup to move your character to another device or return to an earlier save.</p>
        <button className="btn primary block" disabled={pending || gate.mode !== "writable"} onClick={exportFile}>Back up save</button>
        <button className="btn block" disabled={pending || gate.mode !== "writable"} onClick={copy}>Copy backup text</button>
        {backupText && <textarea className="text-input mono" aria-label="Backup text" readOnly rows={4} value={backupText} onFocus={event => event.currentTarget.select()} />}
      </>}
      <details className="menu-details" open={restoreOnly || undefined}>
        <summary>Restore backup</summary>
        <div className="stack">
          <label className="stack small">Choose a Wyrdholt backup file
            <input className="text-input" type="file" accept=".json,.txt,application/json,text/plain" disabled={pending || !gate.canImport} onChange={event => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) {
                setReview(null);
                void perform(async () => reviewRestore(await file.text()), "The backup file could not be read.");
              }
            }} />
          </label>
          <label className="stack small">Or paste backup text
            <textarea className="text-input mono" rows={3} value={pasted} disabled={pending || !gate.canImport}
              onChange={event => { setPasted(event.target.value); setReview(null); setStatus(""); }} />
          </label>
          <button className="btn block" disabled={pending || !gate.canImport || !pasted.trim()} onClick={() => reviewRestore(pasted)}>Review backup text</button>
          {confirmation?.kind === "restore" && <div className="stack save-confirm" role="group" aria-label="Confirm backup restore">
            <b>{confirmation.name} · Level {confirmation.level}</b>
            <p className="small muted">{profile ? "Restoring this backup replaces your current local adventure." : "Load this character and continue their saved adventure."}</p>
            <button className="btn primary block" disabled={pending} onClick={() => confirm(confirmation)}>Confirm restore</button>
            <button className="btn block" disabled={pending} onClick={() => setReview(null)}>Cancel restore</button>
          </div>}
        </div>
      </details>
      {!restoreOnly && <>
        <button className="btn block restart-button" disabled={pending || !gate.canReset} onClick={reviewRestart}>Restart save</button>
        {confirmation?.kind === "restart" && <div className="stack save-confirm" role="group" aria-label="Confirm restart">
          <p>This deletes your local character and progress. The game will return to character creation.</p>
          <button className="btn block restart-button" disabled={pending} onClick={() => confirm(confirmation)}>Confirm restart</button>
          <button className="btn block" disabled={pending} onClick={() => setReview(null)}>Cancel restart</button>
        </div>}
      </>}
      <p className="small" role="status">{working ? "Working…" : status}</p>
    </section>
  );
}
