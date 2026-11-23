import { activeBossAttempt, bossProgress, findInstance, huntResetAt, huntWeekAt, type Profile } from "@emberbound/game-core";
import { useState } from "react";
import { session } from "../../game/session";
import { bossResultLabel, number } from "../format";

export function Hunts({ profile }: { profile: Profile }) {
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState("");
  const { content } = session;
  const week = huntWeekAt(Math.max(Date.now(), profile.clock.lastSettledWallMs));
  const reset = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(huntResetAt(week));
  const classId = profile.pending?.activeClassId ?? profile.character.activeClassId;
  async function start(id: string) {
    setStarting(id);
    setError("");
    try {
      const result = await session.startBoss(1, false, id);
      if (!result.ok) setError(result.error);
    } catch {
      setError("The Hunt could not be started. Try again.");
    } finally {
      setStarting(null);
    }
  }
  return <section className="panel stack" aria-label="Weekly Hunts">
    <div className="row spread"><h2>Weekly Hunts</h2><span className="small muted">Resets {reset} · 00:00 UTC</span></div>
    {!profile.character.huntTalentClasses?.includes(classId) && <p className="small muted">First win as {content.classDef(classId).name} earns a bonus skill point.</p>}
    {[...content.hunts.values()].map(({ boss, rewards, xp, mastery, gold }) => {
      const state = bossProgress(profile, boss.id);
      const zone = content.zone(boss.unlockZoneId);
      const locked = !profile.adventure.zones[zone.id]?.cleared;
      const cleared = (state?.huntCompletedWeek ?? -1) >= week;
      const latest = state?.huntWeek === week ? state.lastResult : null;
      const won = latest?.huntRewardId === undefined ? undefined : findInstance(profile, latest.huntRewardId);
      const reward = content.item(won?.baseId ?? rewards[classId]!);
      return <article className="hunt-row stack" key={boss.id}>
        <div className="row spread"><h3>{boss.name}</h3>
          <span className="small muted">{cleared ? "Claimed" : locked ? zone.name : latest ? bossResultLabel(latest) : zone.name}</span>
        </div>
        <p className="small"><b style={{ color: content.rarity(reward.rarity).color }}>{reward.name}</b></p>
        <p className="small muted">{number(xp)} XP · {number(mastery)} Mastery XP · {number(gold)} Gold</p>
        <button className="btn block" disabled={locked || cleared || !!starting || !!activeBossAttempt(profile)} onClick={() => void start(boss.id)}>
          {locked ? `Clear ${zone.name}` : cleared ? "Reward earned this week" : starting === boss.id ? "Starting…" : latest ? "Retry Hunt" : "Start Hunt"}
        </button>
      </article>;
    })}
    {error && <p className="small" role="alert">{error}</p>}
  </section>;
}
