import { useEffect, useState, type ReactNode } from "react";
import { ASHEN_KING_ID, activeBossAttempt, activeHuntAttempt, type Profile } from "@emberbound/game-core";
import { session } from "../../game/session";
import { safeFarmZone, zoneViews, type ZoneView } from "../adventureModel";
import { CombatView } from "../components/CombatView";
import { Sheet } from "../components/Common";
import { number } from "../format";

export function AdventureScreen({ profile, active, retryZoneId, nextAttempt, onChallenges }: {
  profile: Profile;
  active: boolean;
  retryZoneId?: string;
  nextAttempt: ReactNode;
  onChallenges: () => void;
}) {
  const [zonesOpen, setZonesOpen] = useState(false);
  const boss = activeBossAttempt(profile);
  const hunt = activeHuntAttempt(profile);
  const canShowZones = active && !boss && !hunt;
  useEffect(() => {
    if (!canShowZones) setZonesOpen(false);
  }, [canShowZones]);

  if (hunt) return <section className="panel stack"><h2>Hunt in progress</h2><p className="small muted">Safe farming resumes after this encounter.</p><button className="btn primary block" onClick={onChallenges}>Watch Hunt in Challenges</button></section>;
  if (boss) {
    const name = session.content.soloBosses.get(boss.record.encounter.bossId)?.name ?? "Challenge";
    return (
      <section className="panel stack">
        <h2>{name} attempt in progress</h2>
        <p className="small muted">Adventure farming resumes after the challenge.</p>
        <button className="btn primary block" onClick={onChallenges}>Watch Tier {boss.record.encounter.tier} in Challenges</button>
      </section>
    );
  }
  const content = session.content;
  const ashenKing = content.soloBosses.get(ASHEN_KING_ID);
  const showAshenKing = !profile.ashenKing && ashenKing && profile.adventure.zones[ashenKing.unlockZoneId]?.cleared;
  const adv = profile.adventure;
  const zone = content.zone(adv.zoneId);
  const zp = adv.zones[zone.id];
  const run = adv.run;
  const cleared = zp?.cleared === true;
  const stageIndex = run ? run.stageIndex : 0;
  const stage = zone.stages[stageIndex]!;
  const heroSprite = content.classDef(profile.character.activeClassId).sprite;
  const enemyNames = stage.enemies.map((id) => content.enemy(id).name);
  const modeLabel =
    adv.activity === "idle"
      ? "Resting"
      : run?.mode === "push"
        ? "Pushing"
        : run?.mode === "trail"
          ? "Farming the trail"
          : "Farming";
  const zones = zoneViews(profile, content);
  const nextZone = zones.find((view) => view.status === "open" && zone.unlocks.includes(view.zone.id))?.zone;
  const pushZone = retryZoneId ? content.zone(retryZoneId) : cleared ? nextZone : zone;
  // Farming an uncleared zone repeats its first stage (the "trail"): no Elite, Boss or cache,
  // slow fights for its level. From the A40 playtest save, the Darkwood trail paid 56% of the
  // Character XP and 41% of the Mastery XP per hour of a Greenfields Farm. So once any zone is
  // cleared, Farm means the strongest cleared zone; the trail is only the very first fallback.
  const farmZone = cleared ? zone : safeFarmZone(profile, content);
  const farmName = `${farmZone.name}${adv.zones[farmZone.id]?.cleared ? "" : " trail"}`;
  const pending = profile.pending;
  const showHpHint = profile.stats.runsStarted <= 2;
  const stageRole = adv.activity === "idle" ? "" : stage.role === "boss" ? "Boss" : stage.role === "elite" ? "Elite" : "";

  return (
    <>
      {!!profile.hunts?.queue.length && <section className="panel stack small" aria-label="Hunts ready"><b>{profile.hunts.queue.length} Hunt{profile.hunts.queue.length === 1 ? "" : "s"} waiting</b><span className="muted">Choose a route and earn gear for the slot you need.</span><button className="btn block" onClick={onChallenges}>View Hunts</button></section>}
      <section className="adventure-world">
        <div className="zone-card world-zone zone-context">
          <div className="row spread">
            <h2 className="zone-name">{zone.name}</h2>
            <span className="tag">{modeLabel}</span>
          </div>
          <div className="row spread">
            <StageDots total={zone.stages.length} current={stageIndex} roles={zone.stages.map((s) => s.role)} trail={run?.mode === "trail"} />
            <span className="zone-stage">Stage {stageIndex + 1} / {zone.stages.length}{stageRole && <b> · {stageRole}</b>}</span>
          </div>
        </div>
        <div className="combat-frame" data-background={zone.background}>
          <CombatView active={active} heroSprite={heroSprite} background={zone.background} />
          {adv.activity !== "idle" && (
            <div className="combat-names"><span title={enemyNames.join(" · ")}>{enemyNames.length === 1 ? enemyNames[0] : `${enemyNames.length} enemies`}</span></div>
          )}
        </div>
      </section>

      <section className="run-readout stack">
        <div className="row spread small">
          <span>
            <b>{number(run?.totals.xp ?? 0)}</b> <span className="muted">XP</span>
          </span>
          <span>
            <b>{number(run?.totals.mastery ?? 0)}</b> <span className="muted">Mastery</span>
          </span>
          <span>
            <b>{number(run?.totals.gold ?? 0)}</b> <span className="muted">gold</span>
          </span>
          <span>
            <b>{run?.totals.items ?? 0}</b> <span className="muted">{run?.totals.items === 1 ? "item" : "items"}</span>
          </span>
          <span className="muted">Best {zp?.bestStage ?? 0}/{zone.stages.length}</span>
        </div>
        {showHpHint && !pending && <div className="small faint">HP carries over and recovers after wins.</div>}
        {pending && (
          <div className="row spread">
            <span className="tag queued">Build change queued for after this fight</span>
            <button className="btn small ghost" onClick={() => session.dispatch({ type: "cancelPending" })}>
              Cancel
            </button>
          </div>
        )}
      </section>

      {showAshenKing && (
        <section aria-label={`${ashenKing.name} unlocked`}>
          <button className="btn small block" onClick={onChallenges}>View {ashenKing.name} challenge</button>
        </section>
      )}

      <section className="activity" aria-label="Adventure actions">
        <button
          className={`activity-btn ${adv.activity === "farm" && run?.zoneId === farmZone.id ? "active" : ""}`}
          data-testid="farm-button"
          onClick={() => session.dispatch({ type: "startFarm", zoneId: farmZone.id })}
        >
          <span>
            <span className="title">Farm</span>
            <span className="sub">{adv.activity === "push" ? `Stop Push · ${farmName}` : farmName}</span>
          </span>
        </button>
        <button
          className={`activity-btn ${adv.activity === "push" ? "active" : ""}`}
          disabled={!pushZone}
          onClick={() => {
            if (pushZone) session.dispatch({ type: "startPush", zoneId: pushZone.id });
          }}
        >
          <span>
            <span className="title">Push</span>
            <span className="sub">{pushZone ? `${retryZoneId ? "Retry · " : ""}${pushZone.name}` : "Zone cleared"}</span>
          </span>
        </button>
        <button className="activity-btn" aria-haspopup="dialog" onClick={() => setZonesOpen(true)}>
          <span className="title">Change Zone</span>
        </button>
      </section>

      {canShowZones && zonesOpen && (
        <Sheet label="Change Zone" onClose={() => setZonesOpen(false)}>
          <div className="row spread">
            <h2>Change Zone</h2>
            <button className="btn small ghost sheet-close" aria-label="Close zone picker" onClick={() => setZonesOpen(false)}>×</button>
          </div>
          <div className="list">
            {zones.map((v) => (
              <ZoneRow key={v.zone.id} view={v} activity={v.isCurrent ? adv.activity : "idle"} onStart={(type) => {
                if (session.dispatch({ type, zoneId: v.zone.id }).ok) setZonesOpen(false);
              }} />
            ))}
          </div>
          {nextAttempt}
        </Sheet>
      )}
    </>
  );
}

