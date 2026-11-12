import { useEffect, useRef, useState } from "react";
import { session } from "../../game/session";
import type { CombatRenderer } from "../../render/CombatRenderer";
import { perfMonitor } from "../../platform/perfMonitor";
import { equippedAppearance, GEAR_SLOTS } from "../../art/gearSkins";

/**
 * PixiJS (about 230 KB) is loaded on demand, after the first screen is interactive,
 * instead of being parsed at startup (device finding F6: slow cold start on the A40).
 * The module promise is shared, so remounts and context-loss rebuilds load it once.
 */
class DisposedError extends Error {}

let rendererModule: Promise<typeof import("../../render/CombatRenderer")> | null = null;
function loadRendererModule() {
  rendererModule ??= import("../../render/CombatRenderer").catch((error: unknown) => {
    rendererModule = null; // allow Retry after a failed chunk load
    throw error;
  });
  return rendererModule;
}

/**
 * Hosts the PixiJS canvas. React never drives the combat loop: the renderer
 * subscribes to session frames directly. The renderer is disposable — it is
 * recreated after a WebGL context loss or a failed start.
 */
export function CombatView({ active, heroSprite, background }: { active: boolean; heroSprite: string; background: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const vitalsRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<CombatRenderer | null>(null);
  const [generation, setGeneration] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);
  // Latest props, applied when an (asynchronously created) renderer becomes ready.
  const activeRef = useRef(active);
  const heroRef = useRef(heroSprite);
  const backgroundRef = useRef(background);
  activeRef.current = active;
  heroRef.current = heroSprite;
  backgroundRef.current = background;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    session.ready
      .then(() => loadRendererModule())
      .then(({ CombatRenderer }) => (disposed ? Promise.reject(new DisposedError()) : CombatRenderer.create(host, { background: backgroundRef.current })))
      .then((renderer) => {
        if (disposed) {
          renderer.destroy();
          return;
        }
        rendererRef.current = renderer;
        renderer.setVisible(activeRef.current);
        renderer.setHeroSprite(heroRef.current);
        renderer.setBackground(backgroundRef.current);
        perfMonitor.mark("combatDrawn");
        (window as unknown as { __emberRenderer?: CombatRenderer }).__emberRenderer = renderer;
        renderer.onContextLost = () => {
          // Rebuild the whole renderer; the simulation is unaffected.
          setTimeout(() => setGeneration((g) => g + 1), 250);
        };
        const hud = vitalsRef.current;
        const label = hud?.querySelector<HTMLElement>(".vitals-label");
        const fill = hud?.querySelector<HTMLElement>(".vitals-fill");
        const ward = hud?.querySelector<HTMLElement>(".vitals-ward");
        let lastText = "", lastWidth = "", lastWard = "";
        let appearanceKey = "";
        let appearanceProfile = session.getSnapshot().profile;
        unsubscribe = session.onFrame((frame) => {
          const profile = session.getSnapshot().profile;
          if (profile) {
            // The current fight owns its build. A queued equip must not change its skin.
            const build = frame.fight?.record.build;
            const equipment = build?.equipment ?? profile.equipment;
            const classId = build?.classId ?? profile.character.activeClassId;
            const key = `${classId}:${GEAR_SLOTS.map(s => equipment[s] ?? "-").join("|")}`;
            // A restored profile can reuse instance IDs for different gear.
            if (profile !== appearanceProfile || key !== appearanceKey) {
              renderer.setHeroAppearance(equippedAppearance(profile, session.content, equipment, classId));
              appearanceKey = key;
              appearanceProfile = profile;
            }
          }
          renderer.onFrame(frame);
          if (!activeRef.current) return;
          const vitals = renderer.heroVitals();
          if (!hud || !vitals) return;
          const text = `${Math.ceil(vitals.hp100 / 100)} / ${Math.ceil(vitals.max100 / 100)} HP`;
          if (label && lastText !== text) label.textContent = lastText = text;
          const width = `${Math.max(0, Math.min(100, vitals.hp100 / Math.max(1, vitals.max100) * 100))}%`;
          if (fill && lastWidth !== width) fill.style.width = lastWidth = width;
          if (ward) {
            const hidden = vitals.wardCap100 === 0;
            if (ward.hidden !== hidden) ward.hidden = hidden;
            const text = `Ward ${Math.ceil(vitals.ward100 / 100)} / ${Math.ceil(vitals.wardCap100 / 100)}`;
            if (lastWard !== text) ward.textContent = lastWard = text;
          }
        });
        setFailed(null);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DisposedError)) setFailed(String(error));
      });
    return () => {
      disposed = true;
      unsubscribe?.();
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
  }, [generation]);

  useEffect(() => {
    rendererRef.current?.setVisible(active);
  }, [active, generation]);

  useEffect(() => {
    rendererRef.current?.setHeroSprite(heroSprite);
  }, [heroSprite, generation]);

  useEffect(() => {
    rendererRef.current?.setBackground(background);
  }, [background, generation]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && rendererRef.current?.isContextLost) {
        setGeneration((g) => g + 1);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  return (
    <><div className="combat-host" ref={hostRef}>
      {failed && (
        <div className="small muted" style={{ padding: 12 }}>
          Combat view unavailable: {failed}
          <br />
          <button className="btn small" onClick={() => setGeneration((g) => g + 1)}>
            Retry
          </button>
        </div>
      )}
    </div><div className="combat-vitals" ref={vitalsRef}><span className="vitals-label">HP</span><span className="vitals-track"><i className="vitals-fill"/></span><span className="vitals-ward" hidden title="Arcane Ward absorbs damage before health. Blue shield numbers show ward gained."/></div></>
  );
}
