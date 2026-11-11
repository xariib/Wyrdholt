import { useState } from "react";
import { ASHEN_CROWN, ASHEN_KING_ID, activeBossAttempt, activeHuntAttempt, ashenCrownAt, type Profile } from "@emberbound/game-core";
import { Hunts } from "./Hunts";
import { session } from "../../game/session";
import { Bar } from "../components/Common";
import { CombatView } from "../components/CombatView";
import { bossResultLabel, hp, pct } from "../format";
import { LongTermChallenges } from "./LongTermChallenges";

export function ChallengesScreen({ profile, active, onReviewGear }: { profile: Profile; active: boolean; onReviewGear: () => void }) {
  const [autoPush, setAutoPush] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const boss = session.content.soloBosses.get(ASHEN_KING_ID)!;
  const zone = session.content.zone(boss.unlockZoneId);
  const unlocked = profile.adventure.zones[zone.id]?.cleared === true;
  const progress = profile.ashenKing;
  const currentAttempt = activeBossAttempt(profile);
  const attempt = progress?.active;
  const result = progress?.lastResult;
  const cleared = progress?.highestClearedTier ?? 0;
  const nextTier = cleared + 1;
  const complete = cleared >= boss.tiers.length;
  const crown = ashenCrownAt(cleared);
  const reward = result?.outcome === "victory" ? ASHEN_CROWN.milestones.find(m => m.tier === result.tier) : undefined;
  const retry = result && result.outcome !== "victory";

  async function start(): Promise<void> {
    setStarting(true);
    setError("");
    const started = await session.startBoss(nextTier, autoPush);
    if (!started.ok) setError(started.error);
    else setAutoPush(false);
    setStarting(false);
  }

  return (
    <>
      <Hunts profile={profile} active={active} onReviewGear={onReviewGear} />
      {currentAttempt && currentAttempt !== attempt && <LongTermCombat profile={profile} active={active} attempt={currentAttempt} />}
      <section className="panel stack" aria-label="Ashen King ladder">
        <div className="row spread">
          <h2>{boss.name}</h2>
          <span className={`tag ${complete ? "gold" : ""}`}>{complete ? "Complete" : unlocked ? "Solo Boss" : "Locked"}</span>
        </div>
        {unlocked ? (
          <>
            <div className="small muted">Tiers cleared {cleared} / {boss.tiers.length}</div>
            <div className="stage-dots" aria-hidden="true">
              {boss.tiers.map((_, index) => <i key={index} className={`stage-dot ${index < cleared ? "done" : index === cleared ? "current" : ""}`} />)}
            </div>
            {!complete && <div className="small">{attempt ? "Fighting" : "Next opponent"} · {boss.name} · Tier {nextTier}</div>}
          </>
        ) : <p className="small muted">Clear {zone.name} to unlock this challenge.</p>}
      </section>

      {attempt && (
        <section className="adventure-world" aria-label={`Ashen King tier ${nextTier} combat`}>
          <div className="combat-frame boss-combat">
            <CombatView active={active} heroSprite={session.content.classDef(attempt.record.build.classId).sprite} background={zone.background} />
            <div className="combat-banner boss">ASHEN KING · TIER {nextTier}</div>
          </div>
          <div className="combat-names"><span className="hero-name">{profile.character.name}</span><span>{boss.name}</span></div>
          <p className="small muted">Combat runs automatically.{attempt.autoPush ? " Auto-push continues after a win while the game is open." : ""}</p>
        </section>
      )}

      {result && (
        <section className="panel stack" role="status" aria-label="Ashen King result">
          <div className="panel-title">{bossResultLabel(result)}</div>
          {result.enemyHp100 > 0 && (
            <>
              <Bar value={result.enemyHp100} max={result.enemyMaxHp100} kind="hp" />
              <span className="small muted">Boss HP left {hp(result.enemyHp100)} / {hp(result.enemyMaxHp100)}</span>
            </>
          )}
          {reward && <span className="small">{ASHEN_CROWN.name} {reward.rank === 1 ? "unlocked" : `upgraded to rank ${reward.rank}`}.</span>}
          {!attempt && profile.adventure.activity === "farm" && <span className="small muted">Farming {session.content.zone(profile.adventure.zoneId).name} while you decide.</span>}
        </section>
      )}

      {unlocked && !currentAttempt && !activeHuntAttempt(profile) && !complete && (
        <section className="panel stack" aria-label="Start Ashen King attempt">
          <p className="small muted">Start at full HP with your current build. Adventure farming resumes after your attempt.</p>
          {nextTier < boss.tiers.length && (
            <label className="row boss-auto-push">
              <input type="checkbox" checked={autoPush} disabled={starting} onChange={event => setAutoPush(event.target.checked)} />
              <span>Auto-push after wins while online</span>
            </label>
          )}
          <button className="btn primary block" disabled={starting} onClick={() => void start()}>{retry ? "Retry" : "Challenge"} Tier {nextTier}</button>
          {retry && <button className="btn block" onClick={onReviewGear}>Review gear</button>}
          {error && <span className="small" role="alert">{error}</span>}
        </section>
      )}

      <section className="panel stack" aria-label="Ashen Crown Artifact">
        <div className="row spread"><div className="panel-title">{ASHEN_CROWN.name}</div><span className="tag gold">Artifact</span></div>
        <div className="small">{crown ? `Rank ${crown.rank} · +${pct(crown.attackBp)} Attack` : "Unlocks at Tier 1"}</div>
        <div className="small muted">A permanent Attack bonus for both classes. Its rank increases as you clear the ladder.</div>
        <div className="list">
          {ASHEN_CROWN.milestones.map(m => (
            <div key={m.tier} className="list-item row spread small">
              <span>Tier {m.tier} · Rank {m.rank}</span><span className={cleared >= m.tier ? "" : "muted"}>+{pct(m.attackBp)} Attack</span>
            </div>
          ))}
        </div>
      </section>

      <LongTermChallenges profile={profile} active={active} />
    </>
  );
}

function LongTermCombat({ profile, active, attempt }: { profile: Profile; active: boolean; attempt: NonNullable<ReturnType<typeof activeBossAttempt>> }) {
  const { bossId, tier } = attempt.record.encounter;
  const content = session.content;
  const boss = content.soloBosses.get(bossId);
  if (!boss) return null;
  return (
    <section className="adventure-world" aria-label={`${boss.name} combat`}>
      <div className="combat-frame boss-combat">
        <CombatView active={active} heroSprite={content.classDef(attempt.record.build.classId).sprite} background={content.zone(boss.unlockZoneId).background} />
        <div className="combat-banner boss">{boss.name} · Tier {tier}</div>
      </div>
      <div className="combat-names"><span className="hero-name">{profile.character.name}</span><span>{boss.name}</span></div>
      <p className="small muted">Combat runs automatically. Adventure farming resumes after the attempt.</p>
    </section>
  );
}
