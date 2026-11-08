// Pixi without eval/new Function: works under strict Content-Security-Policies
// (the private browser preview host) and keeps browser and app builds identical.
import "pixi.js/unsafe-eval";
import { Application, Container, Graphics, Sprite, Texture, TextureSource } from "pixi.js";
import type { CombatEvent } from "@emberbound/shared-types";
import type { CombatFrame } from "../game/session";
import { actorPack, attackDurations, fxPack, productionActorId, sequenceIndex } from "../art/darkwood";
import { ProductionMotion } from "./productionMotion";
import { EnvironmentArt } from "./environmentArt";
import { drawBackground, groundY } from "./background";
import { GLYPHS, glyphCanvas } from "./pixelArt";
import { animationFrame, ART_BUDGET, type Pose } from "../art/types";
import { TextureBank, type SpriteTextures } from "./textures";

/**
 * PixiJS combat presentation.
 *
 * - Reads CombatFrames from the session and plays the fight's authoritative
 *   event log up to the frame's playback time. It never computes outcomes.
 * - Renders at a low logical resolution with an integer device-pixel scale,
 *   nearest-neighbour sampling and pixel-snapped positions.
 * - Uses one render call per session frame (no separate Pixi ticker).
 * - Can be destroyed and recreated at any time (tab switches, WebGL context loss).
 */

TextureSource.defaultOptions.scaleMode = "nearest";

const COLORS = {
  heroHit: "#f4f1e8",
  crit: "#ffd24a",
  classProc: "#9fd8ff",
  magicProc: "#c9a2ff",
  itemProc: "#9be07a",
  taken: "#ff6b5a",
  heal: "#7ee07a",
  ward: "#8fd0ff",
  burn: "#ff9a3a",
  ember_burn: "#ffbe63",
  poison: "#a6e05a",
  bleed: "#e8505a",
};
const PIP_COLORS: Record<string, number> = {
  burn: 0xff8a3a,
  ember_burn: 0xffbe63,
  poison: 0x9fe05a,
  bleed: 0xd8404a,
  flow: 0x7fd4ff,
  wraps_flow: 0xb0f0ff,
};
const FAST_FORWARD_MS = 450;
/** Travel time of approved projectiles (arcane bolt, arrow, venom glob). Presentation only. */
const PROJECTILE_MS = 160;
/** How far ahead the renderer looks for attacks to wind up. Longer than any approved lead. */
const PREROLL_WINDOW_MS = 700;
const PROJECTILE_ACTORS = new Set(["mage", "ranger", "spider"]);
/** Class technique hits (colour hint only). */
const CLASS_PROCS = new Set(["combo_strike", "flowing_combo", "retaliation", "relentless_finish", "split_arrow", "venom_burst", "piercing_strike"]);
/** Item-owned status lines are named `status:mechanic` (bleed:rend); colour by the family. */
const statusFamily = (status: unknown): string => String(status).split(":")[0] ?? "";

interface ActorView {
  id: string;
  isHero: boolean;
  root: Container;
  hud: Container;
  body: Sprite;
  flash: Sprite;
  aura: Sprite;
  bar: Graphics;
  pips: Graphics;
  tex: SpriteTextures;
  baseX: number;
  displayScale: number;
  hp100: number;
  max100: number;
  shownHp100: number;
  /** Mage ward (C2): absorbs damage before HP; drawn above the HP bar as a share of its cap. */
  ward100: number;
  wardCap100: number;
  alive: boolean;
  statuses: Set<string>;
  lungeAt: number;
  flashAt: number;
  deathAt: number;
  spawnAt: number;
  phase: number;
  vfx: Map<string, Sprite>;
  critAt: number;
  healAt: number;
  spriteName: string;
  motion?: ProductionMotion;
  targetId: string;
  emittedAttack: number;
  lastAttack: number;
  groundOffset: number;
  barOffset: number;
  wardPhase: "off" | "form" | "idle_loop" | "absorb_hit" | "break";
  wardAt: number;
}

interface Floater {
  node: Container;
  start: number;
  duration: number;
  rise: number;
  x: number;
  y: number;
}

interface Effect {
  node: Graphics;
  start: number;
  duration: number;
  update(node: Graphics, p: number): void;
}

export interface RendererInfo {
  logicalWidth: number;
  logicalHeight: number;
  scale: number;
  renderer: string;
  artDecodedBytes: number;
}

export class CombatRenderer {
  private readonly app: Application;
  private readonly host: HTMLElement;
  private sprites = new TextureBank(() => { this.fightKey = ""; });
  private artScene = "";
  private glyphs = new Map<string, Texture>();
  private background: Sprite | null = null;
  private environment: EnvironmentArt | null = null;
  private preview: ArtPreviewScene | null = null;
  private readonly world = new Container();
  private readonly actorLayer = new Container();
  private readonly fxLayer = new Container();
  private readonly uiLayer = new Container();
  private actors = new Map<string, ActorView>();
  private floaters: Floater[] = [];
  private effects: Effect[] = [];
  private artEffects: { node: Sprite; tex: SpriteTextures; name: string; start: number; duration: number; from: [number, number]; to: [number, number]; hit?: string; owner?: string; target?: string }[] = [];
  private fightKey = "";
  private cursor = 0;
  private events: CombatEvent[] = [];
  /** Indexes of attack events whose wind-up already started ahead of the event time. */
  private prerolled = new Set<number>();
  private launched = new Set<number>();
  private rebuilding = false;
  private lastPlayback = -1;
  private heroSprite = "monk";
  private enemyCount = 1;
  private backgroundId = "greenfields";
  private W = 192;
  private H = 120;
  private scale = 3;
  private visible = true;
  private shakeUntil = 0;
  private lastFrame: CombatFrame | null = null;
  private destroyed = false;
  private readonly resizeObserver: ResizeObserver;
  private contextLost = false;
  onContextLost: (() => void) | null = null;

  private constructor(host: HTMLElement, app: Application) {
    this.host = host;
    this.app = app;
    this.world.addChild(this.actorLayer, this.fxLayer, this.uiLayer);
    this.resizeObserver = new ResizeObserver(() => this.resize());
  }

  static async create(host: HTMLElement, options: { background?: string } = {}): Promise<CombatRenderer> {
    const app = new Application();
    await app.init({
      preference: "webgl",
      antialias: false,
      autoStart: false,
      sharedTicker: false,
      autoDensity: false,
      resolution: 1,
      roundPixels: true,
      backgroundAlpha: 1,
      background: "#10182a",
      width: 192,
      height: 120,
      powerPreference: "low-power",
    });
    const r = new CombatRenderer(host, app);
    r.backgroundId = options.background ?? r.backgroundId;
    app.canvas.classList.add("combat-canvas");
    app.canvas.addEventListener("webglcontextlost", r.handleContextLost);
    host.appendChild(app.canvas);
    app.stage.addChild(r.world);
    r.resize();
    r.resizeObserver.observe(host);
    return r;
  }

