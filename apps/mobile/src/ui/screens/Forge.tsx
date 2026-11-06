import { useRef, useState } from "react";
import { SLOT_ORDER, type ForgeInput, type ForgeMode, type ForgeReceipt, type ItemDef, type SlotId } from "@emberbound/shared-types";
import { eligibleForgeIds, forgeCeiling, findInstance, isItemLocked, type Profile } from "@emberbound/game-core";
import { FORGE_V1 } from "@emberbound/game-content";
import { session } from "../../game/session";
import { DEV_TOOLS } from "../../platform/device";
import { Sheet } from "../components/Common";
import { ItemIcon } from "../components/icons";
import { SLOT_LABELS, rarityColor, pct, rate } from "../format";
import { statRows } from "../gearModel";

function ItemDetails({ item }: { item: ItemDef }) {
  return <div className="stack small"><div className="forge-stats">{statRows(null, item, { pct, rate }).filter(r => r.candidate).map(r => <span key={r.key}>{r.label}: {r.format(r.candidate)}</span>)}</div>{item.effect && <div><strong>{item.effect.name}</strong><p>{item.effect.description}</p></div>}</div>;
}
export function ForgeSheet({ profile, onClose, onCompare }: { profile: Profile; onClose: () => void; onCompare: (slot: SlotId, base: string, instanceId: number) => void }) {
  const content = session.content;
  const [slot, setSlot] = useState<SlotId>("weapon"), [rarity, setRarity] = useState("common");
  const [ids, setIds] = useState<number[]>([]), [mode, setMode] = useState<ForgeMode>("configured");
  const [confirmation, setConfirmation] = useState<ForgeInput | null>(null), [receipt, setReceipt] = useState<ForgeReceipt | null>(null);
  const [error, setError] = useState(""); const working = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const recipe = FORGE_V1.recipes[rarity], index = FORGE_V1.rarities.indexOf(rarity), cap = forgeCeiling(profile, FORGE_V1);
  const eligible = eligibleForgeIds(profile, content, slot, rarity), valid = new Set(eligible);
  const selected = ids.filter(id => valid.has(id));
  const lockedCount = profile.inventory.instances.filter(i => isItemLocked(profile, i.id)
    && content.item(i.baseId).slot === slot && content.item(i.baseId).rarity === rarity).length;
  const groups = new Map<string, number[]>();
  for (const item of profile.inventory.instances) {
    if (!valid.has(item.id)) continue;
    const group = groups.get(item.baseId) ?? []; group.push(item.id); groups.set(item.baseId, group);
  }
  const guaranteed = FORGE_V1.rarities[index + 1];
  const critical = index + 2 <= cap ? FORGE_V1.rarities[index + 2] : undefined;
  const gate = FORGE_V1.gates.find(g => FORGE_V1.rarities.indexOf(g.maxRarity) >= index + 1);
  const unlocked = !!recipe && cap >= index + 1;
  const reset = () => { setIds([]); setConfirmation(null); setReceipt(null); setError(""); };
  const close = () => { if (working.current) return; if (confirmation) setConfirmation(null); else onClose(); };
  const forge = async () => {
    if (!confirmation || working.current) return;
    working.current = true; setSubmitting(true); setError("");
    try { const result = await session.forge(confirmation); if (result.ok && result.forge) { setReceipt(result.forge); setConfirmation(null); setIds([]); } else if (!result.ok) setError(result.error); }
    finally { working.current = false; setSubmitting(false); }
  };
  const rarityName = (id: string) => content.rarity(id).name;
  return <Sheet label="Forge" onClose={close} scrollKey={receipt ? "result" : confirmation ? "confirm" : `${slot}-${rarity}`}>
    <div className="row spread"><h2>Forge</h2><button className="btn ghost sheet-close" aria-label="Close Forge" onClick={close}>×</button></div>
    {receipt ? <div className="stack forge-result" data-critical={receipt.critical} data-testid="forge-result">
      <div className="slot-label">{receipt.critical ? "CRITICAL FUSION" : "FUSION COMPLETE"}</div>
      <ItemIcon icon={content.item(receipt.outputBaseId).icon} rarityColor={rarityColor(content, receipt.outputRarity)} size={64}/>
      <div style={{ color: rarityColor(content, receipt.outputRarity) }}>{rarityName(receipt.outputRarity)} · {SLOT_LABELS[receipt.slot]}</div>
      <h3>{content.item(receipt.outputBaseId).name}</h3><ItemDetails item={content.item(receipt.outputBaseId)}/>
      <p className="small muted">{receipt.count} items consumed · {receipt.gold.toLocaleString()} Gold spent</p>
      <button className="btn gold block" onClick={() => onCompare(receipt.slot, receipt.outputBaseId, receipt.outputInstanceId)}>Compare result</button>
      <button className="btn block" onClick={reset}>Forge again</button>
    </div> : confirmation ? <div className="stack" data-testid="forge-confirmation">
      <h3>Confirm fusion</h3><p>Consume {confirmation.instanceIds.length} {rarityName(confirmation.rarity)} {SLOT_LABELS[confirmation.slot]} items:</p>
      <ul className="forge-materials">{confirmation.instanceIds.map(id => { const i = findInstance(profile, id); return <li key={id}>{i ? content.item(i.baseId).name : "Consumed / unavailable"} <span className="faint">#{id}</span>{isItemLocked(profile, id) && <span className="tag locked">Locked · protected from Forge</span>}</li>; })}</ul>
      <strong>Cost: {recipe!.gold.toLocaleString()} Gold</strong><strong>Guaranteed: {rarityName(guaranteed!)} {SLOT_LABELS[slot]}</strong>
      {critical && <span>Possible critical: {rarityName(critical)} {SLOT_LABELS[slot]}</span>}
      <p className="small">Fusion always succeeds. These selected items will be permanently consumed.</p>
      {!profile.forge && <p className="small muted">After your first fusion, use this build or a newer one to reopen your adventure.</p>}
      {mode !== "configured" && <div className="tag">DEV: Force {mode}</div>}
      {error && <p role="alert">{error}</p>}
      <button className="btn gold block" data-testid="forge-submit" disabled={submitting} onClick={() => void forge()}>{submitting ? "Saving fusion…" : "FORGE"}</button>
      <button className="btn ghost block" disabled={submitting} onClick={() => setConfirmation(null)}>Change materials</button>
    </div> : <div className="stack">
      <p className="small muted">Fuse equipment into one higher-rarity item. Fusion always succeeds.</p>
      <div className="forge-controls"><label>Equipment slot<select aria-label="Forge slot" value={slot} onChange={e => { reset(); setSlot(e.target.value as SlotId); }}>{SLOT_ORDER.map(s => <option key={s} value={s}>{SLOT_LABELS[s]}</option>)}</select></label>
      <label>Source rarity<select aria-label="Forge rarity" value={rarity} onChange={e => { reset(); setRarity(e.target.value); }}>{FORGE_V1.rarities.map(r => <option key={r} value={r}>{rarityName(r)}</option>)}</select></label></div>
      {!recipe ? <p>Legendary is the highest Forge rarity.</p> : <>
      <div className="forge-promise"><strong>Guaranteed: {rarityName(guaranteed!)} {SLOT_LABELS[slot]}</strong>{critical && <span>Critical bonus: {rarityName(critical)} ({recipe.criticalBp / 100}% test chance)</span>}<span>{recipe.count} {rarityName(rarity)} items + {recipe.gold.toLocaleString()} Gold</span></div>
      {!unlocked && <p role="status">{gate ? `Forge unlocks this tier after clearing ${content.zone(gate.zoneId).name}.` : "This Forge tier is unavailable."} <span className="small muted">Provisional test gate.</span></p>}
      <div className="row spread"><strong>Selected: {selected.length} / {recipe.count}</strong><span>Gold: {profile.gold.toLocaleString()}</span></div>
      <p className="small muted">Locked, equipped and queued items are protected from Forge. Unlock a copy in Gear to use it as a material. Prices and odds are provisional test values.</p>
      {lockedCount > 0 && <p className="small" data-testid="forge-locked-count">{lockedCount} locked {lockedCount === 1 ? "copy" : "copies"} excluded for this slot and rarity.</p>}
      <div className="forge-items">{[...groups].map(([base, copies]) => { const item = content.item(base), chosen = copies.filter(id => selected.includes(id)); return <div className="forge-item" key={base}>
        <div className="row"><ItemIcon icon={item.icon} rarityColor={rarityColor(content, rarity)} size={40}/><div className="forge-item-name"><strong>{item.name}</strong><div className="small">{copies.length} available · {chosen.length} selected</div></div></div>
        <details><summary>Inspect item</summary><ItemDetails item={item}/></details>
        <div className="row"><button className="btn" aria-label={`Remove ${item.name}`} disabled={!chosen.length} onClick={() => setIds(selected.filter(id => id !== chosen[chosen.length - 1]))}>−</button>
        <button className="btn" aria-label={`Add ${item.name}`} disabled={selected.length >= recipe.count || chosen.length === copies.length} onClick={() => setIds([...selected, copies.find(id => !selected.includes(id))!])}>+</button>
        <button className="btn" disabled={selected.length >= recipe.count || chosen.length === copies.length} onClick={() => setIds([...selected, ...copies.filter(id => !selected.includes(id)).slice(0, recipe.count - selected.length)])}>Select up to {recipe.count}</button></div>
      </div>; })}</div>
      {!eligible.length && <p>No eligible {rarityName(rarity)} {SLOT_LABELS[slot]} items.</p>}
      {profile.gold < recipe.gold && <p role="status">Not enough Gold.</p>}
      <button className="btn gold block" data-testid="forge-review" disabled={!unlocked || selected.length !== recipe.count || profile.gold < recipe.gold} onClick={() => { setError(""); setConfirmation({ transactionId: profile.forge?.nextTransactionId ?? 1, configVersion: FORGE_V1.version, slot, rarity, instanceIds: selected, mode }); }}>Review fusion</button>
      </>}
      {DEV_TOOLS && <details className="forge-dev"><summary>DEV · Forge testing</summary><div className="stack">
        <label>Outcome<select aria-label="Forge DEV outcome" value={mode} onChange={e => setMode(e.target.value as ForgeMode)}><option value="configured">Use Configured Chance</option><option value="normal">Force Normal</option><option value="critical">Force Critical</option></select></label>
        <button className="btn" onClick={() => session.dispatch({ type: "devForge", action: "unlock" })}>Unlock Forge for testing</button>
        <button className="btn" onClick={() => session.dispatch({ type: "devForge", action: "gold" })}>Grant 50,000 Gold</button>
        <button className="btn" onClick={() => session.dispatch({ type: "devForge", action: "emptyGold" })}>Set test Gold to zero</button>
        {FORGE_V1.rarities.slice(0, 4).map(r => <button className="btn" key={r} onClick={() => session.dispatch({ type: "devForge", action: "grant", slot, rarity: r })}>Grant {FORGE_V1.recipes[r]!.count} {rarityName(r)} {SLOT_LABELS[slot]}</button>)}
        <button className="btn" onClick={() => session.dispatch({ type: "devForge", action: "grant", slot, rarity, count: 2000 })}>Grant 2,000 test copies</button>
        <button className="btn" onClick={() => { reset(); session.dispatch({ type: "devForge", action: "reset" }); }}>Reset Forge test materials</button>
        <p className="small muted">Test grants spoil progression testing. Reset removes only these granted materials; locked, equipped and queued items remain protected. Outcomes still use core resolution.</p>
      </div></details>}
    </div>}
  </Sheet>;
}
