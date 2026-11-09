import { useEffect, useMemo, useState } from "react";
import { spriteDataUrl, spriteCanvas } from "../../render/pixelArt";


import { actorPack, productionUrl } from "../../art/darkwood";
import { ICONS } from "../../art/placeholderIcons";
import { asset, actorId } from "../../art/manifest";
import { ArtScope, frameCanvas } from "../../art/load";
import type { ArtId } from "../../art/types";

const cache = new Map<string, string>();

function iconUrl(name: string): string {
  let url = cache.get(name);
  if (url === undefined) {
    const def = ICONS[name] ?? ICONS.blade!;
    url = spriteCanvas(def).toDataURL();
    cache.set(name, url);
  }
  return url;
}

export function spriteUrl(name: string, scale = 4): string {
  const key = `sprite:${name}:${scale}`;
  let url = cache.get(key);
  if (url === undefined) {
    url = spriteDataUrl(name, scale);
    cache.set(key, url);
  }
  return url;
}

function useArt(id: ArtId, fallback: string): string {
  const [loaded, setLoaded] = useState<{ id: ArtId; url: string } | null>(null);
  useEffect(() => {
    const a = asset(id);
    if (!a) return;
    const scope = new ArtScope();
    let active = true;
    void scope.load(a).then(image => {
      if (active) setLoaded({ id, url: frameCanvas(a, image, a.clips.idle.frames[0]!).toDataURL() });
    }).catch(() => { /* Safe placeholder; art never blocks interaction. */ });
    return () => { active = false; scope.dispose(); };
  }, [id]);
  return loaded?.id === id ? loaded.url : fallback;
}

export function ItemIcon({ icon, rarityColor, size = 44 }: { icon: string; rarityColor: string; size?: number }) {
  const fallback = useMemo(() => iconUrl(icon), [icon]);
  const src = useArt(`icons/${icon}`, fallback);
  return (
    <span className="item-icon" style={{ borderColor: rarityColor, width: size, height: size }}>
      <img className="pixelated" src={src} alt="" draggable={false} style={{ width: size * 0.68, height: size * 0.68 }} />
    </span>
  );
}

export function SpriteImage({ name, className, portrait = false }: { name: string; className?: string; portrait?: boolean }) {
  const fallback = useMemo(() => spriteUrl(name, 4), [name]);
  const src = useArt(actorId(name), fallback);
  if (portrait && actorPack[name]) {
    const clip = actorPack[name]!.animations.idle;
    return <span className="production-portrait" data-actor={name} data-logical-height="48" data-visual-height={clip.frame[1]}><img className="pixelated" src={productionUrl(clip.frames[0]!.file)} onError={e => { e.currentTarget.onerror = null; e.currentTarget.src = src; }} alt={name} draggable={false} style={{ width: clip.frame[0]! * 3, height: clip.frame[1]! * 3 }}/></span>;
  }
  return <img className={`pixelated ${className ?? ""}`} src={src} alt="" draggable={false} />;
}

export function NavIcon({ name }: { name: "adventure" | "character" | "gear" | "challenges" | "menu" | "book" }) {
  switch (name) {
    case "adventure":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" />
          <path d="M15.5 8.5 13.5 13.5 8.5 15.5 10.5 10.5z" fill="currentColor" stroke="none" />
        </svg>
      );
    case "character":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="7.5" r="4" />
          <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8z" />
        </svg>
      );
    case "gear":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M9 3h6a2 2 0 0 1 2 2v1h1a3 3 0 0 1 3 3v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a3 3 0 0 1 3-3h1V5a2 2 0 0 1 2-2zm0 3h6V5H9zm-3 6v2h12v-2z" />
        </svg>
      );
    case "challenges":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M3 8l4.5 3.5L12 4l4.5 7.5L21 8l-2 10H5z" />
          <rect x="5" y="19" width="14" height="2" rx="1" />
        </svg>
      );
    case "menu":
      return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
        <path d="M9 6h11M9 12h11M9 18h11" />
        <path fill="currentColor" stroke="none" d="m5 4-2 2 2 2 2-2zm0 6-2 2 2 2 2-2zm0 6-2 2 2 2 2-2z" />
      </svg>;
    case "book":
      return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 6c-3-2-6-2.5-10-1v14c4-1.5 7-1 10 1 3-2 6-2.5 10-1V5c-4-1.5-7-1-10 1zm0 0v14M5 9l4 1m6 0 4-1" />
      </svg>;
  }
}

export function PushIcon() {
  return (
    <svg className="activity-icon" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <path d="M6 26 20 12M20 12l2-6 4-2-2 4-6 2M8 18l6 6M26 26 12 12M12 12 10 6 6 4l2 4 6 2M24 18l-6 6" />
    </svg>
  );
}

export function FarmIcon() {
  return (
    <svg className="activity-icon" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <path d="M16 28V14M16 16c-6 0-9-4-9-9 6 0 9 4 9 9zM16 18c0-6 4-9 9-9 0 6-4 9-9 9z" />
    </svg>
  );
}
