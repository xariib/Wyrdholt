import type { ReactNode } from "react";
import { ASHEN_KING_ID, activeBossAttempt, type Profile } from "@emberbound/game-core";
import { session } from "../../game/session";
import { safeFarmZone, zoneViews, type ZoneView } from "../adventureModel";
import { CombatView } from "../components/CombatView";

import { FarmIcon, PushIcon } from "../components/icons";
import { number } from "../format";

export function AdventureScreen({ profile, active, nextAttempt, onChallenges }: { profile: Profile; active: boolean; nextAttempt: ReactNode; onChallenges: () => void }) {
  const boss = activeBossAttempt(profile);
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
  // "Begin" appears for unlocked, uncleared zones after the current one; entering is always a choice.
  const nextZones = zone.unlocks
    .map((id) => content.zone(id))
    .filter((z) => adv.zones[z.id]?.unlocked && !adv.zones[z.id]?.cleared && z.id !== adv.zoneId);
  const zones = zoneViews(profile, content);
  // Farming an uncleared zone repeats its first stage (the "trail"): no Elite, Boss or cache,
  // slow fights for its level. From the A40 playtest save, the Darkwood trail paid 56% of the
  // Character XP and 41% of the Mastery XP per hour of a Greenfields Farm. So once any zone is
  // cleared, Farm means the strongest cleared zone; the trail is only the very first fallback.
  const farmZone = cleared ? zone : safeFarmZone(profile, content);
  const pending = profile.pending;
  const showHpHint = profile.stats.runsStarted <= 2;

  return (
    <>
      <section className="adventure-world">
        <div className="combat-frame">
          <CombatView active={active} heroSprite={heroSprite} background={zone.background} />
          <div className="zone-card world-zone">
            <div className="row spread"><h2 className="zone-name">{zone.name}</h2><div className="zone-context"><span className="tag">{modeLabel}</span><span>Stage {stageIndex + 1} / {zone.stages.length}</span></div></div>
            <StageDots total={zone.stages.length} current={stageIndex} roles={zone.stages.map((s) => s.role)} trail={run?.mode === "trail"} />
          </div>
          <div className={`combat-banner ${stage.role === "boss" ? "boss" : ""}`}>{adv.activity === "idle" ? "" : stage.role === "boss" ? "ZONE BOSS" : stage.role === "elite" ? "ELITE" : ""}</div>
        </div>
        <div className="combat-names"><span className="hero-name">{profile.character.name}</span><span title={enemyNames.join(" · ")}>{adv.activity === "idle" ? "" : enemyNames.length === 1 ? enemyNames[0] : `${enemyNames.length} enemies`}</span></div>
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
        {showHpHint && <div className="small faint">HP carries between stages, with a little recovery after each win.</div>}
        {pending && (
          <div className="row spread">
            <span className="tag queued">Build change queued — applies after this fight</span>
            <button className="btn small ghost" onClick={() => session.dispatch({ type: "cancelPending" })}>
              Cancel
            </button>
          </div>
        )}
      </section>

      <section className="activity">
        <button
          className={`activity-btn ${adv.activity === "push" ? "active" : ""}`}
          disabled={cleared}
          onClick={() => session.dispatch({ type: "startPush", zoneId: zone.id })}
        >
          <PushIcon />
          <span>
            <div className="title">Push</div>
            <div className="sub">{cleared ? "Zone cleared" : "Clear the zone"}</div>
          </span>
        </button>
        <button
          className={`activity-btn ${adv.activity === "farm" && run?.zoneId === farmZone.id ? "active" : ""}`}
          data-testid="farm-button"
          onClick={() => session.dispatch({ type: "startFarm", zoneId: farmZone.id })}
        >
          <FarmIcon />
          <span>
            {/* The label always names what will actually be farmed. */}
            <div className="title">{adv.activity === "push" ? `Stop Push & farm ${farmZone.name}${!adv.zones[farmZone.id]?.cleared ? " trail" : ""}` : cleared ? `Farm ${zone.name}` : farmZone.id !== zone.id ? `Safe farm · ${farmZone.name}` : "Farm the trail"}</div>
            <div className="sub">
              {cleared ? "Repeat the whole zone" : farmZone.id !== zone.id ? "Best XP and Mastery for you now" : `Repeat ${zone.name} stage 1 safely`}
            </div>
          </span>
        </button>
      </section>

      {showAshenKing && (
        <section className="panel stack" aria-label={`${ashenKing.name} unlocked`}>
          <div className="panel-title">{ashenKing.name} unlocked</div>
          <p className="small muted">Take on the solo boss ladder to earn the Ashen Crown.</p>
          <button className="btn block" onClick={onChallenges}>View {ashenKing.name} challenge</button>
        </section>
      )}
      {nextAttempt}
      {nextZones.map((z) => (
        <section key={z.id} className="panel row spread">
          <div>
            <div className="panel-title">{z.name} unlocked</div>
            <div className="small muted">{z.implemented ? z.description : "Not playable in this test build."}</div>
          </div>
          <button
            className="btn small gold"
            disabled={!z.implemented}
            onClick={() => session.dispatch({ type: "startPush", zoneId: z.id })}
          >
            Begin {z.name}
          </button>
        </section>
      ))}

      <section className="zone-directory stack">
        <div className="row spread">
          <span className="panel-title">Zones</span>
          <span className="small muted">Level {profile.character.level}</span>
        </div>
        <div className="list">
          {zones.map((v) => (
            <ZoneRow key={v.zone.id} view={v} activity={v.isCurrent ? adv.activity : "idle"} />
          ))}
        </div>
      </section>
    </>
  );
}

function ZoneRow({ view, activity }: { view: ZoneView; activity: string }) {
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
          onClick={() => session.dispatch({ type: action === "push" ? "startPush" : "startFarm", zoneId: zone.id })}
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