  info(): RendererInfo {
    return {
      logicalWidth: this.W,
      logicalHeight: this.H,
      scale: this.scale,
      renderer: this.app.renderer.name,
      artDecodedBytes: this.sprites.decodedBytes,
    };
  }

  setHeroSprite(sprite: string): void {
    if (sprite !== this.heroSprite) {
      this.heroSprite = sprite;
      this.fightKey = "";
    }
  }

  /** Zone background theme (ZoneDef.background). Redraws only when it changes. */
  setBackground(id: string): void {
    if (id === this.backgroundId) return;
    this.backgroundId = id;
    this.drawScene();
  }

  setVisible(visible: boolean): void {
    if (visible && !this.visible) this.fightKey = "";
    this.visible = visible;
    if (visible && this.lastFrame) this.onFrame(this.lastFrame);
  }

  private handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
    this.onContextLost?.();
  };

  get isContextLost(): boolean {
    return this.contextLost;
  }

  // ---------------------------------------------------------------- layout

  resize(): void {
    if (this.destroyed) return;
    const rect = this.host.getBoundingClientRect();
    const W = Math.max(160, Math.floor(rect.width / 2));
    const H = Math.max(170, Math.floor(rect.height / 2));
    if (W === this.W && H === this.H && this.background) return;
    this.W = W; this.H = H; this.scale = 1;
    this.app.renderer.resize(W, H);
    this.world.scale.set(1);
    this.app.canvas.style.width = `${W * 2}px`;
    this.app.canvas.style.height = `${H * 2}px`;
    this.drawScene();
  }

  private drawScene(): void {
    if (this.destroyed) return;
    if (this.background) {
      this.background.texture.destroy(true);
      this.background.destroy();
    }
    let backgroundTexture: Texture;
    if (this.backgroundId === "darkwood") {
      // Fixed-width approved art is never stretched; wide phones get quiet palette gutters.
      const canvas = document.createElement("canvas"); canvas.width = this.W; canvas.height = this.H;
      const ctx = canvas.getContext("2d")!; ctx.fillStyle = "#0D141A"; ctx.fillRect(0, 0, this.W, this.H);
      backgroundTexture = Texture.from({ resource: canvas, scaleMode: "nearest" });
    } else backgroundTexture = drawBackground(this.backgroundId, this.W, this.H);
    this.background = new Sprite(backgroundTexture);
    this.world.addChildAt(this.background, 0);
    this.environment?.dispose();
    this.environment = new EnvironmentArt(this.backgroundId, this.W, this.H, () => {
      if (!this.destroyed && !this.contextLost) this.app.renderer.render(this.app.stage);
    });
    this.world.addChildAt(this.environment.back, 1);
    this.world.addChild(this.environment.front);
    this.fightKey = "";
    if (this.preview) this.renderPreview(this.preview);
    else if (this.lastFrame) this.onFrame(this.lastFrame);
  }

  // --------------------------------------------------------------- frames

  onFrame(frame: CombatFrame): void {
    if (this.destroyed) return;
    this.lastFrame = frame;
    if (!this.visible || this.contextLost) return;
    const now = performance.now();
    const showing = frame.fight ?? frame.lastFight;
    if (showing) {
      if (showing.key !== this.fightKey) this.loadFight(showing, frame, now, frame.fight !== null);
      const t = frame.fight ? frame.elapsedMs : showing.summary.durationMs;
      this.play(t, now);
      if (!frame.fight && frame.run && frame.run.phase === "rest") this.showRecovery(frame);
    } else if (this.fightKey !== "idle") {
      this.clearScene();
      this.fightKey = "idle";
      this.spawnHero(frame.heroMaxHp100, frame.carriedHp100 ?? frame.heroMaxHp100, now);
    }
    this.animate(now);
    this.app.renderer.render(this.app.stage);
  }

  private clearScene(): void {
    for (const a of this.actors.values()) { a.root.destroy({ children: true }); a.hud.destroy({ children: true }); }
    this.actors.clear();
    for (const f of this.floaters) f.node.destroy({ children: true });
    this.floaters = [];
    for (const e of this.effects) e.node.destroy();
    this.effects = [];
    for (const e of this.artEffects) e.node.destroy();
    this.artEffects = [];
    this.prerolled.clear(); this.launched.clear(); this.lastPlayback = -1;
  }

  private loadFight(fight: NonNullable<CombatFrame["fight"]>, frame: CombatFrame, now: number, live: boolean): void {
    const previousHero = this.actors.get("hero");
    const heroHp = previousHero ? previousHero.shownHp100 : null;
    this.clearScene();
    const artScene = [this.heroSprite, ...fight.setup.enemies.map(e => e.sprite)].join("|");
    if (artScene !== this.artScene) {
      this.sprites.dispose();
      this.sprites = new TextureBank(() => { this.fightKey = ""; });
      this.artScene = artScene;
    }
    this.fightKey = fight.key;
    this.events = fight.events ?? [];
    this.cursor = 0;
    this.rebuilding = true;
    this.prerolled.clear();
    this.enemyCount = fight.setup.enemies.length;
    const slots = slotPositions(this.enemyCount, this.W);
    const hero = this.spawnHero(fight.hero.maxHp100, heroHp ?? fight.record.startHp100 ?? fight.hero.maxHp100, now);
    hero.statuses.clear();
    fight.setup.enemies.forEach((e, i) => {
      const view = this.makeActor(e.id, e.sprite, false, slots[i] ?? this.W * 0.7, e.maxHp100, e.maxHp100);
      view.spawnAt = live ? now + i * 60 : now - 10_000;
      view.phase = i * 1.7;
    });
    this.layoutEnemyHud();
    void frame;
  }

  private spawnHero(max100: number, hp100: number, now: number): ActorView {
    const hero = this.makeActor("hero", this.heroSprite, true, Math.round((this.W - 224) / 2 + 50), max100, hp100);
    hero.spawnAt = now - 10_000;
    return hero;
  }

  private makeActor(id: string, spriteName: string, isHero: boolean, x: number, max100: number, hp100: number): ActorView {
    const tex = this.sprites.get(spriteName);
    // Limit unusually wide art to its slot; quantize to whole device pixels.
    const available = isHero ? this.W * 0.29 : this.W * (this.enemyCount >= 3 ? 0.16 : this.enemyCount === 2 ? 0.2 : 0.3);
    const wanted = Math.min(tex.scale, available / tex.width, (this.H * 0.65) / tex.height);
    const displayScale = actorPack[spriteName] ? 1 : Math.min(wanted, Math.max(1 / this.scale, Math.floor(wanted * this.scale) / this.scale));
    const leftWidth = ((isHero ? "right" : "left") === tex.facing ? tex.anchorX : tex.width - tex.anchorX) * displayScale;
    x = Math.round(Math.max(leftWidth + 2, Math.min(this.W - 2 - (tex.width * displayScale - leftWidth), x)));
    if (actorPack[spriteName]) {
      for (const pose of ["attack", "hit", "death", "flash"]) this.sprites.optional(`${productionActorId(spriteName)}/${pose}`);
      const effects = spriteName === "mage" ? ["arcane_bolt", "arcane_bolt_hit", "arcane_ward_back", "arcane_ward_front"] : spriteName === "ranger" ? ["arrow", "arrow_hit"] : spriteName === "monk" ? ["monk_impact", "monk_impact_crit"] : spriteName === "warrior" ? ["warrior_impact", "warrior_impact_crit", "warrior_slash"] : spriteName === "wolf" ? ["wolf_bite"] : ["venom_glob", "venom_splash"];
      for (const fx of effects) this.sprites.optional(`vfx/${fx}`);
    }
    const production = actorPack[spriteName];
    if (production) {
      const clips = Object.values(production.animations);
      const left = Math.max(...clips.map(c => c.anchor[0]!));
      const right = Math.max(...clips.map(c => c.frame[0]! - c.anchor[0]!));
      x = Math.round(Math.max(left + 2, Math.min(this.W - right - 2, x)));
    }
    const root = new Container();
    const body = new Sprite(tex.normal);
    const flash = new Sprite(tex.flash);
    const aura = new Sprite(tex.flash);
    for (const s of [aura, body, flash]) {
      s.anchor.set(tex.anchorX / tex.width, tex.anchorY / tex.height);
      s.scale.set(displayScale * ((isHero ? "right" : "left") === tex.facing ? 1 : -1), displayScale);
    }
    flash.alpha = 0;
    aura.alpha = 0;
    aura.tint = 0x7fd4ff;
    const bar = new Graphics();
    const pips = new Graphics();
    root.addChild(aura, body, flash);
    const hud = new Container(); hud.addChild(bar, pips); this.uiLayer.addChild(hud);
    root.position.set(x, this.ground());
    this.actorLayer.addChild(root);
    const view: ActorView = {
      id,
      isHero,
      root,
      hud,
      body,
      flash,
      aura,
      bar,
      pips,
      tex,
      baseX: x,
      displayScale,
      hp100,
      max100,
      shownHp100: hp100,
      ward100: 0,
      wardCap100: 0,
      alive: hp100 > 0,
      statuses: new Set(),
      lungeAt: -1,
      flashAt: -1,
      deathAt: -1,
      spawnAt: -1,
      phase: 0,
      vfx: new Map(),
      critAt: -10000,
      healAt: -10000,
      spriteName,
      motion: actorPack[spriteName] ? new ProductionMotion(actorPack[spriteName]!) : undefined,
      targetId: "", emittedAttack: -1, lastAttack: -10000,
      barOffset: -Math.round(tex.anchorY * displayScale) - 5,
      groundOffset: !isHero && this.enemyCount === 3 ? THREE_ENEMY_FORMATION[this.actors.size - 1]!.rise : 0,
      wardPhase: "off", wardAt: 0,
    };
    this.actors.set(id, view);
    this.drawBar(view);
    return view;
  }

  // ------------------------------------------------------------- playback

  private play(t: number, now: number): void {
    // A suspended/reconstructed renderer settles historical state without replaying old VFX.
    const settling = this.rebuilding || (this.lastPlayback >= 0 && t - this.lastPlayback > FAST_FORWARD_MS);
    if (settling) {
      for (const effect of this.artEffects) effect.node.destroy();
      this.artEffects = [];
      this.prerolled.clear(); this.launched.clear();
      for (const a of this.actors.values()) if (a.motion && a.alive) a.motion = new ProductionMotion(actorPack[a.spriteName]!);
    }
    while (this.cursor < this.events.length) {
      const e = this.events[this.cursor]!;
      if (e.t > t) break;
      this.cursor += 1;
      this.apply(e, now, settling || t - e.t > FAST_FORWARD_MS);
    }
    this.rebuilding = false; this.lastPlayback = t;
    this.prerollAttacks(t, now);
  }

  /**
   * Presentation-only wind-up. The combat log records ATTACK and its HIT at the same time
   * (the authoritative contact moment). Production clips need anticipation (and projectiles
   * need flight) before contact, so the attacker's clip starts early enough that the impact
   * frame (melee) or the projectile arrival lands exactly on the logged time. No event is
   * moved, created or skipped; HP, damage numbers and hit reactions still apply at e.t.
   */
  private prerollAttacks(t: number, now: number): void {
    for (let j = this.cursor; j < this.events.length; j++) {
      const e = this.events[j]!;
      if (e.t > t + PREROLL_WINDOW_MS) break;
      if (e.type !== "attack") continue;
      const src = this.actors.get(String(e.src));
      if (!src?.motion || !src.alive) continue;
      const clip = actorPack[src.spriteName]!.animations.attack;
      const interval = this.attackInterval(j, String(e.src));
      const durations = attackDurations(clip, interval);
      const impact = clip.impact_frame ?? 1;
      const lead = durations.slice(0, impact).reduce((a, b) => a + b, 0) + (PROJECTILE_ACTORS.has(src.spriteName) ? PROJECTILE_MS : 0);
      if (e.t - lead > t) continue;
      const target = this.actors.get(String(e.tgt));
      if (!target?.alive) continue;
      if (!this.prerolled.has(j)) {
        this.prerolled.add(j);
        src.targetId = String(e.tgt);
        src.lungeAt = now;
        src.motion.scheduledAttack(now - (t - (e.t - lead)), interval);
      }
      // Neutral projectile only. Contact/critical effects are emitted by the logged HIT.
      if (PROJECTILE_ACTORS.has(src.spriteName) && t >= e.t - PROJECTILE_MS && !this.launched.has(j)) {
        this.launched.add(j);
        const before = this.artEffects.length;
        this.attackArt(src, target, now - (t - (e.t - PROJECTILE_MS)), true);
        if (this.artEffects.length > before) Object.assign(this.artEffects[this.artEffects.length - 1]!, { owner: src.id, target: target.id });
      }
    }
  }

  /** Time to the same actor's next logged attack (authoritative cadence), for clip fitting only. */
  private attackInterval(index: number, src: string): number {
    const e = this.events[index]!;
    for (let k = index + 1; k < this.events.length; k++) {
      const n = this.events[k]!;
      if (n.type === "attack" && String(n.src) === src) return Math.max(1, n.t - e.t);
    }
    return 1000;
  }

  private apply(e: CombatEvent, now: number, fastForward: boolean): void {
    switch (e.type) {
      case "spawn": {
        const a = this.actors.get(String(e.actor));
        if (a) {
          a.hp100 = Number(e.hp);
          a.max100 = Number(e.max);
          a.shownHp100 = a.hp100;
          this.drawBar(a);
        }
        break;
      }
      case "attack": {
        const src = this.actors.get(String(e.src));
        const tgt = this.actors.get(String(e.tgt));
        if (!src || fastForward) break;
        src.lungeAt = now;
        src.targetId = String(e.tgt);
        // Wind-up already started in prerollAttacks(); otherwise (direct/tooling calls) start now.
        if (!this.prerolled.has(this.cursor - 1) || this.events[this.cursor - 1] !== e) src.motion?.attack(now, src.lastAttack > 0 ? now - src.lastAttack : 1000);
        src.lastAttack = now;
        if (!src.motion && src.isHero && this.heroSprite === "mage" && tgt) this.projectile(src, tgt, now);
        break;
      }
      case "hit": {
        const tgt = this.actors.get(String(e.tgt));
        const src = this.actors.get(String(e.src));
        if (!tgt) break;
        tgt.hp100 = Number(e.hp);
        if (e.ward !== undefined) {
          if (tgt.ward100 > 0 && Number(e.ward) <= 0) { tgt.wardPhase = fastForward ? "off" : "break"; tgt.wardAt = now; }
          tgt.ward100 = Number(e.ward);
          this.drawBar(tgt);
        }
        if (fastForward) {
          tgt.shownHp100 = tgt.hp100;
          this.drawBar(tgt);
          break;
        }
        tgt.flashAt = now;
        tgt.motion?.hit(now, Number(e.abs ?? 0) > 0);
        if (Number(e.abs ?? 0) > 0) { tgt.wardPhase = tgt.ward100 > 0 ? "absorb_hit" : "break"; tgt.wardAt = now; }
        if (src?.motion && e.via === "basic" && this.events.includes(e)) this.contactArt(src, tgt, now, e.crit === 1);
        const crit = e.crit === 1;
        const via = String(e.via);
        let color = COLORS.heroHit;
        if (!src?.isHero) color = COLORS.taken;
        else if (crit) color = COLORS.crit;
        else if (via === "spell_echo" || via === "wildfire" || via === "stormcall") color = COLORS.magicProc;
        else if (via === "venom_burst") color = COLORS.poison;
        else if (via !== "basic") color = CLASS_PROCS.has(via) ? COLORS.classProc : COLORS.itemProc;
        // A hit fully absorbed by the ward shows in ward colour.
        if (e.abs !== undefined && Number(e.eff) === 0 && Number(e.abs) > 0) color = COLORS.ward;
        this.floatNumber(tgt, Math.round(Number(e.amt) / 100), color, crit ? 2 : 1, now, crit ? "!" : "");
        if (crit) { tgt.critAt = now; src?.motion?.crit(); }
        if (crit && !src?.motion) this.shakeUntil = now + 120;
        if (via === "wildfire" && !src?.motion) this.ring(tgt, 0xff9a3a, now);
        if ((via === "stormcall" || via === "split_arrow") && src && !src.motion) this.bolt(src, tgt, now);
        if (via === "venom_burst" && !src?.motion) this.ring(tgt, 0x9fe05a, now);
        if (via === "retaliation" && !src?.motion) this.ring(tgt, 0xd8404a, now);
        break;
      }
      case "heal": {
        const tgt = this.actors.get(String(e.tgt));
        if (!tgt) break;
        tgt.hp100 = Number(e.hp);
        if (!fastForward && Number(e.eff) > 0) tgt.healAt = now;
        if (!fastForward && Number(e.eff) > 0) this.floatNumber(tgt, Math.round(Number(e.eff) / 100), COLORS.heal, 1, now, "", "+");
        if (fastForward) tgt.shownHp100 = tgt.hp100;
        break;
      }
      case "tick": {
        const tgt = this.actors.get(String(e.tgt));
        if (!tgt) break;
        tgt.hp100 = Number(e.hp);
        if (e.ward !== undefined) {
          if (tgt.ward100 > 0 && Number(e.ward) <= 0) { tgt.wardPhase = fastForward ? "off" : "break"; tgt.wardAt = now; }
          tgt.ward100 = Number(e.ward);
          this.drawBar(tgt);
        }
        const color = (COLORS as Record<string, string>)[statusFamily(e.status)] ?? COLORS.burn;
        if (!fastForward) this.floatNumber(tgt, Math.round(Number(e.amt) / 100), color, 1, now, "");
        else tgt.shownHp100 = tgt.hp100;
        break;
      }
      case "ward": {
        const tgt = this.actors.get(String(e.tgt));
        if (!tgt) break;
        const previousWard = tgt.ward100;
        tgt.ward100 = Number(e.ward);
        if (!fastForward && tgt.motion) {
          if (tgt.ward100 > previousWard) { tgt.wardPhase = "form"; tgt.wardAt = now; }
          else if (previousWard > 0 && tgt.ward100 <= 0) { tgt.wardPhase = "break"; tgt.wardAt = now; }
        } else if (tgt.ward100 > 0) tgt.wardPhase = "idle_loop";
        if (e.cap !== undefined) tgt.wardCap100 = Number(e.cap);
        this.drawBar(tgt);
        if (!fastForward && e.via !== "start" && Number(e.amt) > 0) {
          this.floatNumber(tgt, Math.ceil(Number(e.amt) / 100), COLORS.ward, 1, now, "", "◇+");
          if (!tgt.motion) this.ring(tgt, 0x8fd0ff, now);
        }
        break;
      }
      case "status": {
        const tgt = this.actors.get(String(e.tgt));
        if (tgt) {
          tgt.statuses.add(String(e.status));
          this.drawPips(tgt);
        }
        break;
      }
      case "status_end": {
        const tgt = this.actors.get(String(e.tgt));
        if (tgt) {
          tgt.statuses.delete(String(e.status));
          this.drawPips(tgt);
        }
        break;
      }
      case "death": {
        const a = this.actors.get(String(e.actor));
        if (a) {
          a.alive = false;
          a.statuses.clear();
          a.hp100 = 0;
          a.deathAt = fastForward ? now - 10_000 : now;
          a.motion?.death(a.deathAt);
          if (a.wardPhase !== "off") { a.wardPhase = "break"; a.wardAt = now; }
          this.drawPips(a);
        }
        break;
      }
      default:
        break;
    }
  }

  private showRecovery(frame: CombatFrame): void {
    const hero = this.actors.get("hero");
    if (!hero || frame.carriedHp100 === null || !hero.alive) return;
    if (frame.carriedHp100 > hero.hp100 && hero.hp100 > 0) {
      const gained = frame.carriedHp100 - hero.hp100;
      hero.hp100 = frame.carriedHp100;
      this.floatNumber(hero, Math.round(gained / 100), COLORS.heal, 1, performance.now(), "", "+");
    } else if (frame.carriedHp100 < hero.hp100) {
      hero.hp100 = frame.carriedHp100;
    }
    hero.max100 = frame.heroMaxHp100;
  }

  // ------------------------------------------------------------ animation

  private animate(now: number): void {
    const ground = this.ground();
    let vfxCount = 0;
    for (const a of this.actors.values()) {
      if (a.motion) {
        this.animateProduction(a, now);
        a.root.position.set(a.baseX, ground + a.groundOffset);
        a.root.zIndex = a.groundOffset;
        a.hud.position.copyFrom(a.root.position);
        a.root.alpha = 1; a.body.tint = 0xffffff; a.aura.alpha = 0;
        a.shownHp100 = a.hp100; this.drawBar(a);
        continue;
      }
      const pose: Pose = this.preview && a.isHero ? this.preview.pose : !a.alive ? "death" : now - a.flashAt < 140 && a.flashAt > 0 ? "hit" : now - a.lungeAt < 180 && a.lungeAt > 0 ? "attack" : "idle";
      if (a.tex.asset) {
        const start = pose === "death" ? a.deathAt : pose === "hit" ? a.flashAt : pose === "attack" ? a.lungeAt : 0;
        const frame = a.tex.frames[animationFrame(a.tex.asset, pose, this.preview && a.isHero ? this.preview.timeMs : now - start)]!;
        a.body.texture = frame.normal;
        a.flash.texture = a.aura.texture = frame.flash;
      }
      const activeFx = new Set([...a.statuses].map(statusFamily));
      if (a.ward100 > 0 && a.alive) activeFx.add("ward");
      if (now - a.critAt < 350) activeFx.add("crit");
      if (now - a.healAt < 350) activeFx.add("heal");
      if (a.flashAt > 0 && now - a.flashAt < 140) activeFx.add("hit");
      for (const s of a.vfx.values()) s.visible = false;
      for (const name of activeFx) {
        if (!a.alive || vfxCount >= ART_BUDGET.maxVfx) break;
        const tex = this.sprites.optional(`vfx/${name}`);
        if (!tex?.asset) continue;
        let sprite = a.vfx.get(name);
        if (!sprite) { sprite = new Sprite(tex.normal); a.root.addChildAt(sprite, 3); a.vfx.set(name, sprite); }
        sprite.visible = true;
        sprite.texture = tex.frames[animationFrame(tex.asset, "idle", now)]!.normal;
        sprite.anchor.set(tex.anchorX / tex.width, tex.anchorY / tex.height);
        const native = a.tex.asset?.attachments.chest ?? { x: a.tex.anchorX, y: a.tex.height / 2 };
        sprite.position.set(Math.round((native.x - a.tex.anchorX) * a.body.scale.x), Math.round((native.y - a.tex.anchorY) * a.displayScale));
        sprite.scale.set(Math.max(1 / this.scale, Math.floor(tex.scale * this.scale) / this.scale));
        vfxCount += 1;
      }
      let x = a.baseX;
      let y = ground + a.groundOffset;
      a.root.zIndex = a.groundOffset;
      // spawn slide-in
      if (a.spawnAt > 0) {
        const p = Math.min(1, (now - a.spawnAt) / 350);
        if (p < 1) {
          x += Math.round((1 - p) * (1 - p) * this.W * 0.35);
          a.root.alpha = Math.max(0, p);
        } else {
          a.root.alpha = 1;
        }
      }
      // idle bob
      if (a.alive) y -= Math.round((Math.sin(now / 320 + a.phase) + 1) * 0.5);
      // lunge
      if (a.lungeAt > 0) {
        const p = (now - a.lungeAt) / 180;
        if (p < 1) x += Math.round(Math.sin(p * Math.PI) * (a.isHero ? 6 : -5));
      }
      // hit flash + knockback
      if (a.flashAt > 0) {
        const p = (now - a.flashAt) / 140;
        a.flash.alpha = p < 1 ? 1 - p : 0;
        if (p < 0.5) x += a.isHero ? -1 : 1;
      }
      // death
      if (a.deathAt > 0) {
        const p = Math.min(1, (now - a.deathAt) / 450);
        a.root.alpha = 1 - p;
        y += Math.round(p * 3);
        a.body.tint = 0x777777;
      }
      // haste aura
      const hasted = a.statuses.has("flow") || a.statuses.has("wraps_flow");
      a.aura.alpha = hasted ? 0.35 + 0.15 * Math.sin(now / 90) : 0;
      a.aura.x = hasted ? -2 : 0;
      a.root.position.set(Math.round(x), Math.round(y));
      a.hud.position.copyFrom(a.root.position); a.hud.alpha = a.root.alpha;
      // health bar easing
      if (a.shownHp100 !== a.hp100) {
        const diff = a.hp100 - a.shownHp100;
        const step = Math.max(1, Math.abs(diff) * 0.25);
        a.shownHp100 = Math.abs(diff) <= step ? a.hp100 : a.shownHp100 + Math.sign(diff) * step;
        this.drawBar(a);
      }
    }
    this.actorLayer.sortableChildren = true;
    this.animateArtEffects(now);
    // screen shake
    if (now < this.shakeUntil) {
      this.world.x = (Math.floor(now / 30) % 2 === 0 ? 1 : -1) * this.scale;
    } else {
      this.world.x = 0;
    }
    // floating numbers
    this.floaters = this.floaters.filter((f) => {
      const p = (now - f.start) / f.duration;
      if (p >= 1) {
        f.node.destroy({ children: true });
        return false;
      }
      f.node.position.set(Math.round(f.x), Math.round(f.y - f.rise * Math.min(1, p * 1.6)));
      f.node.alpha = p > 0.75 ? (1 - p) / 0.25 : 1;
      return true;
    });
    this.effects = this.effects.filter((e) => {
      const p = (now - e.start) / e.duration;
      if (p >= 1) {
        e.node.destroy();
        return false;
      }
      e.update(e.node, p);
      return true;
    });
  }

  // ------------------------------------------------------------- drawing

  private drawBar(a: ActorView): void {
    const width = a.motion ? 30 : a.isHero ? 22 : Math.max(14, Math.min(24, a.tex.width));
    const x = -Math.floor(width / 2);
    const y = a.barOffset;
    const fill = a.max100 > 0 ? Math.max(0, Math.round((a.shownHp100 / a.max100) * (width - 2))) : 0;
    const g = a.bar;
    g.clear();
    g.rect(x, y, width, 4).fill(0x14121a);
    g.rect(x + 1, y + 1, width - 2, 2).fill(0x3a2a30);
    if (fill > 0) {
      const ratio = a.shownHp100 / Math.max(1, a.max100);
      g.rect(x + 1, y + 1, fill, 2).fill(ratio < 0.3 ? 0xf08a3a : 0xd8434a);
      g.rect(x + 1, y + 1, fill, 1).fill(ratio < 0.3 ? 0xffb070 : 0xf06a6a);
    }
    if (a.wardCap100 > 0) {
      // Ward: a thin pale-blue bar just above the HP bar, filled as a share of the ward's cap.
      g.rect(x, y - 2, width, 2).fill(0x14121a);
      const ward = a.ward100 > 0 ? Math.max(1, Math.min(width - 2, Math.round((a.ward100 / a.wardCap100) * (width - 2)))) : 0;
      if (ward > 0) g.rect(x + 1, y - 1, ward, 1).fill(0x8fd0ff);
      // Reuse this actor's graphics: no extra ticker, objects or gameplay state.
      // A small shield stays visible even when the ward is only a fraction of its cap.
      if (ward > 0 && a.alive) {
        g.poly([x - 7, y, x - 2, y, x - 2, y + 4, x - 4, y + 6, x - 7, y + 4]).fill(0x8fd0ff);
        g.rect(x - 5, y + 1, 1, 3).fill(0x245578);
      }
    }
    this.drawPips(a);
  }

  private drawPips(a: ActorView): void {
    const g = a.pips;
    g.clear();
    const y = a.barOffset - 3 - (a.wardCap100 > 0 ? 2 : 0); // above the ward bar when there is one
    let i = 0;
    for (const s of a.statuses) {
      const color = PIP_COLORS[statusFamily(s)] ?? 0xffffff;
      g.rect(-6 + i * 4, y, 3, 2).fill(0x14121a);
      g.rect(-6 + i * 4, y, 2, 2).fill(color);
      i += 1;
    }
  }

  private glyph(ch: string, color: string): Texture {
    const key = `${ch}|${color}`;
    let tex = this.glyphs.get(key);
    if (!tex) {
      tex = Texture.from({ resource: glyphCanvas(ch, color), scaleMode: "nearest" });
      this.glyphs.set(key, tex);
    }
    return tex;
  }

  private floatNumber(a: ActorView, value: number, color: string, size: number, now: number, suffix: string, prefix = ""): void {
    const text = `${prefix}${value}${suffix}`;
    const node = new Container();
    [...text].forEach((ch, i) => {
      if (!GLYPHS[ch]) return;
      const s = new Sprite(this.glyph(ch, color));
      s.position.set(i * 4, 0);
      node.addChild(s);
    });
    node.scale.set(size);
    const width = text.length * 4 * size;
    const jitter = (this.floaters.length % 3) * 3 - 3;
    const x = a.root.x - Math.floor(width / 2) + jitter;
    const y = a.root.y - Math.round(a.tex.anchorY * a.displayScale) - 12 - (size - 1) * 4;
    node.position.set(x, y);
    this.uiLayer.addChild(node);
    this.floaters.push({ node, start: now, duration: size > 1 ? 900 : 700, rise: 8, x, y });
    if (this.floaters.length > 40) {
      const old = this.floaters.shift();
      old?.node.destroy({ children: true });
    }
  }

  private projectile(src: ActorView, tgt: ActorView, now: number): void {
    if (this.effects.length >= ART_BUDGET.maxVfx) return;
    const node = new Graphics();
    this.fxLayer.addChild(node);
    const sx = src.baseX + 8;
    const sy = src.root.y - Math.floor(src.tex.height * 0.6);
    const tx = tgt.baseX;
    const ty = tgt.root.y - Math.floor(tgt.tex.height * 0.5);
    this.effects.push({
      node,
      start: now,
      duration: 160,
      update: (g, p) => {
        g.clear();
        const x = Math.round(sx + (tx - sx) * p);
        const y = Math.round(sy + (ty - sy) * p);
        g.rect(x - 1, y - 1, 3, 3).fill(0xff9a3a);
        g.rect(x, y, 1, 1).fill(0xfff0a0);
        g.rect(x - 3, y, 2, 1).fill(0xc85a2a);
      },
    });
  }

  private ring(tgt: ActorView, color: number, now: number): void {
    if (this.effects.length >= ART_BUDGET.maxVfx) return;
    const node = new Graphics();
    this.fxLayer.addChild(node);
    const cx = tgt.baseX;
    const cy = tgt.root.y - Math.floor(tgt.tex.height / 2);
    this.effects.push({
      node,
      start: now,
      duration: 260,
      update: (g, p) => {
        g.clear();
        const r = Math.round(3 + p * 9);
        g.rect(cx - r, cy, 2, 1).fill(color);
        g.rect(cx + r - 1, cy, 2, 1).fill(color);
        g.rect(cx, cy - r, 1, 2).fill(color);
        g.rect(cx, cy + r - 1, 1, 2).fill(color);
        g.alpha = 1 - p;
      },
    });
  }

  private bolt(src: ActorView, tgt: ActorView, now: number): void {
    if (this.effects.length >= ART_BUDGET.maxVfx) return;
    const node = new Graphics();
    this.fxLayer.addChild(node);
    const x0 = src.baseX;
    const x1 = tgt.baseX;
    const y = tgt.root.y - Math.floor(tgt.tex.height * 0.6);
    this.effects.push({
      node,
      start: now,
      duration: 180,
      update: (g, p) => {
        g.clear();
        const steps = Math.max(2, Math.floor(Math.abs(x1 - x0) / 4));
        for (let i = 0; i < steps; i += 1) {
          const x = Math.round(x0 + ((x1 - x0) * i) / steps);
          g.rect(x, y + ((i * 7 + Math.floor(p * 10)) % 3) - 1, 2, 1).fill(0x9fd8ff);
        }
        g.alpha = 1 - p;
      },
    });
  }

  /** DEV-only caller. Synthetic presentation, never a PreparedFight or game command. */
  renderPreview(scene: ArtPreviewScene): void {
    if (this.destroyed || this.contextLost) return;
    this.preview = scene;
    this.events = [];
    this.heroSprite = scene.hero;
    this.enemyCount = scene.enemies.length;
    this.clearScene();
    const signature = [scene.hero, ...scene.enemies].join("|");
    if (signature !== this.artScene) {
      this.sprites.dispose();
      this.sprites = new TextureBank(() => { if (this.preview) this.renderPreview(this.preview); });
      this.artScene = signature;
    }
    const now = 10000 + scene.timeMs;
    const hero = this.spawnHero(10000, 7000, now);
    const positions = slotPositions(scene.enemies.length, this.W);
    scene.enemies.slice(0, 3).forEach((name, i) => this.makeActor(`preview-${i}`, name, false, positions[i]!, 10000, 6500));
    this.layoutEnemyHud();
    if (hero.motion) {
      if (scene.pose === "attack") hero.motion.attack(now - scene.timeMs, 1000);
      if (scene.pose === "hit") hero.motion.hit(now - scene.timeMs, false);
      if (scene.pose === "death") hero.motion.death(now - scene.timeMs);
      hero.targetId = "preview-0";
    }
    if (scene.pose === "attack") hero.lungeAt = now - scene.timeMs % 180;
    if (scene.pose === "hit") hero.flashAt = now - scene.timeMs % 140;
    if (scene.pose === "death") { hero.alive = false; hero.deathAt = now - scene.timeMs % 450; }
    if (scene.effect === "ward") { hero.ward100 = 2400; hero.wardCap100 = 3000; hero.wardPhase = "idle_loop"; }
    else if (["poison", "bleed", "burn"].includes(scene.effect)) hero.statuses.add(scene.effect);
    this.drawBar(hero);
    if (scene.effect === "crit") hero.critAt = now - 100;
    if (scene.effect === "heal") hero.healAt = now - 100;
    if (scene.effect === "crit") this.floatNumber(hero, 42, COLORS.crit, 2, now - 100, "!");
    if (scene.effect === "heal") this.floatNumber(hero, 12, COLORS.heal, 1, now - 100, "", "+");
    this.animate(now);
    this.app.renderer.render(this.app.stage);
  }

  private ground(): number { return this.backgroundId === "darkwood" ? this.H - 50 : groundY(this.H) + 1; }

  private artOverlay(a: ActorView, name: string, index: number, behind = false): void {
    const tex = this.sprites.optional(`vfx/${name}`);
    if (!tex) return;
    let node = a.vfx.get(name);
    if (!node) { node = new Sprite(tex.normal); a.root.addChildAt(node, behind ? 0 : Math.min(3, a.root.children.length)); a.vfx.set(name, node); }
    node.visible = true; node.texture = tex.frames[index]?.normal ?? tex.normal;
    node.anchor.set(tex.anchorX / tex.width, tex.anchorY / tex.height);
    node.scale.set(1); node.position.set(0, 0);
  }

  private animateProduction(a: ActorView, now: number): void {
    const motion = a.motion!;
    const sample = motion.sample(now);
    const id = productionActorId(a.spriteName);
    const tex = sample.pose === "idle" ? this.sprites.get(a.spriteName) : this.sprites.optional(`${id}/${sample.pose}`);
    if (tex?.asset) {
      a.tex = tex;
      a.body.texture = tex.frames[sample.index]?.normal ?? tex.normal;
      a.body.anchor.set(tex.anchorX / tex.width, tex.anchorY / tex.height);
      a.body.scale.set(1); a.displayScale = 1;
      a.body.position.set(0, 0);
    }
    // The approved flash is used verbatim. No white shader or palette replacement.
    const flash = this.sprites.optional(`${id}/flash`);
    a.flash.alpha = 0;
    if (sample.pose === "hit" && !motion.absorbed && now - motion.start < 50 && flash) {
      a.flash.texture = flash.normal; a.flash.anchor.set(flash.anchorX / flash.width, flash.anchorY / flash.height);
      a.flash.scale.set(1); a.flash.alpha = 1;
    }
    for (const node of a.vfx.values()) node.visible = false;
    if (sample.pose === "attack" && a.spriteName === "warrior" && (sample.index === 1 || sample.index === 2)) this.artOverlay(a, "warrior_slash", sample.index - 1);
    if (sample.impact && !this.events.length && a.emittedAttack !== motion.attackSerial) {
      a.emittedAttack = motion.attackSerial;
      const target = this.actors.get(a.targetId);
      if (target) this.attackArt(a, target, now);
    }
    if (a.spriteName !== "mage") return;
    let phase = a.wardPhase;
    if (phase === "off" && a.ward100 > 0 && a.alive) { phase = "idle_loop"; a.wardPhase = phase; a.wardAt = now; }
    if (phase === "off") return;
    const fx = fxPack.arcane_ward_back!;
    const frames = fx.segments![phase]!;
    const timing = (fx.ms as Record<string, number | number[]>)[phase]!;
    const ms = typeof timing === "number" ? frames.map(() => timing) : timing;
    const elapsed = now - a.wardAt;
    if (phase !== "idle_loop" && elapsed >= ms.reduce((x, y) => x + y, 0)) {
      a.wardPhase = phase === "break" ? "off" : a.ward100 > 0 ? "idle_loop" : "off";
      a.wardAt = now;
      if (a.wardPhase === "off") return;
      phase = a.wardPhase;
    }
    const segment = fx.segments![phase]!;
    const durations = (fx.ms as Record<string, number | number[]>)[phase]!;
    const index = segment[sequenceIndex(typeof durations === "number" ? segment.map(() => durations) : durations, now - a.wardAt, phase === "idle_loop")]!;
    this.artOverlay(a, "arcane_ward_back", index, true);
    this.artOverlay(a, "arcane_ward_front", index);
  }

  private attackArt(src: ActorView, target: ActorView, now: number, scheduled = false): void {
    const contact: [number, number] = [target.baseX, this.ground() + target.groundOffset - Math.round(target.tex.anchorY * 0.5)];
    const crit = src.motion!.critical;
    const projectile = src.spriteName === "mage" ? "arcane_bolt" : src.spriteName === "ranger" ? "arrow" : src.spriteName === "spider" ? "venom_glob" : null;
    if (projectile) {
      const clip = actorPack[src.spriteName]!.animations.attack;
      const point = clip.fx_projectile_spawn!;
      const start: [number, number] = [src.baseX + point[0]! - clip.anchor[0]!, this.ground() + src.groundOffset + point[1]! - clip.anchor[1]!];
      this.artBurst(projectile, start, contact, now, PROJECTILE_MS, scheduled ? undefined : projectile === "arcane_bolt" ? "arcane_bolt_hit" : projectile === "arrow" ? "arrow_hit" : "venom_splash");
    } else {
      const name = src.spriteName === "wolf" ? "wolf_bite" : `${src.spriteName}_impact${crit ? "_crit" : ""}`;
      if (fxPack[name]) this.artBurst(name, contact, contact, now);
    }
  }

  private contactArt(src: ActorView, target: ActorView, now: number, crit: boolean): void {
    const point: [number, number] = [target.baseX, this.ground() + target.groundOffset - Math.round(target.tex.anchorY * 0.5)];
    const name = src.spriteName === "mage" ? "arcane_bolt_hit" : src.spriteName === "ranger" ? "arrow_hit" : src.spriteName === "spider" ? "venom_splash" : src.spriteName === "wolf" ? "wolf_bite" : `${src.spriteName}_impact${crit ? "_crit" : ""}`;
    this.artBurst(name, point, point, now);
  }

  /** Stable headroom from all production poses; same collision rule for fallback art. */
  private layoutEnemyHud(): void {
    const placed: { x: number; y: number; width: number }[] = [];
    let enemySlot = 0;
    for (const a of this.actors.values()) {
      const lane = !a.isHero && this.enemyCount === 3 ? THREE_ENEMY_FORMATION[enemySlot++]!.barLift : 0;
      const pack = actorPack[a.spriteName];
      const headroom = pack ? Math.max(...Object.values(pack.animations).map(c => c.anchor[1]!)) : a.tex.anchorY * a.displayScale;
      let y = a.groundOffset - Math.round(headroom) - 5 - lane;
      const width = a.motion ? 30 : a.isHero ? 22 : Math.max(14, Math.min(24, a.tex.width));
      while (placed.some(p => Math.abs(p.x - a.baseX) < (p.width + width) / 2 + 3 && Math.abs(p.y - y) < 10)) y -= 10;
      a.barOffset = y - a.groundOffset;
      placed.push({ x: a.baseX, y, width }); this.drawBar(a);
    }
  }

  private artBurst(name: string, from: [number, number], to: [number, number], start: number, duration?: number, hit?: string): void {
    if (this.artEffects.length >= ART_BUDGET.maxVfx) return;
    const tex = this.sprites.optional(`vfx/${name}`);
    const fx = fxPack[name];
    if (!tex || !fx || !Array.isArray(fx.ms)) return;
    const node = new Sprite(tex.normal); node.anchor.set(0.5); this.fxLayer.addChild(node);
    this.artEffects.push({ node, tex, name, from, to, start, duration: duration ?? fx.ms.reduce((a, b) => a + b, 0), hit });
  }

  private animateArtEffects(now: number): void {
    const completed: typeof this.artEffects = [];
    this.artEffects = this.artEffects.filter(e => {
      if (e.owner && (!this.actors.get(e.owner)?.alive || !this.actors.get(e.target!)?.alive)) { e.node.destroy(); return false; }
      const elapsed = now - e.start;
      if (elapsed >= e.duration) { e.node.destroy(); if (e.hit) completed.push(e); return false; }
      const index = sequenceIndex(fxPack[e.name]!.ms as number[], elapsed, !!e.hit);
      e.node.texture = e.tex.frames[index]!.normal;
      const p = Math.max(0, Math.min(1, elapsed / e.duration));
      e.node.position.set(Math.round(e.from[0] + (e.to[0] - e.from[0]) * p), Math.round(e.from[1] + (e.to[1] - e.from[1]) * p));
      return true;
    });
    for (const e of completed) this.artBurst(e.hit!, e.to, e.to, now);
  }

  presentationSnapshot(): unknown {
    return { cssScale: 2, width: this.W, height: this.H, background: this.backgroundId, actors: [...this.actors.values()].map(a => ({
      id: a.id, name: a.spriteName, production: !!a.tex.asset?.file.startsWith("art/darkwood/"), pose: a.motion?.pose,
      anchor: [a.body.anchor.x * a.body.texture.width, a.body.anchor.y * a.body.texture.height],
      frame: [a.body.texture.width, a.body.texture.height], scale: [a.body.scale.x, a.body.scale.y],
      world: [a.root.x, a.root.y], left: a.root.x - a.body.anchor.x * a.body.texture.width,
      right: a.root.x + (1 - a.body.anchor.x) * a.body.texture.width,
      top: a.root.y - a.body.anchor.y * a.body.texture.height,
      wardPhase: a.wardPhase, barY: a.hud.y + a.barOffset,
    })) };
  }

  heroVitals(): { hp100: number; max100: number; ward100: number; wardCap100: number } | null {
    const hero = this.actors.get("hero");
    return hero ? { hp100: hero.hp100, max100: hero.max100, ward100: hero.ward100, wardCap100: hero.wardCap100 } : null;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.resizeObserver.disconnect();
    this.app.canvas.removeEventListener("webglcontextlost", this.handleContextLost);
    this.clearScene();
    this.sprites.dispose();
    this.environment?.dispose();
    for (const t of this.glyphs.values()) t.destroy(true);
    this.background?.texture.destroy(true);
    this.app.destroy({ removeView: true }, { children: true });
  }
}

// Presentation layout metadata, shared by every species and the DEV preview.
const THREE_ENEMY_FORMATION = [
  { x: 111, rise: 0, barLift: 0 },
  { x: 150, rise: -12, barLift: 6 },
  { x: 179, rise: 0, barLift: 12 },
] as const;
function slotPositions(count: number, width: number): number[] {
  const offset = (width - 224) / 2;
  if (count <= 1) return [Math.round(offset + 145)];
  if (count === 2) return [Math.round(offset + 119), Math.round(offset + 171)];
  return THREE_ENEMY_FORMATION.map(slot => Math.round(offset + slot.x));
}

export interface ArtPreviewScene {
  hero: string;
  enemies: string[];
  pose: Pose;
  effect: string;
  timeMs: number;
}
