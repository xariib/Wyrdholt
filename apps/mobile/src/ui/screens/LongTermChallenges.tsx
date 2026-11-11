import { useEffect, useState } from "react";
import { activeBossAttempt, activeHuntAttempt, bossProgress, currentSeason, masteryRank, seasonTierOpenAt, type BossResult, type Profile } from "@emberbound/game-core";
import { session } from "../../game/session";
import { bossResultLabel, hp, pct } from "../format";

function utcDate(ms: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(ms);
}

function Result({ result }: { result: BossResult | null | undefined }) {
  if (!result) return null;
  return (
    <p className="small" role="status">
      {bossResultLabel(result)}{result.enemyHp100 > 0 ? ` · ${hp(result.enemyHp100)} / ${hp(result.enemyMaxHp100)} boss HP left` : ""}
    </p>
  );
}

export function LongTermChallenges({ profile, active }: { profile: Profile; active: boolean }) {
  const [now, setNow] = useState(Date.now);
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [active]);

  const content = session.content;
  const atMs = Math.max(now, profile.clock.lastSettledWallMs);
  const season = currentSeason(content, atMs);
  const next = [...content.seasons.values()].filter(s => s.startMs > atMs).sort((a, b) => a.startMs - b.startMs)[0];
  const seasonProgress = season && bossProgress(profile, season.boss.id);
  const rank = seasonProgress?.highestClearedTier ?? 0;
  const nextTier = rank + 1;
  const busy = starting !== null || Boolean(activeBossAttempt(profile) || activeHuntAttempt(profile));
  const isCleared = (zoneId: string) => profile.adventure.zones[zoneId]?.cleared === true;

  async function start(id: string, tier: number): Promise<void> {
    setError("");
    setStarting(id);
    const result = await session.startBoss(tier, false, id);
    if (!result.ok) setError(result.error);
    setStarting(null);
  }

  return (
    <>
      <section className="panel stack" aria-label="Promotion trials">
        <h2>Promotion trials</h2>
        {[profile.character.activeClassId, profile.character.alternateClassId].map(classId => {
          const path = content.promotions.get(classId);
          if (!path) return null;
          const progress = bossProgress(profile, path.boss.id);
          const complete = progress?.highestClearedTier === 1;
          const ready = isCleared(path.boss.unlockZoneId) && profile.character.level >= path.level
            && masteryRank(content, classId, profile.character.masteryXp[classId] ?? 0) >= path.mastery
            && (profile.pending?.activeClassId ?? profile.character.activeClassId) === classId;
          return (
            <div className="list-item stack" key={classId}>
              <div className="row spread"><b>{content.classDef(classId).name} · {path.name}</b>{complete && <span className="tag gold">Promoted</span>}</div>
              <p className="small muted">+{pct(path.attackBp)} Attack for this class after victory.</p>
              {!complete && <p className="small muted">Clear {content.zone(path.boss.unlockZoneId).name}, reach Level {path.level} and Mastery {path.mastery}, and make this class active.</p>}
              <Result result={progress?.lastResult} />
              {!complete && <button className="btn block" disabled={!ready || busy} onClick={() => void start(path.boss.id, 1)}>{progress?.active ? "Trial in progress" : `${progress?.lastResult ? "Retry" : "Enter"} ${path.boss.name}`}</button>}
            </div>
          );
        })}
      </section>

      <section className="panel stack" aria-label="Seasons">
        <h2>{season?.name ?? "Seasons"}</h2>
        {season ? (
          <>
            <p className="small muted">{season.boss.name} · Ends {utcDate(season.endMs)} at 00:00 UTC</p>
            <p className="small">{season.rule.name}</p>
            <p className="small">{season.relicName} · Rank {rank} · +{pct(season.relicAttackBp[rank - 1] ?? 0)} Attack in this ladder</p>
            <p className="small muted">The Relic expires at season end. Earned titles remain in your season history.</p>
            <div className="list" aria-label="Season rewards">
              {season.titles.map((title, index) => (
                <div className="list-item row spread small" key={title}>
                  <span>Tier {index + 1} · {title}</span>
                  <span>{index < rank ? "Earned" : `+${pct(season.relicAttackBp[index]!)} Relic Attack`}</span>
                </div>
              ))}
            </div>
            <Result result={seasonProgress?.lastResult} />
            {!isCleared(season.boss.unlockZoneId) && <p className="small muted">Clear {content.zone(season.boss.unlockZoneId).name} to enter.</p>}
            {nextTier <= season.boss.tiers.length && (
              <button className="btn primary block" disabled={busy || !isCleared(season.boss.unlockZoneId) || atMs < seasonTierOpenAt(season, nextTier)} onClick={() => void start(season.boss.id, nextTier)}>
                {seasonProgress?.active ? "Attempt in progress" : atMs < seasonTierOpenAt(season, nextTier) ? `Tier ${nextTier} opens ${utcDate(seasonTierOpenAt(season, nextTier))}` : `Challenge seasonal Tier ${nextTier}`}
              </button>
            )}
          </>
        ) : <p className="small muted">{next ? `${next.name} starts ${utcDate(next.startMs)} at 00:00 UTC.` : "No season is currently open."}</p>}
        {[...content.seasons.values()].filter(s => s.endMs <= atMs).map(s => {
          const cleared = bossProgress(profile, s.boss.id)?.highestClearedTier ?? 0;
          return cleared > 0 && <p className="small" key={s.boss.id}>{s.name} · {s.titles.slice(0, cleared).join(", ")}</p>;
        })}
        {error && <p className="small" role="alert">{error}</p>}
      </section>
    </>
  );
}
