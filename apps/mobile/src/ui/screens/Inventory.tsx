import { useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { SLOT_ORDER } from "@emberbound/shared-types";
import { previewBulkSalvage, previewSalvage, type BulkSalvageReceipt, type Profile, type SalvageReceipt } from "@emberbound/game-core";
import { session } from "../../game/session";
import { Sheet } from "../components/Common";
import { ItemIcon } from "../components/icons";
import { gearDifferences } from "../gearModel";
import { number, rarityColor, SLOT_LABELS } from "../format";
import { EMPTY_INVENTORY_FILTERS, filterInventoryGroups, inventoryGroups, inventoryPage, inventorySelectionCounts, INVENTORY_PAGE_SIZE, type InventoryFilters, type InventoryGroup } from "../inventoryModel";
import type { GearFocus } from "./Gear";
import { CopyControls } from "./GearCopies";
import { BulkSalvageConfirmation, SalvageConfirmation } from "./Salvage";

export interface InventorySelection {
  ids: Set<number>;
  setIds: Dispatch<SetStateAction<Set<number>>>;
  hiddenCount: number;
}

/** Selection belongs to the overview, independently of filters, pages and comparison. */
export function InventorySheet({ profile, onClose, initiallyNewOnly, retryAction, renderComparison }: {
  profile: Profile; onClose: () => void; initiallyNewOnly: boolean; retryAction: ReactNode;
  renderComparison: (focus: GearFocus, selection: InventorySelection, back: () => void, equipped: () => void) => ReactNode;
}) {
  const content = session.content;
  const [filters, setFilters] = useState<InventoryFilters>({ ...EMPTY_INVENTORY_FILTERS, newOnly: initiallyNewOnly });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [manageBase, setManageBase] = useState<string | null>(null);
  const [comparison, setComparison] = useState<GearFocus | null>(null);
  const [ids, setIds] = useState<Set<number>>(() => new Set());
  const [bulkQuote, setBulkQuote] = useState<BulkSalvageReceipt | null>(null);
  const [singleQuote, setSingleQuote] = useState<SalvageReceipt | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  // Session can mutate the same Profile during markReviewed/equip. Read it on each
  // coarse UI update so NEW/protection/hidden counts never use a stale identity cache.
  const groups = inventoryGroups(profile, content);
  const visible = filterInventoryGroups(groups, filters);
  const pagination = inventoryPage(visible, page);
  const counts = inventorySelectionCounts(ids, visible);
  const copyCount = visible.reduce((sum, group) => sum + group.ids.length, 0);
  const managed = visible.find(group => group.baseId === manageBase);
  const hasFilters = filters.search.trim() !== "" || !!filters.slot || !!filters.rarityId || filters.newOnly || !!filters.salvage;
  const changeFilters = (next: InventoryFilters) => { setFilters(next); setPage(0); };
  const toggle = (id: number) => {
    setIds(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
    setError("");
  };
  // Swap the sheet, retaining this component's exact selection/filter state. Existing
  // comparison alone marks the targeted copy reviewed; browsing/selection never does.
  if (comparison) return renderComparison(comparison, { ids, setIds, hiddenCount: counts.hidden }, () => setComparison(null), () => {
    setComparison(null);
    if (initiallyNewOnly || filters.newOnly) setManageBase(null);
  });

  const filterControls = (
      <div className="gear-filters">
        <label className="gear-search"><span>Search inventory</span>
          <input type="search" value={filters.search} placeholder="Item name or effect" onChange={e => changeFilters({ ...filters, search: e.target.value })} />
        </label>
        <label><span>Slot</span><select aria-label="Slot" value={filters.slot} onChange={e => changeFilters({ ...filters, slot: e.target.value as InventoryFilters["slot"] })}>
          <option value="">All slots</option>
          {SLOT_ORDER.map(slot => <option key={slot} value={slot}>{SLOT_LABELS[slot]}</option>)}
        </select></label>
        <label><span>Rarity</span><select aria-label="Rarity" value={filters.rarityId} onChange={e => changeFilters({ ...filters, rarityId: e.target.value })}>
          <option value="">All rarities</option>
          {content.raritiesByOrder.map(rarity => <option key={rarity.id} value={rarity.id}>{rarity.name}</option>)}
        </select></label>
        <label><span>Salvage eligibility</span><select aria-label="Salvage eligibility" value={filters.salvage} onChange={e => changeFilters({ ...filters, salvage: e.target.value as InventoryFilters["salvage"] })}>
          <option value="">All copies</option><option value="eligible">Eligible copies</option><option value="protected">Protected / ineligible copies</option>
        </select></label>
        <label className="gear-new-filter"><input type="checkbox" checked={filters.newOnly} onChange={e => changeFilters({ ...filters, newOnly: e.target.checked })} /><span>Only NEW</span></label>
        {hasFilters && <button className="btn ghost gear-clear" onClick={() => changeFilters({ ...EMPTY_INVENTORY_FILTERS })}>Clear filters</button>}
      </div>
  );

  return <Sheet label="Gear inventory" onClose={onClose} scrollKey={bulkQuote ? "bulk" : singleQuote ? "single" : manageBase ?? `page-${pagination.page}`}>
    <div className="row spread">
      <h2>{initiallyNewOnly ? "Review new gear" : "Gear inventory"}</h2>
      <button className="btn small ghost sheet-close" aria-label="Close inventory" onClick={onClose}>×</button>
    </div>
    {notice && <p className="small" role="status">{notice}</p>}
    {bulkQuote ? <BulkSalvageConfirmation profile={profile} quote={bulkQuote} onCancel={() => setBulkQuote(null)} onSaved={receipt => {
      setNotice(`${receipt.copies.length.toLocaleString()} selected copies salvaged for ${receipt.gold.toLocaleString()} Gold and saved.`);
      setBulkQuote(null); setIds(new Set()); setError("");
    }} /> : singleQuote ? <SalvageConfirmation profile={profile} quote={singleQuote} onCancel={() => setSingleQuote(null)} onSaved={receipt => {
      setNotice(`Copy #${receipt.instanceId} salvaged for ${receipt.gold} Gold and saved.`);
      // Keep even consumed selected IDs: a later batch must reject stale selections.
      setSingleQuote(null);
    }} /> : <>
      {retryAction}
      <p className="small muted">{initiallyNewOnly
        ? "Compare new drops with what you’re wearing before your next Push."
        : "All six slots. Find gear, manage its copies, or compare a specific copy before equipping."}</p>
      {initiallyNewOnly ? <details className="inventory-filters-disclosure" open={filtersOpen} onToggle={e => setFiltersOpen(e.currentTarget.open)}>
        <summary>Inventory filters</summary>
        {filterControls}
      </details> : filterControls}
      {(!initiallyNewOnly || ids.size > 0) && <section className="stack inventory-selection" aria-label="Inventory salvage selection">
        <p className="small" role="status">{number(counts.total)} copies selected for salvage · {number(counts.hidden)} outside current filters.</p>
        <p className="small muted">Choose exact copies manually in Manage copies. Selection stays across slots, item types, filters and pages. Review includes every selected ID.</p>
        <div className="gear-copy-actions">
          <button className="btn gold" disabled={!ids.size} onClick={() => {
            const result = previewBulkSalvage(profile, content, [...ids]);
            if (result.ok) { setBulkQuote(result.bulkSalvage); setError(""); setNotice(""); }
            else setError(result.error);
          }}>Review selected salvage</button>
          <button className="btn ghost" disabled={!ids.size} onClick={() => { setIds(new Set()); setError(""); }}>Clear selection</button>
        </div>
        {error && <p role="alert">{error}</p>}
      </section>}
      <p className="small muted gear-result-count" role="status">{visible.length} of {groups.length} item types · {number(copyCount)} matching copies of {number(profile.inventory.instances.length)} owned</p>
      {managed && <section className="inventory-managed stack" aria-label="Manage inventory copies">
        <InventoryItem group={managed} />
        <button className="btn ghost" onClick={() => setManageBase(null)}>Back to inventory list</button>
        <p className="small muted">Showing copies matching the current filters. Comparing a copy follows the existing NEW review rule.</p>
        <CopyControls key={`${managed.baseId}-${JSON.stringify(filters)}`} profile={profile} slot={managed.item.slot} group={managed}
          initiallyExpanded selectedInstance={undefined} bulkIds={ids} onToggleSalvage={toggle}
          onSelect={id => setComparison({ slot: managed.item.slot, baseId: managed.baseId, instanceId: id })}
          onSalvage={id => { const quote = previewSalvage(profile, content, id); if (quote.ok) { setSingleQuote(quote.salvage); setNotice(""); } }} />
      </section>}
      {manageBase && !managed && <p className="small muted">This item has no copies matching the current filters. Your selection is kept.</p>}
      {!managed && <>
        <div className="list inventory-list" aria-label="Inventory item types">
          {pagination.rows.map(group => {
            const slot = group.item.slot;
            const copy = group.copies.find(({ id, isNew }) => isNew && id !== profile.equipment[slot] && id !== profile.pending?.equipment?.[slot]);
            return <section className="inventory-item stack" key={group.baseId} data-base-id={group.baseId}>
              <InventoryItem group={group} />
              <div className={copy ? "gear-copy-actions" : "stack"}>
                {copy && <button className="btn gold" aria-label={`Compare ${group.item.name}`}
                  onClick={() => setComparison({ slot, baseId: group.baseId, instanceId: copy.id })}>Compare</button>}
                <button className="btn" aria-label={`Manage copies of ${group.item.name}`} onClick={() => setManageBase(group.baseId)}>Manage copies</button>
              </div>
            </section>;
          })}
        </div>
        {groups.length === 0 && <p className="small muted gear-empty">No gear owned yet. Gear you earn will appear here across all six slots.</p>}
        {groups.length > 0 && visible.length === 0 && <p className="small muted gear-empty">No gear matches these filters. Change or clear filters to see your owned copies. Your selection is kept.</p>}
        {visible.length > INVENTORY_PAGE_SIZE && <nav className="gear-copy-pages" aria-label="Inventory pages">
          <button className="btn" disabled={pagination.page === 0} onClick={() => setPage(pagination.page - 1)}>Previous items</button>
          <span className="small">Page {pagination.page + 1} of {pagination.pages} · {pagination.page * INVENTORY_PAGE_SIZE + 1}–{Math.min((pagination.page + 1) * INVENTORY_PAGE_SIZE, visible.length)} of {visible.length}</span>
          <button className="btn" disabled={pagination.page + 1 === pagination.pages} onClick={() => setPage(pagination.page + 1)}>Next items</button>
        </nav>}
      </>}
    </>}
  </Sheet>;
}

function InventoryItem({ group }: { group: InventoryGroup }) {
  const content = session.content, item = group.item;
  const duplicates = group.copies.filter(copy => copy.equippedDuplicate).length;
  return <>
    <div className="row">
      <ItemIcon icon={item.icon} rarityColor={rarityColor(content, item.rarity)} size={40} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="item-name">{item.name}</div>
        <div className="rarity" style={{ color: rarityColor(content, item.rarity) }}>
          {SLOT_LABELS[item.slot]} · {content.rarity(item.rarity).name}{item.classId ? ` · ${content.classDef(item.classId).name} only` : ""}
        </div>
      </div>
    </div>
    <div className="small">{number(group.ids.length)} matching / {number(group.totalCount)} owned copies · {number(group.eligibleCount)} salvage eligible</div>
    <div className="chips">
      {group.newCount > 0 && <span className="tag new">{number(group.newCount)} NEW matching</span>}
      {group.lockedCount > 0 && <span className="tag locked">{number(group.lockedCount)} locked</span>}
      {group.equippedHere && <span className="tag">Equipped</span>}
      {duplicates > 0 && <span className="tag" title="Same stats and effects as your equipped item">{number(duplicates)} {duplicates === 1 ? "duplicate" : "duplicates"} of equipped</span>}
      {group.queuedHere && <span className="tag queued">Queued</span>}
    </div>
    {group.newCount > 0 ? <NewGearDifferences group={group} /> : (
      <div className="small"><strong>{item.effect?.name ?? "No special effect"}</strong>{item.effect && <p className="muted">{item.effect.description}</p>}</div>
    )}
  </>;
}

function NewGearDifferences({ group }: { group: InventoryGroup }) {
  const { equippedItem, item } = group;
  const { stats, gainedEffect, lostEffect } = gearDifferences(equippedItem, item);
  return <section className="stack small" aria-label="Differences from equipped gear">
    <span className="muted">Compared with {equippedItem?.name ?? "empty slot"}</span>
    {stats.length > 0 && <div className="chips">
      {stats.map(stat => <span key={stat.key} className={`tag ${stat.delta > 0 ? "delta-up" : "delta-down"}`}>{stat.label} {stat.value}</span>)}
    </div>}
    {gainedEffect && <div><strong>Gains {gainedEffect.name}</strong> · {gainedEffect.description}</div>}
    {lostEffect && <div><strong>Loses {lostEffect.name}</strong></div>}
    {!gainedEffect && !lostEffect && (stats.length === 0
      ? <span className="muted">Same stats and effects</span>
      : item.effect && <span className="muted">Same effect: {item.effect.name}</span>)}
  </section>;
}
