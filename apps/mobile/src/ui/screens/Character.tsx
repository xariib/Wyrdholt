import { ASHEN_CROWN, ashenCrownAt, masteryProgress, nextMilestone, promotionCleared, techniqueStatuses, type Profile } from "@emberbound/game-core";
import { session } from "../../game/session";
import { Bar } from "../components/Common";
import { SpriteImage } from "../components/icons";
import { number, pct } from "../format";

const COMBAT_CUES: Record<string, string> = {
  warrior: "In combat: red marks and ticks show Bleed. Red pulses show Retaliation; Execute strengthens hits against weakened enemies.",
  monk: "In combat: green numbers show healing. Blue marks show Flow; pale-blue extra hits show Combo.",
  mage: "In combat: orange marks show Burn. Blue shields and shield numbers show Arcane Ward; violet hits show spell procs.",
  ranger: "In combat: green marks show Poison. Split Arrow links targets; green pulses show Venom Burst.",
};

export function CharacterScreen({ profile }: { profile: Profile }) {
  const c = profile.character;
  const queuedClass = profile.pending?.activeClassId;
  const crown = ashenCrownAt(profile.ashenKing?.highestClearedTier ?? 0);
  return (
    <>
      <section className="panel stack">
        <div className="panel-title">Your classes</div>
        <div className="small muted">
          One character, two learned classes. Character Level is shared; each class has its own Class Mastery.
        </div>
      </section>
      <ClassCard profile={profile} classId={c.activeClassId} role="Active" queued={false} />
      <ClassCard profile={profile} classId={c.alternateClassId} role="Alternate" queued={queuedClass === c.alternateClassId} />
      {crown && (
        <section className="panel stack" aria-label="Artifact">
          <div className="row spread"><div className="panel-title">{ASHEN_CROWN.name}</div><span className="tag gold">Rank {crown.rank}</span></div>
          <div className="small muted">+{pct(crown.attackBp)} Attack for both classes.</div>
        </section>
      )}
    </>
  );
}

export function TechniqueList({ classId, rank, nextId }: { classId: string; rank: number; nextId: string | null }) {
  const techniques = techniqueStatuses(session.content, classId, rank);
  return (
    <div>
      {techniques.map(({ technique, unlocked }) => (
        <div
          key={technique.id}
          className={`technique ${unlocked ? "unlocked" : nextId === technique.id ? "next" : "locked"}`}
          data-technique={technique.id}
          data-state={unlocked ? "unlocked" : nextId === technique.id ? "next" : "locked"}
        >
          <span className="rank">M{technique.unlockRank}</span>
          <div>
            <div className="name" style={{ fontWeight: 700 }}>
              {technique.name}
            </div>
            <div className="small muted">{technique.description}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ClassCard({ profile, classId, role, queued }: { profile: Profile; classId: string; role: "Active" | "Alternate"; queued: boolean }) {
  const content = session.content;
  const cls = content.classDef(classId);
  const xp = profile.character.masteryXp[classId] ?? 0;
  const progress = masteryProgress(content, classId, xp);
  const rank = progress.level;
  const next = nextMilestone(content, classId, rank);
  const promotion = promotionCleared(profile, classId) ? content.promotions.get(classId) : undefined;
  return (
    <section
      className="panel class-card"
      data-class={classId}
      data-role={role}
      style={role === "Active" ? { borderColor: "rgba(124,200,98,0.5)" } : undefined}
    >
      <div className="class-head">
        <div className="class-art production-class-art">
          <SpriteImage name={cls.sprite} profile={profile} portrait />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row spread">
            <h2 style={{ fontSize: 20 }}>{cls.name}</h2>
            <span className={`tag ${role === "Active" ? "gold" : ""}`}>{role}</span>
          </div>
          <div className="small muted">{cls.tagline}</div>
          <div className="row small" style={{ marginTop: 4, color: "var(--green-bright)", fontWeight: 700 }}>
            Mastery {rank} / {progress.maxLevel}
          </div>
          <Bar value={progress.intoLevel} max={progress.levelSize || 1} kind="mastery" />
          <div className="small faint" style={{ marginTop: 2 }}>
            {progress.levelSize ? `${number(progress.intoLevel)} / ${number(progress.levelSize)} mastery XP` : "Mastery complete"}
          </div>
        </div>
      </div>
      <div className="chips">
        {cls.identity.map((t) => (
          <span key={t} className="tag">
            {t}
          </span>
        ))}
      </div>
      {next && (
        <div className="small">
          <span className="muted">Next technique at M{next.unlockRank}: </span>
          <b style={{ color: "var(--gold)" }}>{next.name}</b>
        </div>
      )}
      <TechniqueList classId={classId} rank={rank} nextId={next?.id ?? null} />
      {promotion && <div className="small gold">{promotion.name} promotion · +{pct(promotion.attackBp)} Attack</div>}
      <div className="small muted">{COMBAT_CUES[classId]} Techniques become available at the Mastery ranks shown above.</div>
      {role === "Alternate" && (
        <button
          className="btn block"
          disabled={queued}
          onClick={() => session.dispatch({ type: "setActiveClass", classId })}
        >
          {queued ? "Switch queued — after this fight" : `Make ${cls.name} active`}
        </button>
      )}
    </section>
  );
}
