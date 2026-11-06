import { useRef, useState } from "react";
import type { SlotId } from "@emberbound/shared-types";
import { findInstance, isItemLocked, previewSalvage, type Profile } from "@emberbound/game-core";
import { session } from "../../game/session";
import type { ItemGroup } from "../gearModel";

/** Bound the DOM for large duplicate inventories while exposing every exact copy. */
export function CopyControls({ profile, slot, group, selectedInstance, onSelect, onSalvage, bulkIds, onToggleSalvage, initiallyExpanded = false }: {
  profile: Profile; slot: SlotId; group: ItemGroup; selectedInstance: number | undefined; onSelect: (id: number) => void; onSalvage: (id: number) => void; bulkIds: Set<number>; onToggleSalvage: (id: number) => void;
  initiallyExpanded?: boolean;
}) {
  const pageSize = 20;
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [page, setPage] = useState(() => Math.max(0, Math.floor(group.ids.indexOf(selectedInstance ?? -1) / pageSize)));
  const [saving, setSaving] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const working = useRef(false);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(group.ids.length / pageSize) - 1));
  const copies = group.ids.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const changeLock = async (id: number) => {
    if (working.current) return;
    working.current = true; setSaving(id); setError(""); setNotice("");
    const locked = !isItemLocked(profile, id);
    try {
      const result = await session.setItemLock(id, locked);
      if (result.ok) setNotice(`Copy #${id} ${locked ? "locked" : "unlocked"} and saved.`);
      else setError(result.error);
    } finally { working.current = false; setSaving(null); }
  };
  return <details className="gear-copies" open={expanded} onToggle={e => setExpanded(e.currentTarget.open)}>
    <summary>Manage copies · {group.ids.length.toLocaleString()} {group.item.name}</summary>
    {expanded && <section className="stack" aria-label="Item copies" aria-busy={saving !== null}>
      <p className="small muted">A lock protects this copy from Forge and salvage. It can still be equipped. Unlocking does not remove equipped or queued protection.</p>
      <p className="small muted">After your first lock, use this build or a newer one to reopen your adventure.</p>
      {copies.map(id => {
        const instance = findInstance(profile, id)!;
        const locked = isItemLocked(profile, id);
        const equipped = profile.equipment[slot] === id, queued = profile.pending?.equipment?.[slot] === id;
        return <div className={`gear-copy ${selectedInstance === id ? "selected" : ""}`} data-instance-id={id} key={id}>
          <div className="gear-copy-status"><strong>Copy #{id}</strong>
            {equipped && <span className="tag">Equipped</span>}{queued && <span className="tag queued">Queued</span>}
            {instance.isNew && <span className="tag new">NEW</span>}<span className={`tag ${locked ? "locked" : ""}`}>{locked ? "Locked" : "Unlocked"}</span>
          </div>
          <label className="bulk-salvage-choice">
            <input type="checkbox" checked={bulkIds.has(id)} disabled={saving !== null || (!bulkIds.has(id) && !previewSalvage(profile, session.content, id).ok)} aria-label={`Select for salvage copy #${id}`} onChange={() => onToggleSalvage(id)} />
            <span>Select for bulk salvage</span>
          </label>
          <div className="gear-copy-actions">
            <button className="btn" disabled={saving !== null} aria-label={`Select copy #${id}`} aria-pressed={selectedInstance === id} onClick={() => onSelect(id)}>Select this copy</button>
            <button className="btn" disabled={saving !== null} aria-label={`${locked ? "Unlock" : "Lock"} copy #${id}`} aria-pressed={locked} onClick={() => void changeLock(id)}>
              {saving === id ? "Saving…" : locked ? "Unlock copy" : "Lock copy"}
            </button>
            <button className="btn" disabled={saving !== null || !previewSalvage(profile, session.content, id).ok} aria-label={`Review salvage copy #${id}`} onClick={() => onSalvage(id)}>Review salvage</button>
          </div>
          {locked && <div className="small">Protected from Forge and salvage. Can still be equipped.</div>}
        </div>;
      })}
      {group.ids.length > pageSize && <div className="gear-copy-pages">
        <button className="btn" disabled={currentPage === 0 || saving !== null} onClick={() => setPage(currentPage - 1)}>Previous copies</button>
        <span className="small">{currentPage * pageSize + 1}–{Math.min((currentPage + 1) * pageSize, group.ids.length)} of {group.ids.length.toLocaleString()}</span>
        <button className="btn" disabled={(currentPage + 1) * pageSize >= group.ids.length || saving !== null} onClick={() => setPage(currentPage + 1)}>Next copies</button>
      </div>}
      {notice && <p className="small" role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
    </section>}
  </details>;
}
