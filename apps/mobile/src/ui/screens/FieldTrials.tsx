import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  FIELD_TACTICS, FIELD_TRIAL_LEVEL, FIELD_TRIAL_MASTERY, FIELD_TRIAL_ROTATION_MS, FIELD_TRIAL_ZONE, FIELD_TRIALS,
  featuredFieldTrial, runFieldTrial, type FieldTactic, type FieldTrial, type Profile,
} from "@emberbound/game-core";
import { session, type FrameListener } from "../../game/session";
import { CombatView } from "../components/CombatView";
import { duration, pct } from "../format";

type TrialResult = ReturnType<typeof runFieldTrial>;
type Goals = TrialResult["goals"];
type TrialJournal = Partial<Record<FieldTrial["id"], Goals>>;
type Attempt = { trial: FieldTrial; classId: string; tactic: FieldTactic; result: TrialResult };

function readJournal(key: string): TrialJournal {
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? "null") as TrialJournal | null;
    const journal: TrialJournal = {};
    for (const { id } of FIELD_TRIALS) {
      const goals = stored?.[id];
      if (goals?.cleared === true) {
        journal[id] = { cleared: true, timeGoal: goals.timeGoal === true, healthGoal: goals.healthGoal === true };
      }
    }
    return journal;
  } catch {
    return {};
  }
}

function starCount(goals: Goals | undefined): number {
  return goals ? Number(goals.cleared) + Number(goals.timeGoal) + Number(goals.healthGoal) : 0;
}

function seconds(ms: number): string {
  return `${Math.ceil(ms / 100) / 10}s`;
}

