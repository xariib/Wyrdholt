import type { ReactNode } from "react";
import { ASHEN_KING_ID, heroStatsFor, type Profile, type RunResult } from "@emberbound/game-core";
import { session, type OfflineView } from "../../game/session";
import { Bar, Modal } from "../components/Common";
import { ItemIcon } from "../components/icons";
import { DEV_TOOLS } from "../../platform/device";
import { bossResultLabel, duration, hp, number, rarityColor } from "../format";
import type { GearFocus } from "../screens/Gear";
import { safeFarmZone } from "../adventureModel";
import { isEquippedDuplicate, slotViews } from "../gearModel";
import { attemptHistory, attemptLabel, buildChanges, type Attempt } from "../../game/attempts";

/**
 * The last few Push attempts in this zone and what changed since the previous one, so the
 * player can see progress between meaningful upgrades (C1 retune).
 */
function AttemptTrail({ profile, zoneId }: { profile: Profile; zoneId: string }) {
  const content = session.content;
  const history: Attempt[] = attemptHistory(profile, zoneId);
  if (history.length === 0) return null;
  const last = history[history.length - 1]!;
  const prev = history.length >= 2 ? history[history.length - 2]! : null;
  const changes = prev ? buildChanges(prev, last, content) : [];
  return (
    <div className="small stack" data-testid="attempt-trail" style={{ gap: 2 }}>
      <span>
        <span className="muted">Your attempts: </span>
        {history.slice(-4).map((a, i, arr) => (
          <span key={a.atWallMs + ":" + i} style={i === arr.length - 1 ? { fontWeight: 700 } : undefined}>
            {i > 0 ? " → " : ""}
            {attemptLabel(a, content)}
          </span>
        ))}
      </span>
      {prev && (
        <span className="muted">
          {changes.length > 0
            ? `Since the previous attempt: ${changes.join(", ")}.`
            : "Same build as the previous attempt, so a similar result is expected. A level, a Mastery rank or new gear moves you closer."}
        </span>
      )}
    </div>
  );
}

