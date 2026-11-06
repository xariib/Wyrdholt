import { useEffect, useRef, useState } from "react";
import { previewSalvage, previewBulkSalvage, type BulkSalvageReceipt, type Profile, type SalvageReceipt } from "@emberbound/game-core";
import { session } from "../../game/session";

/** One quote, one exact copy, one explicit confirmation; never selects a next copy. */
export function SalvageConfirmation({ profile, quote, onCancel, onSaved }: {
  profile: Profile; quote: SalvageReceipt; onCancel: () => void; onSaved: (receipt: SalvageReceipt) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const working = useRef(false);
  const item = session.content.item(quote.baseId);
  const current = previewSalvage(profile, session.content, quote.instanceId);
  const confirm = async () => {
    if (working.current) return;
    working.current = true; setSaving(true); setError("");
    try {
      const result = await session.salvage({ instanceId: quote.instanceId, rulesVersion: quote.rulesVersion, expectedGold: quote.gold });
      if (result.ok && result.salvage) onSaved(result.salvage);
      else if (!result.ok) setError(result.error);
    } finally { working.current = false; setSaving(false); }
  };
  return <section className="stack salvage-confirmation" aria-label="Confirm salvage" aria-busy={saving}>
    <h3>Salvage {item.name}</h3>
    <p><strong>Copy #{quote.instanceId}</strong> · {session.content.rarity(item.rarity).name}</p>
    <p>Receive <strong>{quote.gold} Gold</strong>.</p>
    <p className="small muted">This permanently destroys this one copy. Other copies are kept. This cannot be undone.</p>
    {!current.ok && <p role="alert">{current.error}</p>}
    {error && <p role="alert">{error}</p>}
    <button className="btn gold block" disabled={saving || !current.ok} onClick={() => void confirm()}>
      {saving ? "Saving salvage…" : `Confirm salvage copy #${quote.instanceId} for ${quote.gold} Gold`}
    </button>
    <button className="btn ghost block" disabled={saving} onClick={onCancel}>Cancel salvage</button>
  </section>;
}

/** Immutable confirmation list; pagination changes presentation only, never selection. */
export function BulkSalvageConfirmation({ profile, quote, onCancel, onSaved }: {
  profile: Profile; quote: BulkSalvageReceipt; onCancel: () => void; onSaved: (receipt: BulkSalvageReceipt) => void;
}) {
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => { cancel.current?.focus(); }, []);
  const working = useRef(false);
  const current = previewBulkSalvage(profile, session.content, quote.copies.map(c => c.instanceId));
  const items = new Map<string, number>(), rarities = new Map<string, { count: number; each: number; gold: number }>();
  for (const copy of quote.copies) {
    items.set(copy.baseId, (items.get(copy.baseId) ?? 0) + 1);
    const rarity = session.content.item(copy.baseId).rarity;
    const row = rarities.get(rarity) ?? { count: 0, each: copy.gold, gold: 0 };
    row.count++; row.gold += copy.gold; rarities.set(rarity, row);
  }
  const confirm = async () => {
    if (working.current) return;
    working.current = true; setSaving(true); setError("");
    try {
      const result = await session.bulkSalvage({ rulesVersion: quote.rulesVersion, copies: quote.copies, expectedGold: quote.gold });
      if (result.ok && result.bulkSalvage) onSaved(result.bulkSalvage);
      else if (!result.ok) setError(result.error);
    } finally { working.current = false; setSaving(false); }
  };
  return <section className="stack salvage-confirmation" aria-label="Confirm bulk salvage" aria-busy={saving}>
    <h3>Salvage {quote.copies.length.toLocaleString()} selected copies</h3>
    <ul>{[...items].map(([id, count]) => <li key={id}>{session.content.item(id).name} ×{count.toLocaleString()}</li>)}</ul>
    <ul>{[...rarities].map(([id, row]) => <li key={id}>{session.content.rarity(id).name}: {row.count.toLocaleString()} × {row.each} Gold = {row.gold.toLocaleString()} Gold</li>)}</ul>
    <p>Total: <strong>{quote.gold.toLocaleString()} Gold</strong></p>
    <p className="small muted">Only these selected copies will be permanently destroyed. If any copy is missing, locked, equipped, queued or its quote changed, the entire batch is refused. This cannot be undone.</p>
    <ol aria-label="Selected copy IDs" start={page * 20 + 1}>{quote.copies.slice(page * 20, (page + 1) * 20).map(c => <li key={c.instanceId}>Copy #{c.instanceId} · {session.content.item(c.baseId).name} · {c.gold} Gold</li>)}</ol>
    {quote.copies.length > 20 && <div className="gear-copy-pages">
      <button className="btn" disabled={saving || page === 0} onClick={() => setPage(page - 1)}>Previous selected copies</button>
      <span className="small">{page * 20 + 1}–{Math.min((page + 1) * 20, quote.copies.length)} of {quote.copies.length.toLocaleString()}</span>
      <button className="btn" disabled={saving || (page + 1) * 20 >= quote.copies.length} onClick={() => setPage(page + 1)}>Next selected copies</button>
    </div>}
    {!current.ok && <p role="alert">{current.error}</p>}{error && <p role="alert">{error}</p>}
    <button className="btn gold block" disabled={saving || !current.ok} onClick={() => void confirm()}>{saving ? "Saving salvage…" : `Confirm salvage ${quote.copies.length.toLocaleString()} copies for ${quote.gold.toLocaleString()} Gold`}</button>
    <button ref={cancel} className="btn ghost block" disabled={saving} onClick={onCancel}>Cancel bulk salvage</button>
  </section>;
}