function ZoneRow({ view, activity, onStart }: { view: ZoneView; activity: Profile["adventure"]["activity"]; onStart: (type: "startPush" | "startFarm") => void }) {
  const { zone, status } = view;
  const stages = zone.stages.length;
  const detail =
    status === "locked"
      ? `Locked · clear ${view.unlockedBy?.name ?? "the previous zone"}`
      : status === "cleared"
        ? `Cleared${view.completions > 1 ? ` ×${view.completions}` : ""}`
        : `Best stage ${view.bestStage}/${stages}`;
  const action = status === "cleared" ? "farm" : "push";
  const running = view.isCurrent && activity === action;
  return (
    <div className={`list-item zone-row ${status}`} data-zone={zone.id}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <div className="item-name">
          {zone.name}
          {view.isCurrent && <span className="tag" style={{ marginLeft: 8 }}>Here</span>}
        </div>
        <div className="small muted">
          Enemy level {view.minLevel}–{view.maxLevel} · {detail}
        </div>
      </span>
      {status === "locked" ? (
        <button className="btn small" disabled>
          Locked
        </button>
      ) : (
        <button
          className={`btn small ${action === "push" ? "primary" : ""}`}
          disabled={running}
          onClick={() => onStart(action === "push" ? "startPush" : "startFarm")}
        >
          {running ? (action === "push" ? "Pushing" : "Farming") : action === "push" ? "Push" : "Farm"}
        </button>
      )}
    </div>
  );
}

function StageDots({ total, current, roles, trail }: { total: number; current: number; roles: string[]; trail: boolean }) {
  return (
    <div className="stage-dots" aria-label={`Stage ${current + 1} of ${total}`}>
      {Array.from({ length: total }, (_, i) => {
        const cls = [
          "stage-dot",
          !trail && i < current ? "done" : "",
          i === current ? "current" : "",
          roles[i] === "elite" ? "elite" : "",
          roles[i] === "boss" ? "boss" : "",
        ].join(" ");
        return <span key={i} className={cls} title={`Stage ${i + 1}${roles[i] === "normal" ? "" : ` · ${roles[i]}`}`} aria-label={`Stage ${i + 1} ${roles[i]}`}>{roles[i] === "elite" ? "◆" : roles[i] === "boss" ? "♜" : ""}</span>;
      })}
    </div>
  );
}