export function OfflineOverlay({
  data,
  onReview,
  onChallenges,
  onFieldTrials,
  retryAction,
}: {
  data: OfflineView;
  onReview: (focus: GearFocus | "new") => void;
  onChallenges: () => void;
  onFieldTrials: () => void;
  retryAction: ReactNode;
}) {
  const content = session.content;
  const s = data.summary;
  const t = data.telemetry;
  const ashenKing = content.soloBosses.get(ASHEN_KING_ID);
  const bossUnlocked = data.kept && ashenKing && s.push.zoneId === ashenKing.unlockZoneId;
  const zoneName = (id: string | null) => (id ? content.zone(id).name : "");
  const modeName = (mode: string) => (mode === "push" ? "Pushed" : mode === "trail" ? "Farmed the trail of" : "Farmed");
  // Time spent farming after the failed Push (every segment after the first Push segment).
  const pushIndex = s.segments.findIndex((x) => x.mode === "push");
  const after = pushIndex >= 0 ? s.segments.slice(pushIndex + 1).filter((x) => x.mode !== "push") : [];
  const safeFarm = after.length > 0 ? { zoneId: after[after.length - 1]!.zoneId, mode: after[after.length - 1]!.mode, ms: after.reduce((a, x) => a + x.ms, 0) } : null;
  return (
    <Modal onClose={() => session.dismissOffline()}>
      <div>
        <h2 style={{ fontSize: 22 }}>While you were away…</h2>
        <div className="muted small">
          {duration(s.simulatedMs)} of adventure
          {s.capped ? ` (you were away ${duration(s.requestedMs)}; the adventure keeps going for up to ${duration(content.snapshot.config.offlineCapMs)})` : ""}
        </div>
      </div>
      {s.push.status === "cleared" && (
        <div className="panel small" style={{ borderColor: "rgba(124,200,98,0.5)" }}>
          <b>{zoneName(s.push.zoneId)} cleared!</b>
          {s.unlockedZoneIds.length > 0 && ` ${s.unlockedZoneIds.map((z) => content.zone(z).name).join(", ")} unlocked — begin it when you choose.`}
          {bossUnlocked && (
            <div className="stack">
              <span>{ashenKing.name} unlocked.</span>
              <button className="btn block" onClick={onChallenges}>View {ashenKing.name} challenge</button>
            </div>
          )}
        </div>
      )}
      {s.push.status === "failed" && s.push.zoneId && (
        <div className="panel small stack" style={{ borderColor: "rgba(234,122,59,0.5)" }} data-testid="offline-push-failed">
          <b>
            Push failed at {zoneName(s.push.zoneId)} · stage {s.push.stage}/{s.push.stagesTotal}
            {content.zone(s.push.zoneId).stages[s.push.stage - 1]?.role === "boss" ? " (Boss)" : content.zone(s.push.zoneId).stages[s.push.stage - 1]?.role === "elite" ? " (Elite)" : ""}
          </b>
          <Bar value={s.push.enemyHp100} max={s.push.enemyMaxHp100} kind="hp" />
          <span className="muted">
            Enemy HP left: {hp(s.push.enemyHp100)} / {hp(s.push.enemyMaxHp100)} ({Math.round((100 * s.push.enemyHp100) / Math.max(1, s.push.enemyMaxHp100))}%).
          </span>
          {safeFarm && (
            <span>
              Safe farming switched to <b>{zoneName(safeFarm.zoneId)}</b>
              {safeFarm.mode === "trail" ? " (trail)" : ""} for <b>{duration(safeFarm.ms)}</b>.
            </span>
          )}
          <AttemptTrail profile={data.profileAfter} zoneId={s.push.zoneId} />
          {data.kept && <button className="btn block" onClick={onFieldTrials}>Try Field Trials</button>}
        </div>
      )}
      {s.boss && (
        <div className="panel small stack">
          <b>{content.soloBosses.get(s.boss.bossId ?? ASHEN_KING_ID)?.name ?? "Challenge"} · {s.boss.result ? bossResultLabel(s.boss.result) : `Tier ${s.boss.tier} still in progress`}</b>
          {s.boss.result && s.boss.result.enemyHp100 > 0 && (
            <span className="muted">Boss HP left {hp(s.boss.result.enemyHp100)} / {hp(s.boss.result.enemyMaxHp100)}</span>
          )}
          <span className="muted">{duration(s.boss.ms)} spent on the challenge while you were away.</span>
          {data.kept && <button className="btn block" onClick={onChallenges}>View Challenges</button>}
        </div>
      )}
      <div className="stack small">
        {s.segments.map((seg, i) => (
          <div key={i} className="row spread">
            <span>
              {modeName(seg.mode)} {content.zone(seg.zoneId).name}
            </span>
            <span className="muted">{duration(seg.ms)}</span>
          </div>
        ))}
      </div>
      <div className="stat-grid" data-testid="offline-stats" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
        <div className="stat">
          <span className="label">Character XP</span>
          <span className="value">+{number(s.xp)}</span>
          <span className="small muted">{s.levelBefore === s.levelAfter ? `Level ${s.levelAfter}` : `Level ${s.levelBefore} → ${s.levelAfter}`}</span>
        </div>
        <div className="stat" data-testid="offline-mastery">
          <span className="label">{content.classDef(t.classAtEnd).name} Mastery</span>
          <span className="value">+{number(t.masteryByClass[t.classAtEnd] ?? 0)}</span>
          <span className="small muted">
            {t.masteryRankBefore !== t.masteryRankAfter ? `M${t.masteryRankBefore} → M${t.masteryRankAfter}` : `M${t.masteryRankAfter}`}
          </span>
        </div>
        <div className="stat">
          <span className="label">Gold</span>
          <span className="value">+{number(s.gold)}</span>
        </div>
        <div className="stat" data-testid="offline-items">
          <span className="label">Items</span>
          <span className="value">+{number(s.itemsFound)}</span>
        </div>
      </div>
      {data.notable.length > 0 && (
        <div className="stack">
          <div className="panel-title">Notable finds</div>
          {data.notable.map(({ instanceId: id, baseId }) => {
            const item = content.item(baseId);
            const color = rarityColor(content, item.rarity);
            return (
              <div key={id} className="list-item">
                <ItemIcon icon={item.icon} rarityColor={color} size={40} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div className="item-name">{item.name}</div>
                  <div className="rarity" style={{ color }}>
                    {content.rarity(item.rarity).name}
                    {item.effect ? ` · ${item.effect.name}` : ""}
                  </div>
                </span>
                {data.kept && (
                  <button className="btn small" onClick={() => onReview({ slot: item.slot, baseId: item.id, instanceId: id })}>
                    Compare
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {s.otherItems > 0 && <div className="small muted">+{number(s.otherItems)} other items</div>}
      {s.itemsFound === 0 && <div className="small muted">No new items this time.</div>}
      {DEV_TOOLS && (
        <details className="mono faint small" data-testid="offline-details">
          <summary>Settlement details (dev)</summary>
          <div>
            away {duration(t.requestedMs)} · simulated {duration(t.simulatedMs)} · activity at start: {t.activityAtStart}
          </div>
          {t.resumedFrom && <div>resumed after defeat: {t.resumedFrom}</div>}
          <div>
            class: {t.classAtStart}
            {t.classAtStart !== t.classAtEnd ? ` → ${t.classAtEnd}` : ""} · level {t.levelBefore} → {t.levelAfter} · M{t.masteryRankBefore} → M{t.masteryRankAfter}
          </div>
          <div>
            character XP +{number(t.characterXp)} · mastery XP{" "}
            {Object.keys(t.masteryByClass).length === 0
              ? "+0"
              : Object.entries(t.masteryByClass)
                  .map(([id, v]) => `${id} +${number(v)}`)
                  .join(", ")}
          </div>
          <div>
            gold +{number(t.gold)} · items {number(t.items)} · fights {number(t.fights)} ({number(t.victories)} won, {number(t.defeats)} lost)
          </div>
          <div>
            targets: {t.targets.length === 0 ? "none" : t.targets.map((x) => `${x.mode} ${content.zone(x.zoneId).name} ${duration(x.ms)}`).join(" · ")}
          </div>
        </details>
      )}
      {DEV_TOOLS && (
        <div className="mono faint">
          catch-up {data.totalMs.toFixed(0)} ms total · {data.computeMs.toFixed(0)} ms compute · {data.mode} · {number(s.fights)} fights
          {data.kept ? "" : " · benchmark only (not kept)"}
        </div>
      )}
      <div className="stack">
        {data.kept && s.itemsFound > 0 && (
          <button className="btn block" onClick={() => onReview("new")}>
            Review new gear
          </button>
        )}
        {data.kept && retryAction}
        <button className={data.kept && retryAction ? "btn ghost block" : "btn primary block"} onClick={() => session.dismissOffline()}>
          Continue
        </button>
      </div>
    </Modal>
  );
}

export function RunResultOverlay({ result, profile, newCount, onReview, onRetry, onFieldTrials }: {
  result: RunResult; profile: Profile; newCount: number;
  onReview: (focus: "new" | null) => void; onRetry: () => void; onFieldTrials: () => void;
}) {
  const content = session.content;
  const zone = content.zone(result.zoneId);
  // After a failed Push the safe choice is the strongest cleared zone (or the first trail).
  // The session already started that safe Farm, so progress continues while this is open.
  const run = profile.adventure.run;
  const farming = profile.adventure.activity === "farm" && run !== null;
  const farmZone = farming ? content.zone(run.zoneId) : safeFarmZone(profile, content);
  const farmName = run?.mode === "trail" || !profile.adventure.zones[farmZone.id]?.cleared ? `the ${farmZone.name} trail` : farmZone.name;
  const farmLabel = farming ? `Keep farming ${farmName}` : `Farm ${farmName}`;
  const failedStage = zone.stages[Math.max(0, result.stage - 1)];
  const rank = heroStatsFor(profile, content).masteryRank;
  const equipped = new Map(slotViews(profile, content).map(slot => [slot.slot, slot.equipped?.instance]));
  const hasBuildOption = profile.inventory.instances.some(item => {
    const worn = equipped.get(content.item(item.baseId).slot);
    return item.id !== worn?.id && !isEquippedDuplicate(item, worn);
  });
  const review = (focus: "new" | null) => {
    session.dismissRunResult();
    onReview(focus);
  };
  return (
    <Modal>
      <div>
        <h2 style={{ fontSize: 22 }}>{result.kind === "timeout" ? "Out of time" : "Defeated"}</h2>
        <div className="muted small">
          {zone.name} · stage {result.stage} / {result.stagesTotal}
          {result.newBest && <span className="tag gold" style={{ marginLeft: 8 }}>New best</span>}
        </div>
      </div>
      <div className="stack small">
        <span className="muted">
          Enemy HP left: {hp(result.enemyHp100)} / {hp(result.enemyMaxHp100)} ({result.enemiesAlive} standing)
        </span>
        <Bar value={result.enemyHp100} max={result.enemyMaxHp100} kind="hp" />
        {result.mode === "push" && <AttemptTrail profile={profile} zoneId={result.zoneId} />}
        {failedStage && (
          <span className="muted">
            Stage {result.stage} enemies are level {failedStage.level}. You are a level {profile.character.level} {content.classDef(profile.character.activeClassId).name}, Mastery M{rank}. More levels,
            mastery or better gear will get you further.
          </span>
        )}
      </div>
      <div className="panel small">
        You keep everything earned: <b>{number(result.totals.xp)} XP</b>, <b>{number(result.totals.mastery)} Mastery</b>,{" "}
        <b>{number(result.totals.gold)} gold</b>, <b>{result.totals.items} {result.totals.items === 1 ? "item" : "items"}</b>. The run itself
        starts again from stage 1.
        {farming && <> Meanwhile you are farming {farmName}, so progress continues even if you close the game.</>}
      </div>
      <div className="stack">
        <div className="panel-title">What to do next</div>
        {newCount > 0 ? (
          <>
            <p className="small">Review your new drops and compare them with your equipped gear.</p>
            <button className="btn primary block" onClick={() => review("new")}>Review new gear ({newCount})</button>
          </>
        ) : hasBuildOption ? (
          <>
            <p className="small">You have other gear to try before your next attempt.</p>
            <button className="btn primary block" onClick={() => review(null)}>Change build</button>
          </>
        ) : (
          <p className="small">Farm {farmName} to gain levels, Mastery and a chance at different gear.</p>
        )}
        <button className={newCount || hasBuildOption ? "btn block" : "btn primary block"} onClick={onFieldTrials}>Try Field Trials</button>
        <button className="btn block" onClick={() => session.dispatch({ type: "startFarm", zoneId: farmZone.id })}>
          {farmLabel}
        </button>
        {result.mode === "push" && <button className="btn ghost block" onClick={onRetry}>Retry {zone.name}</button>}
      </div>
    </Modal>
  );
}
