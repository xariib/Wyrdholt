import { useEffect, useRef, type ReactNode } from "react";
import { registerBackAction } from "../../platform/backNavigation";
import { session, type Toast } from "../../game/session";
import { curveProgress, masteryRank, type Profile } from "@emberbound/game-core";
import { SpriteImage } from "./icons";
import { compactNumber, number } from "../format";

export function Bar({ value, max, kind }: { value: number; max: number; kind?: "mastery" | "hp" }) {
  const width = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 100;
  return (
    <div className={`bar ${kind ?? ""}`}>
      <span style={{ width: `${width}%` }} />
    </div>
  );
}

export function Header({ profile, onDebug }: { profile: Profile; onDebug?: () => void }) {
  const content = session.content;
  const c = profile.character;
  const progress = curveProgress(content.levelTotals, c.xp);
  const cls = content.classDef(c.activeClassId);
  return (
    <header className="header">
      <div className="portrait">
        <SpriteImage name={cls.sprite} profile={profile} />
      </div>
      <div className="header-main">
        <div className="header-brand"><img src="./brand/A3_native.png" width="103" height="42" alt="Wyrdholt: Idle" /></div><div className="header-name">{c.name}</div>
        <div className="header-sub">
          <b>Lv. {c.level}</b> · {cls.name} <span data-testid="header-mastery">M{masteryRank(content, cls.id, c.masteryXp[cls.id] ?? 0)}</span>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <div style={{ flex: 1 }}>
            <Bar value={progress.intoLevel} max={progress.levelSize || 1} />
          </div>
          <span className="small faint" style={{ fontVariantNumeric: "tabular-nums" }}>
            {progress.levelSize ? `${number(progress.intoLevel)} / ${number(progress.levelSize)} XP` : "MAX"}
          </span>
        </div>
      </div>
      <div className="gold-chip" title={`${number(profile.gold)} gold`} aria-label={`${number(profile.gold)} gold`}>
        <span className="coin" />
        {compactNumber(profile.gold)}
      </div>
      {onDebug && (
        <button className="icon-btn" onClick={onDebug} aria-label="Developer tools">
          DEV
        </button>
      )}
    </header>
  );
}

export function Sheet({ children, onClose, label = "Dialog", scrollKey }: { children: ReactNode; onClose: () => void; label?: string; scrollKey?: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const start = useRef<number | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => { if (ref.current) ref.current.scrollTop = 0; }, [scrollKey]);
  useEffect(() => registerBackAction(() => { close.current(); return true; }, 10), []);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const screens = Array.from(document.querySelectorAll<HTMLElement>(".screen"));
    const saved = screens.map(el => el.style.overflowY);
    screens.forEach(el => { el.style.overflowY = "hidden"; });
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      screens.forEach((el, i) => { el.style.overflowY = saved[i] ?? ""; });
      previous?.focus();
    };
  }, []);

  return (
    <div className="scrim" onClick={onClose}>
      <div
        className="sheet"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key === "Escape") close.current();
          if (e.key !== "Tab") return;
          const nodes = Array.from(ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]',
          ) ?? []).filter(el => el.getClientRects().length > 0);
          const first = nodes[0], last = nodes[nodes.length - 1];
          if (first && last) {
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
          }
        }}
      >
        {/* Only this handle owns a drag. Content retains native vertical scrolling. */}
        <div
          className="sheet-drag"
          aria-label="Swipe down to close"
          onPointerDown={e => { start.current = e.clientY; e.currentTarget.setPointerCapture(e.pointerId); }}
          onPointerUp={e => {
            if (start.current !== null && e.clientY - start.current > 60) close.current();
            start.current = null;
          }}
          onPointerCancel={() => { start.current = null; }}
        ><div className="sheet-grip" /></div>
        {children}
      </div>
    </div>
  );
}

export function Modal({ children, onClose }: { children: ReactNode; onClose?: () => void }) {
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => registerBackAction(() => { close.current?.(); return true; }, 10), []);
  return (
    <div className="scrim center" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function ToastView({ toast }: { toast: Toast | null }) {
  useEffect(() => {
    if (!toast) return;
    const id = toast.id;
    const timer = setTimeout(() => session.clearToast(id), 2600);
    return () => clearTimeout(timer);
  }, [toast]);
  if (!toast) return null;
  return (
    <div key={toast.id} className={`toast ${toast.tone}`} role="status">
      {toast.text}
    </div>
  );
}

export function Busy({ text }: { text: string }) {
  useEffect(() => registerBackAction(() => true, 20), []);
  return (
    <div className="scrim center" style={{ zIndex: 70 }}>
      <div className="modal" style={{ alignItems: "center", textAlign: "center" }}>
        <div className="spinner" />
        <div>{text}</div>
      </div>
    </div>
  );
}