export function FieldTrialsScreen({ profile, onBack }: { profile: Profile; onBack: () => void }) {
  const key = `wyrdholt.field-trials.v1.${profile.masterSeed}.${profile.createdAtWallMs}`;
  const content = session.content;
  const { activeClassId, alternateClassId } = profile.character;
  const [journal, setJournal] = useState(() => readJournal(key));
  const [now, setNow] = useState(Date.now);
  const featured = featuredFieldTrial(now);
  const [chosenTrial, setChosenTrial] = useState<FieldTrial>();
  const trial = chosenTrial ?? featured;
  const [classId, setClassId] = useState(activeClassId);
  const [tactic, setTactic] = useState<FieldTactic>("assault");
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    const refresh = () => setNow(Date.now());
    const timer = window.setInterval(refresh, 15_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  useEffect(() => {
    if (!Object.keys(journal).length) return;
    try {
      localStorage.setItem(key, JSON.stringify(journal));
    } catch {
      // Trials still work if device preferences cannot be saved.
    }
  }, [journal, key]);

  const finish = useCallback((played: Attempt) => {
    setFinished(true);
    const { id } = played.trial;
    const goals = played.result.goals;
    if (!goals.cleared) return;
    setJournal(previous => ({
      ...previous,
      [id]: {
        cleared: true,
        timeGoal: goals.timeGoal || previous[id]?.timeGoal === true,
        healthGoal: goals.healthGoal || previous[id]?.healthGoal === true,
      },
    }));
  }, []);

  const total = FIELD_TRIALS.reduce((sum, { id }) => sum + starCount(journal[id]), 0);
  const earned = journal[trial.id];
  const zone = content.zone(FIELD_TRIAL_ZONE);
  const opponentNames = zone.stages[trial.stageIndex]!.enemies.map(id => content.enemy(id).name);

  return (
    <>
      <section className="panel stack" aria-label="Field Trials">
        <div className="row spread">
          <h2>Field Trials</h2>
          <span className="tag gold">{total} / {FIELD_TRIALS.length * 3} stars</span>
        </div>
        <p className="small muted">Choose a class and tactic for one fight. Adventure continues in the background.</p>
        <button className="btn small block" onClick={onBack}>Back to Adventure</button>
      </section>

      {attempt ? (
        <TrialPlayback
          attempt={attempt}
          finished={finished}
          onFinish={finish}
          onReturn={() => { setChosenTrial(attempt.trial); setAttempt(null); }}
        />
      ) : (
        <>
          <section className="panel stack" aria-label="Choose a trial">
            <div className="row spread">
              <div className="panel-title">Featured · {featured.name}</div>
              <span className="tag">Changes in {duration(FIELD_TRIAL_ROTATION_MS - now % FIELD_TRIAL_ROTATION_MS)}</span>
            </div>
            <label className="small" htmlFor="field-trial">Trial</label>
            <select id="field-trial" className="text-input" value={trial.id} onChange={event => {
              setChosenTrial(FIELD_TRIALS.find(candidate => candidate.id === event.target.value));
            }}>
              {FIELD_TRIALS.map(option => <option key={option.id} value={option.id}>{option.name} · {starCount(journal[option.id])}/3 stars</option>)}
            </select>
            <p className="small muted">{opponentNames.join(" · ")}</p>
            <ul className="field-goals list">
              <Goal met={earned?.cleared}>Win the fight</Goal>
              <Goal met={earned?.timeGoal}>Win within {seconds(trial.timeMs)}</Goal>
              <Goal met={earned?.healthGoal}>Win with {pct(trial.healthBp)} HP or more</Goal>
            </ul>
            <p className="small muted">Stars carry across attempts. Every trial stays open.</p>
          </section>

          <section className="panel stack" aria-label="Prepare for trial">
            <div className="panel-title">Choose a class</div>
            <p className="small muted">Trial builds use level {FIELD_TRIAL_LEVEL} and Mastery {FIELD_TRIAL_MASTERY}. Your stars are recorded on this device.</p>
            <div className="field-classes" role="group" aria-label="Trial class">
              {[activeClassId, alternateClassId].map(id => (
                <button key={id} className={`btn${classId === id ? " primary" : ""}`} aria-pressed={classId === id} onClick={() => setClassId(id)}>
                  {content.classDef(id).name}
                </button>
              ))}
            </div>
            <div className="panel-title">Choose a tactic</div>
            <div className="stack" role="group" aria-label="Trial tactic">
              {FIELD_TACTICS.map(option => (
                <button key={option.id} className={`btn field-tactic${tactic === option.id ? " primary" : ""}`} aria-pressed={tactic === option.id}
                  onClick={() => setTactic(option.id)}>
                  <b>{option.name}</b><span className="small">{option.description}</span>
                </button>
              ))}
            </div>
            <button className="btn gold block" onClick={() => {
              setFinished(false);
              setAttempt({ trial, classId, tactic, result: runFieldTrial(content, trial, classId, tactic) });
            }}>Start trial</button>
          </section>
        </>
      )}
    </>
  );
}

function Goal({ met, children }: { met?: boolean | undefined; children: ReactNode }) {
  return <li className={met ? "field-goal-earned" : "muted"}><span aria-label={met ? "Earned" : "Open"}>{met ? "★" : "☆"}</span> {children}</li>;
}

function TrialPlayback({ attempt, finished, onFinish, onReturn }: {
  attempt: Attempt;
  finished: boolean;
  onFinish: (attempt: Attempt) => void;
  onReturn: () => void;
}) {
  const start = useRef<number | null>(null);
  const done = useRef(false);
  const battle = useRef<HTMLElement>(null);
  const results = useRef<HTMLElement>(null);
  const { trial, classId, tactic, result } = attempt;

  useEffect(() => {
    (finished ? results : battle).current?.scrollIntoView({ block: "nearest" });
  }, [finished]);

  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    onFinish(attempt);
  }, [attempt, onFinish]);

  const subscribe = useCallback((listener: FrameListener) => {
    let raf = 0;
    let frameId = 0;
    const fight = { ...result, key: trial.id, record: { startHp100: null } };
    const draw = (now: number) => {
      start.current ??= now;
      const totalMs = result.summary.durationMs;
      const elapsedMs = done.current ? totalMs : Math.min(totalMs, (now - start.current) * 2);
      listener({ activity: "idle", run: null, fight, lastFight: null, elapsedMs,
        heroMaxHp100: result.hero.maxHp100, carriedHp100: null, frameId: ++frameId });
      if (elapsedMs >= totalMs) finish();
      else raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [finish, result, trial.id]);

  const hpBp = Math.floor(result.summary.hero.hp100 * 10_000 / result.summary.hero.maxHp100);
  return (
    <>
      <section ref={battle} className="panel stack" aria-label={`${trial.name} fight`}>
        <div className="row spread"><h2>{trial.name}</h2><span className="tag">{FIELD_TACTICS.find(option => option.id === tactic)?.name}</span></div>
        <div className="combat-frame field-combat">
          <CombatView active heroSprite={session.content.classDef(classId).sprite} background={result.setup.zone.background} subscribe={subscribe} />
        </div>
        {!finished && <button className="btn block" onClick={finish}>Skip to result</button>}
      </section>
      {finished && (
        <section ref={results} className="panel stack" aria-label="Trial result">
          <div className="row spread" role="status">
            <h2>{result.goals.cleared ? "Trial won" : "Trial lost"}</h2>
            <span className="tag gold">{starCount(result.goals)} / 3 this attempt</span>
          </div>
          <ul className="field-goals list">
            <Goal met={result.goals.cleared}>Win the fight</Goal>
            <Goal met={result.goals.timeGoal}>{`Time ${seconds(result.summary.durationMs)} · target ${seconds(trial.timeMs)}`}</Goal>
            <Goal met={result.goals.healthGoal}>{`HP left ${Math.floor(hpBp / 100)}% · target ${pct(trial.healthBp)}`}</Goal>
          </ul>
          <button className="btn primary block" onClick={onReturn}>Change tactic or trial</button>
        </section>
      )}
    </>
  );
}
