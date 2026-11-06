import { useEffect, useRef, useState } from "react";
import { session } from "../../game/session";
import { useUi } from "../hooks";
import { SpriteImage } from "../components/icons";
import { actionFailureText } from "./SaveRecovery";

export function CreateCharacterScreen() {
  const content = session.content;
  const classes = content.snapshot.classes.filter((c) => c.tier === 1);
  const [name, setName] = useState("Adventurer");
  const [active, setActive] = useState("monk");
  const [alternate, setAlternate] = useState("mage");
  const [error, setError] = useState<string | null>(null);
  const ui = useUi(), notice = ui.notice;
  const [pending, setPending] = useState(false);
  const working = useRef(false), mounted = useRef(true), status = useRef<HTMLDivElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (error || pending) status.current?.focus(); }, [error, pending]);
  const create = async () => {
    if (working.current || !session.getSnapshot().save.gate.canCreate) return;
    working.current = true; setPending(true); setError(null);
    try {
      const result = await session.createCharacter(name, active, alternate);
      if (mounted.current && result.status !== "created") setError(actionFailureText(result));
    } catch {
      if (mounted.current) setError("Your character could not be created. Check the saved adventure before trying again.");
    } finally { working.current = false; if (mounted.current) setPending(false); }
  };

  const choose = (id: string) => {
    if (id === active) return;
    if (id === alternate) {
      setAlternate(active);
      setActive(id);
      return;
    }
    setAlternate(active);
    setActive(id);
  };

  return (
    <div className="create" aria-busy={pending}>
      <div className="logo">
        <h1 className="brand-title"><img className="brand-wordmark" src="./brand/A3_2x.png" width="206" height="84" alt="Wyrdholt: Idle" /></h1>
        <div className="small muted" style={{ letterSpacing: "0.18em" }}>
          TECHNICAL TEST BUILD
        </div>
        {notice && (
          <div className="panel small" style={{ marginTop: 12, textAlign: "left", borderColor: "rgba(234,122,59,0.5)" }}>
            {notice}
          </div>
        )}
      </div>
      <section className="panel stack">
        <label className="small muted" htmlFor="hero-name">
          Character name
        </label>
        <input
          id="hero-name"
          className="text-input"
          value={name}
          maxLength={16}
          autoComplete="off"
          disabled={pending}
          onChange={(e) => setName(e.target.value)}
        />
      </section>
      <section className="panel stack">
        <div className="panel-title">Choose your two classes</div>
        <div className="small muted">
          Tap a class to make it Active; the other becomes your Alternate. Both stay equal options and can be swapped later.
        </div>
        <div className="class-pick">
          {classes.map((c) => {
            const role = c.id === active ? "active" : c.id === alternate ? "alt" : "";
            return (
              <button key={c.id} className={`class-option ${role}`} disabled={pending || !c.implemented} onClick={() => choose(c.id)}>
                <span className="class-art">
                  <SpriteImage name={c.sprite} />
                </span>
                <b style={{ fontFamily: "var(--font-display)" }}>{c.name}</b>
                <span className="small muted">{c.implemented ? c.identity.join(" · ") : "Later build"}</span>
                {role && <span className={`tag ${role === "active" ? "gold" : "queued"}`}>{role === "active" ? "Active" : "Alternate"}</span>}
              </button>
            );
          })}
        </div>
      </section>
      <div ref={status} tabIndex={-1} role={error ? "alert" : "status"} className="small" style={{ color: error ? "#ff8a80" : undefined }}>{pending ? "Creating your character…" : error}</div>
      <button
        className="btn primary block"
        disabled={pending || !ui.save.gate.canCreate}
        onClick={() => void create()}
      >
        Begin in Greenfields
      </button>
    </div>
  );
}
