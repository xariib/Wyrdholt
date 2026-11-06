import { CopyControls } from "./GearCopies";
import { InventorySheet, type InventorySelection } from "./Inventory";
import { ForgeSheet } from "./Forge";
import { SalvageConfirmation, BulkSalvageConfirmation } from "./Salvage";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ItemDef, SlotId } from "@emberbound/shared-types";
import { findInstance, isFightActive, isItemLocked, previewSalvage, previewBulkSalvage, type BulkSalvageReceipt, type Profile, type SalvageReceipt } from "@emberbound/game-core";
import { session } from "../../game/session";
import { Sheet } from "../components/Common";
import { ItemIcon, SpriteImage } from "../components/icons";
import { buildSummary, filterGearGroups, groupsForSlot, pickInstance, slotViews, statRows, type GearFilters, type ItemGroup } from "../gearModel";
import { SLOT_LABELS, number, pct, rarityColor, rate } from "../format";

export interface GearFocus {
  slot: SlotId;
  baseId?: string;
  instanceId?: number;
}

export function GearScreen({ profile, focus, onFocusHandled, retryAction }: {
  profile: Profile; focus: GearFocus | "new" | null; onFocusHandled: () => void; retryAction: ReactNode;
}) {
  const [inventory, setInventory] = useState<{ newOnly: boolean; key: number } | null>(null);
  const [forgeOpen, setForgeOpen] = useState(false);
  const content = session.content;
  const [openSlot, setOpenSlot] = useState<SlotId | null>(null);
  const [initialBase, setInitialBase] = useState<string | undefined>(undefined);
  const [initialInstance, setInitialInstance] = useState<number | undefined>(undefined);
  const slots = slotViews(profile, content);
  const summary = buildSummary(profile, content);
  const s = summary.stats.display;

  useEffect(() => {
    if (!focus) return;
    setForgeOpen(false);
    if (focus === "new") {
      setOpenSlot(null);
      setInventory(current => ({ newOnly: true, key: (current?.key ?? 0) + 1 }));
    } else {
      setInventory(null);
      setOpenSlot(focus.slot);
      setInitialBase(focus.baseId);
      setInitialInstance(focus.instanceId);
    }
    onFocusHandled();
  }, [focus, onFocusHandled]);

  return (
    <>
      <section className="hero-loadout stack">
        <div className="row spread">
          <h2 style={{ fontSize: 20 }}>Loadout</h2>
          <button className="btn" onClick={() => setForgeOpen(true)}>Forge</button>
        </div>
        {!inventory && !forgeOpen && !openSlot && retryAction}
        <button className="btn gold block inventory-entry" onClick={() => setInventory({ newOnly: false, key: 0 })}>Inventory · {number(profile.inventory.instances.length)} copies · all slots</button>
        <div className="loadout-stage">
          <svg className="loadout-links" viewBox="0 0 360 320" preserveAspectRatio="none" aria-hidden="true"><g stroke="currentColor" fill="none"><path d="M95 55H145L180 85 M265 55H215L195 120 M95 155H145L165 160 M265 155H215L200 160 M95 265H145L180 230 M265 265H225L204 178"/></g></svg>
          <div className="loadout-hero"><SpriteImage name={content.classDef(profile.character.activeClassId).sprite} portrait/><span>Lv. {profile.character.level} · {content.classDef(profile.character.activeClassId).name}</span></div>
        <div className="loadout">
          {slots.map((v) => {
            const item = v.equipped?.item ?? null;
            return (
              <button
                key={v.slot}
                data-slot={v.slot}
                className="slot-card"
                onClick={() => {
                  setInitialBase(undefined);
                  setInitialInstance(undefined);
                  setOpenSlot(v.slot);
                }}
              >
                <ItemIcon icon={item?.icon ?? "blade"} rarityColor={item ? rarityColor(content, item.rarity) : "#28324a"} />
                <span style={{ minWidth: 0 }}>
                  <div className="slot-label">{SLOT_LABELS[v.slot]}</div>
                  <div className="item-name">{item?.name ?? "Empty"}</div>
                  {item && (
                    <div className="rarity" style={{ color: rarityColor(content, item.rarity) }}>
                      {content.rarity(item.rarity).name}
                    </div>
                  )}
                  {v.queued && <div className="queued-slot" title={v.queued.item.name}>Change queued</div>}
                  {v.equipped && isItemLocked(profile, v.equipped.instance.id) && <span className="tag locked">Locked</span>}
                </span>
                {v.newCount > 0 && <span className="badge-dot">{v.newCount > 99 ? "99+" : v.newCount} NEW</span>}
              </button>
            );
          })}
        </div>
        </div>
      </section>

      <section className="build-summary stack">
        <div className="panel-title">Build summary</div>
        <div className="stat-grid">
          <Stat label="Health" value={String(s.hp)} />
          <Stat label="Attack" value={String(s.attack)} />
          <Stat label="Armor" value={String(s.armor)} />
          <Stat label="Attack rate" value={rate(s.attackRateMilli)} />
          <Stat label="Crit" value={pct(s.critBp)} />
          <Stat label="Mastery" value={`M${summary.stats.masteryRank}`} />
        </div>
        <div className="small muted">Active effects</div>
        <div className="chips">
          {summary.stats.activeEffects.map((e) => (
            <span key={`${e.source}-${e.name}`} className={`tag ${e.source === "item" ? "gold" : ""}`}>
              {e.name}
            </span>
          ))}
        </div>
        {summary.tags.length > 0 && (
          <div className="chips">
            {summary.tags.map((t) => (
              <span key={t} className="tag">
                {t}
              </span>
            ))}
          </div>
        )}
      </section>

      {inventory && <InventorySheet key={inventory.key} profile={profile} initiallyNewOnly={inventory.newOnly} retryAction={retryAction}
        onClose={() => setInventory(null)} renderComparison={(focus, selection, back, equipped) =>
        <SlotSheet key={focus.instanceId} profile={profile} slot={focus.slot} initialBaseId={focus.baseId}
          initialInstanceId={focus.instanceId} selection={selection} onClose={back} onEquipped={equipped} />
      } />}
      {forgeOpen && <ForgeSheet profile={profile} onClose={() => setForgeOpen(false)} onCompare={(slot, base, instanceId) => { setForgeOpen(false); setInitialBase(base); setInitialInstance(instanceId); setOpenSlot(slot); }} />}
      {openSlot && (
        <SlotSheet
          key={`${openSlot}-${initialBase ?? ""}-${initialInstance ?? ""}`}
          profile={profile}
          slot={openSlot}
          initialBaseId={initialBase}
          initialInstanceId={initialInstance}
          onClose={() => setOpenSlot(null)}
        />
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="label">{label}</span>
      <span className="value">{value}</span>
    </div>
  );
}

function SlotSheet({ profile, slot, initialBaseId, initialInstanceId, selection, onClose, onEquipped = onClose }: {
  profile: Profile; slot: SlotId; initialBaseId: string | undefined; initialInstanceId: number | undefined;
  selection?: InventorySelection; onClose: () => void; onEquipped?: () => void;
}) {
  const content = session.content;
  const groups = groupsForSlot(profile, content, slot);
  const [filters, setFilters] = useState<GearFilters>({ search: "", rarityId: "", newOnly: false });
  const visibleGroups = filterGearGroups(groups, filters);
  const hasFilters = filters.search.trim() !== "" || filters.rarityId !== "" || filters.newOnly;
  const equipped = groups.find((g) => g.equippedHere) ?? null;
  const [selected, setSelected] = useState<string | null>(
    initialBaseId ?? null,
  );
  const [selectedInstance, setSelectedInstance] = useState(initialInstanceId);
  const [salvage, setSalvage] = useState<SalvageReceipt | null>(null);
  const [localBulkIds, setLocalBulkIds] = useState<Set<number>>(() => new Set());
  const bulkIds = selection?.ids ?? localBulkIds;
  const setBulkIds = selection?.setIds ?? setLocalBulkIds;
  const [bulkQuote, setBulkQuote] = useState<BulkSalvageReceipt | null>(null);
  const [bulkError, setBulkError] = useState("");
  const [salvageNotice, setSalvageNotice] = useState("");
  const group = groups.find((g) => g.baseId === selected) ?? null;
  // Forge comparison targets its exact output, even if another copy is worn or queued.
  const candidate = group && selectedInstance !== undefined
    ? group.ids.includes(selectedInstance) ? {
      ...group, ids: [selectedInstance],
      newCount: findInstance(profile, selectedInstance)?.isNew ? 1 : 0,
      equippedHere: profile.equipment[slot] === selectedInstance,
      queuedHere: profile.pending?.equipment?.[slot] === selectedInstance,
    } : null
    : group;

  // Opening a comparison marks those copies reviewed.
  useEffect(() => {
    if (!candidate || candidate.newCount === 0) return;
    const ids = profile.inventory.instances.filter(i => i.baseId === candidate.baseId && i.isNew && (selectedInstance === undefined || i.id === selectedInstance)).map(i => i.id);
    session.dispatch({ type: "markReviewed", instanceIds: ids });
  }, [candidate, profile, selectedInstance]);

  return (
    <Sheet onClose={onClose} label="Equipment" scrollKey={bulkQuote ? "bulk-salvage" : salvage ? `salvage-${salvage.instanceId}` : selected}>
      <div className="row spread">
        <h2 style={{ fontSize: 22 }}>{candidate && !candidate.equippedHere ? `Compare ${(SLOT_LABELS[slot] ?? slot).toLowerCase()}` : SLOT_LABELS[slot]}</h2>
        <button className="btn small ghost sheet-close" aria-label="Close equipment" onClick={onClose}>
          ×
        </button>
      </div>
      {salvageNotice && <p className="small" role="status">{salvageNotice}</p>}
      {bulkQuote ? <BulkSalvageConfirmation profile={profile} quote={bulkQuote} onCancel={() => setBulkQuote(null)} onSaved={receipt => {
        setSalvageNotice(`${receipt.copies.length.toLocaleString()} selected copies salvaged for ${receipt.gold.toLocaleString()} Gold and saved.`);
        setBulkQuote(null); setBulkIds(new Set()); setSelected(null); setSelectedInstance(undefined);
      }} /> : salvage ? <SalvageConfirmation profile={profile} quote={salvage} onCancel={() => setSalvage(null)} onSaved={receipt => {
        setSalvageNotice(`Copy #${receipt.instanceId} salvaged for ${receipt.gold} Gold and saved.`);
        setSalvage(null); setSelected(null); setSelectedInstance(undefined);
      }} /> : <>
      {candidate && !candidate.equippedHere ? (
        <Compare profile={profile} slot={slot} current={equipped?.item ?? null} candidate={candidate} onDone={onEquipped} />
      ) : (
        <div className="stack">
          <div className="small muted">Equipped: {equipped?.item.name ?? "Nothing"}. Tap an alternative to compare.</div>
          {candidate?.equippedHere && candidate.item.effect && (
            <section className="stack" aria-label="Equipped item effect">
              <strong>{candidate.item.effect.name}</strong>
              <p className="small muted">{candidate.item.effect.description}</p>
            </section>
          )}
        </div>
      )}
      <section className="stack" aria-label="Bulk salvage selection">
        <p className="small">{bulkIds.size.toLocaleString()} copies selected for salvage. Select copies manually in Manage copies; selection stays across pages and item types{selection ? " and slots in Inventory" : " in this slot"}.</p>
        {selection && <p className="small">{selection.hiddenCount.toLocaleString()} selected copies outside current Inventory filters.</p>}
        <button className="btn gold block" disabled={!bulkIds.size} onClick={() => {
          const result = previewBulkSalvage(profile, content, [...bulkIds]);
          if (result.ok) { setBulkQuote(result.bulkSalvage); setBulkError(""); setSalvageNotice(""); }
          else setBulkError(result.error);
        }}>Review selected salvage</button>
        <button className="btn ghost block" disabled={!bulkIds.size} onClick={() => { setBulkIds(new Set()); setBulkError(""); }}>Clear salvage selection</button>
        {bulkError && <p role="alert">{bulkError}</p>}
      </section>
      {(group ?? equipped) && <CopyControls key={(group ?? equipped)!.baseId} profile={profile} slot={slot}
        group={(group ?? equipped)!} selectedInstance={selectedInstance}
        bulkIds={bulkIds} onToggleSalvage={id => setBulkIds(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; })}
        onSalvage={id => { const quote = previewSalvage(profile, content, id); if (quote.ok) { setSalvageNotice(""); setSalvage(quote.salvage); } }}
        onSelect={id => { setSelected((group ?? equipped)!.baseId); setSelectedInstance(id); }} />}
      <div hidden={!!candidate && !candidate.equippedHere}>
        <div className="gear-filters">
          <label className="gear-search">
            <span>Search gear</span>
            <input type="search" value={filters.search} placeholder="Item name or effect" onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
          </label>
          <label>
            <span>Rarity</span>
            <select aria-label="Rarity" value={filters.rarityId} onChange={(e) => setFilters({ ...filters, rarityId: e.target.value })}>
              <option value="">All rarities</option>
              {content.raritiesByOrder.map((rarity) => <option key={rarity.id} value={rarity.id}>{rarity.name}</option>)}
            </select>
          </label>
          <label className="gear-new-filter">
            <input type="checkbox" checked={filters.newOnly} onChange={(e) => setFilters({ ...filters, newOnly: e.target.checked })} />
            <span>Only NEW</span>
          </label>
          {hasFilters && <button className="btn ghost gear-clear" onClick={() => setFilters({ search: "", rarityId: "", newOnly: false })}>Clear filters</button>}
        </div>
        <div className="small muted gear-result-count" role="status">
          {visibleGroups.length} of {groups.length} item types · {number(visibleGroups.reduce((sum, g) => sum + g.ids.length, 0))} copies
        </div>
      <div className="list slot-inventory">
        {visibleGroups.map((g) => (
          <GroupRow key={g.baseId} profile={profile} group={g} selected={g.baseId === selected} onSelect={() => { setSelected(g.baseId); setSelectedInstance(undefined); }} />
        ))}
        {groups.length === 0 && <div className="small muted">No items for this slot yet.</div>}
        {groups.length > 0 && visibleGroups.length === 0 && <div className="small muted gear-empty">No gear matches these filters. Clear filters to see all owned items.</div>}
      </div>
      </div>
      {candidate && !candidate.equippedHere && <button className="btn ghost block" onClick={()=>{ setSelected(null); setSelectedInstance(undefined); }}>Other {(SLOT_LABELS[slot] ?? slot).toLowerCase()}</button>}
      </>}
    </Sheet>
  );
}

function GroupRow({ profile, group, selected, onSelect }: { profile: Profile; group: ItemGroup; selected: boolean; onSelect: () => void }) {
  const content = session.content;
  const color = rarityColor(content, group.item.rarity);
  return (
    <button className={`list-item ${selected ? "selected" : ""} ${group.equippedHere ? "equipped" : ""}`} onClick={onSelect}>
      <ItemIcon icon={group.item.icon} rarityColor={color} size={40} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <div className="item-name">
          {group.item.name}
          {group.ids.length > 1 && <span className="faint"> ×{group.ids.length}</span>}
        </div>
        <div className="rarity" style={{ color }}>
          {content.rarity(group.item.rarity).name}
          {group.item.effect ? ` · ${group.item.effect.name}` : ""}
        </div>
      </span>
      {group.equippedHere && <span className="tag">Equipped</span>}
      {group.queuedHere && <span className="tag queued">Queued</span>}
      {group.ids.some(id => isItemLocked(profile, id)) && <span className="tag locked">{group.ids.filter(id => isItemLocked(profile, id)).length} locked</span>}
      {group.newCount > 0 && <span className="tag new">NEW</span>}
    </button>
  );
}


function Compare({ profile, slot, current, candidate, onDone }: { profile: Profile; slot: SlotId; current: ItemDef | null; candidate: ItemGroup; onDone: () => void }) {
  const rows = useMemo(() => statRows(current, candidate.item, { pct, rate }), [current, candidate]);
  const inFight = isFightActive(profile);
  return (
    <div className="stack">
      <div className="compare item-compare-head">
        <ItemColumn title="CURRENT" item={current} />
        <ItemColumn title="NEW" item={candidate.item} />
      </div>
      <div className="comparison-stats">{rows.map(r=><div className="comparison-stat" key={r.key}><div className="small muted">{r.label}</div><div className="comparison-values"><span>{r.current ? r.format(r.current) : "—"}</span><span className={r.candidate>r.current?"delta-up":r.candidate<r.current?"delta-down":""}>{r.candidate ? r.format(r.candidate) : "—"} {r.candidate>r.current?"▲":r.candidate<r.current?"▼":""}</span></div></div>)}</div>
      <div className="compare comparison-effects"><div><div className="slot-label">CURRENT EFFECT</div><strong>{current?.effect?.name ?? "None"}</strong><p>{current?.effect?.description}</p></div><div><div className="slot-label">NEW EFFECT</div><strong>{candidate.item.effect?.name ?? "None"}</strong><p>{candidate.item.effect?.description}</p></div></div>
      <button
        className="btn gold block equip-cta"
        disabled={candidate.queuedHere}
        onClick={() => {
          const result = session.dispatch({ type: "equip", slot, instanceId: pickInstance(profile, candidate, slot) });
          if (result.ok) onDone();
        }}
      >
        {candidate.queuedHere ? "Queued for next fight" : `Equip ${candidate.item.name}`}
      </button>
      {inFight && <div className="small faint">A fight is in progress: the change applies when it ends.</div>}
    </div>
  );
}

function ItemColumn({ title, item }: { title: string; item: ItemDef | null }) {
  const content = session.content;
  const color = item ? rarityColor(content,item.rarity) : "var(--text-faint)";
  return <div className="compare-col"><div className="slot-label">{title}</div><div className="item-name">{item?.name ?? "Nothing"}</div><div className="rarity" style={{color}}>{item?content.rarity(item.rarity).name:"Empty slot"}</div></div>;
}
