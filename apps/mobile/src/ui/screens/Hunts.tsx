import { useEffect, useRef, useState } from "react";
import { activeBossAttempt, activeHuntAttempt, type Command, type Profile } from "@emberbound/game-core";
import { SLOT_ORDER, type SlotId } from "@emberbound/shared-types";
import { session } from "../../game/session";
import { CombatView } from "../components/CombatView";
import { Bar } from "../components/Common";
import { duration, hp } from "../format";

const slotName = (slot: string) => slot[0]!.toUpperCase() + slot.slice(1);

export function Hunts({ profile, active, onReviewGear }: { profile: Profile; active: boolean; onReviewGear: () => void }) {
  const [slot, setSlot] = useState<SlotId>("weapon");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const combatRef = useRef<HTMLDivElement>(null);
  const decisionRef = useRef<HTMLElement>(null);
  const content = session.content;
  const config = content.snapshot.hunts;
  const state = profile.hunts;
  const attempt = activeHuntAttempt(profile);
  const current = state?.queue.find(h => h.slot !== null);
  const result = state?.lastResult;
  const blocked = busy || !!activeBossAttempt(profile) || !!attempt;
  useEffect(() => { if (active && attempt) combatRef.current?.scrollIntoView({ block: "start" }); }, [active, attempt]);
  useEffect(() => {
    if (active && !attempt && current && current.step > 0) decisionRef.current?.scrollIntoView({ block: "start" });
  }, [active, attempt, current?.id, current?.step]);
  if (!config) return null;
  async function start(command: Extract<Command, { type: "startHunt" }>) {
    setBusy(true); setError("");
    try { const result = await session.startHunt(command); if (!result.ok) setError(result.error); }
    finally { setBusy(false); }
  }
  return <section className="panel stack" aria-label="Hunts">
    <div className="row spread"><h2>Hunts</h2><span className="tag gold">{state?.queue.length ?? 0} / {config.capacity} discovered</span></div>
    <p className="small muted">Follow tracks, choose a route, and bring back gear for a slot you choose. Combat is automatic.</p>
    {!state ? <p className="small">Clear your first zone, then farm it to discover your first Hunt.</p>
      : state.queue.length >= config.capacity ? <p className="small muted">Your board is full. Hunts never expire, and farming continues.</p>
      : <div className="stack small">
        <Bar value={state.progressMs} max={config.intervalMs} kind="mastery" />
        <span className="muted">Next discovery in {duration(Math.ceil((config.intervalMs - state.progressMs) / 60_000) * 60_000)} of farming cleared territory. Offline farming counts. Hunts never expire.</span>
      </div>}
    {attempt && (() => {
      const hunt = content.hunts.get(attempt.record.hunt!.huntId);
      if (!hunt) return null;
      const background = content.zone(hunt.zoneId).background;
      return <div ref={combatRef} className="adventure-world" aria-label="Hunt combat">
        <div className="combat-frame boss-combat" data-background={background}>
          <CombatView active={active} heroSprite={content.classDef(attempt.record.build.classId).sprite} background={background} />
          <div className="combat-banner boss">{hunt.name} · {attempt.record.hunt!.step === 2 ? "Boss" : attempt.record.hunt!.step === 1 ? "Detour" : "Tracks"}</div>
        </div>
        <p className="small muted">This encounter continues if you close the game. Your next decision will wait.</p>
      </div>;
    })()}
    {result && !attempt && <div className="panel stack small" role="status" aria-label="Hunt result">
      <b>{content.hunts.get(result.huntId)?.name ?? "Hunt"} · {result.outcome === "victory" ? result.step === 2 ? "Hunt complete!" : "Encounter cleared" : result.outcome === "interrupted" ? "Interrupted — retry available" : "Attempt ended — retry available"}</b>
      {result.gold > 0 && <span>Earned {result.gold} Gold.</span>}
      {result.itemIds.map(id => {
        const item = profile.inventory.instances.find(i => i.id === id);
        return item ? <span key={id}>Earned {content.item(item.baseId).name} · {content.rarity(content.item(item.baseId).rarity).name}</span> : null;
      })}
      {result.enemyHp100 > 0 && <><Bar value={result.enemyHp100} max={result.enemyMaxHp100} kind="hp" /><span>Enemy HP left {hp(result.enemyHp100)} / {hp(result.enemyMaxHp100)}</span></>}
      <span className="muted">Earned rewards stay yours. Safe farming continues while you decide.</span>
      <button className="btn block" onClick={onReviewGear}>Review gear</button>
    </div>}
    {state?.queue.map(discovery => {
      const hunt = content.hunts.get(discovery.huntId);
      if (!hunt) return <p className="small" key={discovery.id}>This Hunt needs its original content to continue.</p>;
      const locked = blocked || !!current && current.id !== discovery.id;
      const choosing = discovery.step === 1 && discovery.route === null;
      const fighting = attempt?.record.hunt?.discoveryId === discovery.id;
      return <article ref={current?.id === discovery.id ? decisionRef : undefined} className="panel stack" key={discovery.id} aria-label={hunt.name}>
        <div className="row spread"><h3>{hunt.name}</h3><span className="tag">{content.zone(hunt.zoneId).name}</span></div>
        <p className="small muted">{hunt.description}</p>
        <p className="small">{hunt.trait}</p>
        {discovery.slot === null ? <label className="stack small">Choose your gear reward
          <select aria-label={`Reward slot for ${hunt.name}`} value={slot} disabled={locked} onChange={e => setSlot(e.target.value as SlotId)}>
            {SLOT_ORDER.map(s => <option key={s} value={s}>{slotName(s)}</option>)}
          </select>
          <span className="muted">One guaranteed {slotName(slot).toLowerCase()} item for defeating the boss. Rarity follows this zone's cache. Extra gear can feed the Forge.</span>
        </label> : <p className="small">Reward: {slotName(discovery.slot)} · {discovery.hp100 === null ? "Next attempt starts at full HP" : `${hp(discovery.hp100)} HP carried forward`}</p>}
        {!fighting && choosing ? <div className="stack" aria-label="Choose Hunt route">
          <p className="small">Choose your route. HP carries between successful fights.</p>
          <button className="btn block" disabled={locked} onClick={() => void start({ type: "startHunt", discoveryId: discovery.id, route: "direct" })}>Follow the tracks · Face the boss now</button>
          <button className="btn block" disabled={locked} onClick={() => void start({ type: "startHunt", discoveryId: discovery.id, route: "raid" })}>Raid the nest · Extra fight, extra {slotName(discovery.slot!).toLowerCase()} item</button>
          <button className="btn block" disabled={locked} onClick={() => void start({ type: "startHunt", discoveryId: discovery.id, route: "weakness" })}>Find its weakness · Extra fight, boss deals {Math.round((10_000 - hunt.weakenedDamageBp) / 100)}% less damage</button>
        </div> : !fighting && <button className="btn primary block" disabled={locked} onClick={() => void start({ type: "startHunt", discoveryId: discovery.id, ...(discovery.slot === null ? { slot } : {}) })}>
          {discovery.slot === null ? "Follow the tracks" : result?.discoveryId === discovery.id && result.outcome !== "victory" ? "Retry encounter · Full HP" : discovery.step === 2 ? "Challenge the boss" : "Continue Hunt"}
        </button>}
      </article>;
    })}
    {error && <p className="small" role="alert">{error}</p>}
    {!!state?.completed && <p className="small muted">Hunts completed: {state.completed}</p>}
  </section>;
}
