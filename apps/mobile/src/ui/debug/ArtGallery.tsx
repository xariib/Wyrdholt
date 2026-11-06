import { useEffect, useRef, useState } from "react";
import { HEROES, ENEMIES, ZONES, VFX, SLOT_ICONS, asset, actorId, productionAssets } from "../../art/manifest";
import { SPRITES } from "../../render/pixelArt";
import { CombatRenderer, type ArtPreviewScene } from "../../render/CombatRenderer";
import type { Pose } from "../../art/types";
import { Sheet } from "../components/Common";
import { SpriteImage, ItemIcon } from "../components/icons";

export default function ArtGallery({ onClose }: { onClose: () => void }) {
  const [hero, setHero] = useState("warrior");
  const [enemy, setEnemy] = useState("spider");
  const [zone, setZone] = useState("darkwood");
  const [count, setCount] = useState(1);
  const [pose, setPose] = useState<Pose>("idle");
  const [effect, setEffect] = useState("none");
  const [timeMs, setTimeMs] = useState(60);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setTimeMs(t => (t + 100) % 3000), 100);
    return () => clearInterval(timer);
  }, [playing]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const host = useRef<HTMLDivElement>(null);
  const renderer = useRef<CombatRenderer | null>(null);
  const scene = useRef<ArtPreviewScene>({ hero, enemies: enemy === "mixed" ? ["wolf", "spider", "wolf"].slice(0, count) : Array<string>(count).fill(enemy), pose, effect, timeMs });
  scene.current = { hero, enemies: enemy === "mixed" ? ["wolf", "spider", "wolf"].slice(0, count) : Array<string>(count).fill(enemy), pose, effect, timeMs };
  useEffect(() => {
    let disposed = false;
    void CombatRenderer.create(host.current!, { background: "darkwood" }).then(r => {
      if (disposed) { r.destroy(); return; }
      renderer.current = r;
      (window as unknown as { __emberArtPreview?: CombatRenderer }).__emberArtPreview = r;
      r.renderPreview(scene.current);
      setReady(true);
    }).catch(e => { if (!disposed) setError(String(e)); });
    return () => { disposed = true; renderer.current?.destroy(); renderer.current = null; delete (window as unknown as { __emberArtPreview?: CombatRenderer }).__emberArtPreview; };
  }, []);
  useEffect(() => {
    renderer.current?.setBackground(zone);
    renderer.current?.renderPreview(scene.current);
  }, [hero, enemy, zone, count, pose, effect, ready, timeMs]);
  const definition = asset(actorId(hero));
  const width = definition?.width ?? SPRITES[hero]!.rows[0]!.length;
  const height = definition?.height ?? SPRITES[hero]!.rows.length;
  const selectStyle = { minHeight: 44, width: "100%", maxWidth: "100%" };
  return <Sheet onClose={onClose} label="Art Preview"><div className="art-gallery stack">
    <div className="row spread"><h2>Art Preview</h2><button className="btn" onClick={onClose}>×</button></div>
    <p className="small muted">DEV · presentation only · {productionAssets.length} approved assets. Darkwood v1 production art; other content retains placeholders. Preview time: {timeMs} ms.</p>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
      <label>Character<select aria-label="Art character" style={selectStyle} value={hero} onChange={e => setHero(e.target.value)}>{HEROES.map(n => <option key={n}>{n}</option>)}</select></label>
      <label>Enemy<select aria-label="Art enemy" style={selectStyle} value={enemy} onChange={e => setEnemy(e.target.value)}>{[...ENEMIES, "mixed"].map(n => <option key={n}>{n}</option>)}</select></label>
      <label>Zone<select aria-label="Art zone" style={selectStyle} value={zone} onChange={e => setZone(e.target.value)}>{ZONES.map(n => <option key={n}>{n}</option>)}</select></label>
      <label>Enemies<select aria-label="Art count" style={selectStyle} value={count} onChange={e => setCount(Number(e.target.value))}>{[1, 2, 3].map(n => <option key={n}>{n}</option>)}</select></label>
      <label>Pose<select aria-label="Art pose" style={selectStyle} value={pose} onChange={e => setPose(e.target.value as Pose)}>{["idle", "attack", "hit", "death"].map(n => <option key={n}>{n}</option>)}</select></label>
      <label>VFX<select aria-label="Art effect" style={selectStyle} value={effect} onChange={e => setEffect(e.target.value)}>{["none", ...VFX].map(n => <option key={n}>{n}</option>)}</select></label>
    </div>
    <label>Animation time<input aria-label="Art animation time" type="range" min={0} max={3000} step={10} value={timeMs} onChange={e => setTimeMs(Number(e.target.value))}/></label>
    <button className="btn" onClick={() => setPlaying(!playing)}>{playing ? "Freeze preview" : "Play preview"}</button>
    <h3>Adventure scale</h3>
    <div className="combat-host" data-art-ready={ready} ref={host} style={{ position: "relative", inset: "auto", flexShrink: 0, height: 544, width: "100%", overflow: "hidden" }} />
    {error && <p role="alert">{error}</p>}
    <h3>Native pixels · {width} × {height}</h3>
    <div data-art-native style={{ width, height }}><SpriteImage name={hero} className="art-native" /></div>
    <h3>Gear scale · base class silhouette</h3>
    <div data-art-gear style={{ position: "relative", height: 270 }}><div className="loadout-hero"><SpriteImage name={hero} portrait/></div></div>
    <h3>Equipment icons</h3>
    <div data-art-icons style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{Object.entries(SLOT_ICONS).map(([slot, icon]) => <div key={slot}><ItemIcon icon={icon} rarityColor="#b28de0"/><div className="small">{slot}</div></div>)}</div>
    <style>{".art-native{width:100%;height:100%;object-fit:contain}.art-gallery select{font:inherit;background:#17202c;color:#eee;border:1px solid #526078}"}</style>
  </div></Sheet>;
}
