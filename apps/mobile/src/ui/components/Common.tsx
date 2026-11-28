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
            <Bar value={progress.intoLevel} max={progress.levelSize} />
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

const openDialogs: HTMLDivElement[] = [];
const tabStops = 'button:enabled, input:enabled, textarea:enabled, select:enabled, summary, a[href], [tabindex="0"]';

function useDialog(onClose?: () => void, priority = 10) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    openDialogs.push(dialog);
    const app = dialog.closest(".app");
    app?.classList.add("dialog-open");
    dialog.focus({ preventScroll: true });
    const unregister = registerBackAction(() => { close.current?.(); return true; }, priority);
    const onFocus = (event: FocusEvent) => {
      if (openDialogs.at(-1) === dialog && event.target instanceof Node && !dialog.contains(event.target)) {
        dialog.focus({ preventScroll: true });
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (openDialogs.at(-1) !== dialog) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close.current?.();
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = Array.from(dialog.querySelectorAll<HTMLElement>(tabStops)).filter(el => el.getClientRects().length);
      const edge = event.shiftKey ? nodes[0] : nodes.at(-1);
      if (document.activeElement === edge || document.activeElement === dialog || !dialog.contains(document.activeElement)) {
        event.preventDefault();
        ((event.shiftKey ? nodes.at(-1) : nodes[0]) ?? dialog).focus();
      }
    };
    document.addEventListener("focusin", onFocus);
    document.addEventListener("keydown", onKey);
    return () => {
      const top = openDialogs.at(-1) === dialog;
      openDialogs.splice(openDialogs.indexOf(dialog), 1);
      if (!openDialogs.length) app?.classList.remove("dialog-open");
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocus);
      unregister();
      if (top) {
        const parent = openDialogs.at(-1);
        const target = previous?.isConnected && (!parent || parent.contains(previous)) ? previous : parent;
        target?.focus({ preventScroll: true });
      }
    };
  }, [priority]);
  return ref;
}

export function Sheet({ children, onClose, label = "Dialog", scrollKey }: { children: ReactNode; onClose: () => void; label?: string; scrollKey?: string | null }) {
  const ref = useDialog(onClose);
  const start = useRef<number | null>(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = 0; }, [scrollKey]);

  return (
    <div className="scrim" onClick={onClose}>
      <div
        className="sheet"
        ref={ref}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-label={label}
        onClick={e => e.stopPropagation()}
      >
        {/* Only this handle owns a drag. Content retains native vertical scrolling. */}
        <div
          className="sheet-drag"
          aria-label="Swipe down to close"
          onPointerDown={e => { start.current = e.clientY; e.currentTarget.setPointerCapture(e.pointerId); }}
          onPointerUp={e => {
            if (start.current !== null && e.clientY - start.current > 60) onClose();
            start.current = null;
          }}
          onPointerCancel={() => { start.current = null; }}
        ><div className="sheet-grip" /></div>
        {children}
      </div>
    </div>
  );
}

/** Put paging before long lists so the next page never requires a scroll to the end. */
export function MenuPages({ page, pages, onChange, noun = "items" }: {
  page: number; pages: number; onChange: (page: number) => void; noun?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const previous = useRef(page);
  useEffect(() => {
    if (previous.current !== page) ref.current?.scrollIntoView({ block: "start" });
    previous.current = page;
  }, [page]);
  if (pages <= 1) return null;
  return <nav className="menu-pages" ref={ref} aria-label={`${noun} pages`}>
    <button className="btn" disabled={page === 0} onClick={() => onChange(page - 1)}>Previous {noun}</button>
    <span className="small" role="status">{page + 1} / {pages}</span>
    <button className="btn" disabled={page + 1 >= pages} onClick={() => onChange(page + 1)}>Next {noun}</button>
  </nav>;
}

export function Modal({ children, onClose, label }: { children: ReactNode; onClose?: () => void; label: string }) {
  const ref = useDialog(onClose);
  return (
    <div className="scrim center" onClick={onClose}>
      <div className="modal" ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>
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
  const ref = useDialog(undefined, 20);
  return (
    <div className="scrim center" style={{ zIndex: 70 }}>
      <div className="modal" ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={text} style={{ alignItems: "center", textAlign: "center" }}>
        <div className="spinner" />
        <div>{text}</div>
      </div>
    </div>
  );
}
