import type { CombatEvent, ContentConfig, DamageType, FightOutcome, MechanicDef } from "@emberbound/shared-types";
import type { HeroStats } from "../character/stats";
import type { EnemyInit } from "../encounter/budget";
import { BP, mulDivFloor, mulDivRound } from "../math/fixed";
import { Prng } from "../math/prng";
import type { RuleEffects } from "../rules/modifiers";

/**
 * Deterministic, event-driven combat simulation.
 *
 * TIME: integer milliseconds on a simulation clock starting at 0. The loop
 * jumps from one scheduled moment to the next (attacks, DoT ticks, status
 * expiries). No wall-clock, no frame rate, no floats.
 *
 * ORDER AT THE SAME MOMENT (documented tie-break rules):
 *   1. DoT ticks        (actors: hero, e0, e1, e2; statuses in application order)
 *   2. Status expiries  (same actor/status order)
 *   3. Attacks          (hero first, then enemies by index)
 * A DoT tick that lands exactly on its expiry time still happens.
 *
 * RNG DRAW ORDER per damage instance: variance, then crit.
 * Chance rolls only consume randomness when 0 < chance < 100%.
 * Mechanics run in definition order: class techniques, then item effects by slot.
 *
 * C2 mechanics (Warrior, Ranger):
 * - execute / armor_pierce modify every direct hero hit (no RNG draws).
 * - on_damaged_retaliate runs after an enemy basic attack damages the hero. Its damage
 *   never triggers on-hit effects or another retaliation, so it cannot loop.
 * - nth_attack_split and retaliation may apply the class's own on-hit DoTs (appliesDots);
 *   they never trigger other on-hit mechanics.
 * - stack_burst consumes a hero DoT line on the struck target.
 *
 * C2 Mage ward:
 * - ward: the hero starts every fight with a ward (share of max HP); every Nth hero attack
 *   adds a share of attack, up to a cap. Enemy hits and DoT ticks on the hero drain the ward
 *   after armor and minimum damage, then HP. Draws no randomness. Without a ward mechanic the
 *   fight, its events and its summary are exactly as before (no ward fields at all).
 *
 * The full fight is simulated in one call. A fight never changes after it
 * starts (build snapshot rule), so presentation can play the event log back
 * at any speed without influencing the result.
 */

export interface FightInput {
  seed: number;
  hero: HeroStats;
  /** Optional companions act after the lead, in snapshot order. */
  companions?: readonly [HeroStats, HeroStats];
  /** HP at fight start (x100). null = full. Clamped to [1, max]. */
  startHp100: number | null;
  enemies: EnemyInit[];
  effects: RuleEffects;
  config: ContentConfig;
}

export interface EventSink {
  /** When false, the engine skips building event objects (offline catch-up). */
  readonly recording: boolean;
  push(event: CombatEvent): void;
}

export class ArraySink implements EventSink {
  readonly recording = true;
  readonly events: CombatEvent[] = [];
  push(event: CombatEvent): void {
    this.events.push(event);
  }
}

export const NULL_SINK: EventSink = {
  recording: false,
  push() {
    /* discard */
  },
};

export interface FightCounters {
  heroAttacks: number;
  heroHits: number;
  enemyAttacks: number;
  crits: number;
  damageDealt100: number;
  damageTaken100: number;
  healing100: number;
  overheal100: number;
  damageBasic100: number;
  damageClass100: number;
  damageItem100: number;
  damageDot100: number;
  procs: Record<string, number>;
  /** Damage absorbed by the hero's ward (C2). Present only when the kit has a ward. */
  absorbed100?: number;
}

export interface ActorFinal {
  id: string;
  hp100: number;
  maxHp100: number;
  alive: boolean;
  statuses: { status: string; stacks: number; until: number }[];
}

export interface FightSummary {
  outcome: FightOutcome;
  durationMs: number;
  hero: ActorFinal;
  party?: ActorFinal[];
  enemies: ActorFinal[];
  counters: FightCounters;
  eventCount: number;
  rngDraws: number;
}

type SourceKind = "basic" | "class" | "item" | "enemy";

interface StatusState {
  statusId: string;
  kind: "dot" | "haste";
  stacks: number;
  maxStacks: number;
  perStack100: number;
  tickMs: number;
  nextTickAt: number;
  expiresAt: number;
  hasteBp: number;
  sourceKind: SourceKind;
  seq: number;
  ownerId?: string;
}

interface ActorState {
  id: string;
  isHero: boolean;
  hp100: number;
  maxHp100: number;
  attack100: number;
  armor: number;
  attackRateMilli: number;
  critBp: number;
  damageType: DamageType;
  nextAttackAt: number;
  alive: boolean;
  statuses: StatusState[];
}

interface HeroRuntime extends ActorState {
  mechanics: readonly MechanicDef[];
  sources: readonly ("class" | "item")[];
  executes: Extract<MechanicDef, { kind: "execute" }>[];
  pierceBp: number;
  hasWard: boolean;
  ward100: number;
  wardCap100: number;
  readyAt: number[];
  hitCount: number;
  attackCount: number;
}

const NEVER = Number.MAX_SAFE_INTEGER;

export function simulateFight(input: FightInput, sink: EventSink): FightSummary {
  const { hero: heroStats, config: cfg, effects } = input;
  const rng = new Prng(input.seed);
  const rec = sink.recording;
  let eventCount = 0;
  const emit = (event: CombatEvent): void => {
    eventCount += 1;
    sink.push(event);
  };

  const counters: FightCounters = {
    heroAttacks: 0,
    heroHits: 0,
    enemyAttacks: 0,
    crits: 0,
    damageDealt100: 0,
    damageTaken100: 0,
    healing100: 0,
    overheal100: 0,
    damageBasic100: 0,
    damageClass100: 0,
    damageItem100: 0,
    damageDot100: 0,
    procs: {},
  };

  const startHp =
    input.startHp100 === null
      ? heroStats.maxHp100
      : Math.min(heroStats.maxHp100, Math.max(1, input.startHp100));

  function initializeHero(stats: HeroStats, id: string, hp100: number): HeroRuntime {
    const actor: HeroRuntime = {
      id, isHero: true, hp100, maxHp100: stats.maxHp100, attack100: stats.attack100,
      armor: stats.armor, attackRateMilli: stats.attackRateMilli, critBp: stats.critBp, damageType: stats.damageType,
      nextAttackAt: cfg.heroFirstAttackMs, alive: true, statuses: [], mechanics: stats.mechanics, sources: stats.mechanicSources,
      executes: [], pierceBp: 0, hasWard: false, ward100: 0, wardCap100: 0,
      readyAt: stats.mechanics.map(() => 0), hitCount: 0, attackCount: 0,
    };
    for (const m of stats.mechanics) {
      if (m.kind === "execute") actor.executes.push(m);
      if (m.kind === "armor_pierce") actor.pierceBp = Math.min(BP, actor.pierceBp + m.pierceBp);
      if (m.kind !== "ward") continue;
      actor.hasWard = true;
      actor.ward100 += mulDivFloor(stats.maxHp100, m.startBp, BP);
      actor.wardCap100 = Math.max(actor.wardCap100, mulDivFloor(stats.maxHp100, m.capBp, BP));
    }
    actor.ward100 = Math.min(actor.ward100, actor.wardCap100);
    if (actor.hasWard) counters.absorbed100 = 0;
    return actor;
  }

  const hero = initializeHero(heroStats, "hero", startHp);
  const heroes = [hero, ...(input.companions ?? []).map((stats, index) => initializeHero(stats, `hero${index + 1}`, stats.maxHp100))];

  const enemies: ActorState[] = input.enemies.map((e) => ({
    id: e.id,
    isHero: false,
    hp100: e.maxHp100,
    maxHp100: e.maxHp100,
    attack100: e.hitDamage100,
    armor: e.armor,
    attackRateMilli: e.attackRateMilli,
    critBp: 0,
    damageType: e.damageType,
    nextAttackAt: 0,
    alive: true,
    statuses: [],
  }));
  const actors: ActorState[] = [...heroes, ...enemies];
  const asHero = (actor: ActorState): HeroRuntime | undefined => actor.isHero ? actor as HeroRuntime : undefined;
  let statusSeq = 0;
  let t = 0;

  const bump = (id: string): void => {
    counters.procs[id] = (counters.procs[id] ?? 0) + 1;
  };

  const hasteOf = (actor: ActorState): number => {
    let total = 0;
    for (const s of actor.statuses) if (s.kind === "haste") total += s.hasteBp;
    return total;
  };

  const intervalOf = (actor: ActorState): number =>
    Math.max(
      cfg.minAttackIntervalMs,
      mulDivRound(1_000_000, BP, actor.attackRateMilli * (BP + hasteOf(actor))),
    );

  for (const e of enemies) {
    e.nextAttackAt = intervalOf(e) + cfg.enemyStaggerMs * (enemies.indexOf(e) + 1);
  }

  if (rec) {
    for (const ally of heroes) {
      emit({ t: 0, type: "spawn", actor: ally.id, hp: ally.hp100, max: ally.maxHp100 });
      if (ally.hasWard) emit({ t: 0, type: "ward", tgt: ally.id, amt: ally.ward100, via: "start", ward: ally.ward100, cap: ally.wardCap100 });
    }
    for (const [i, e] of input.enemies.entries()) {
      emit({ t: 0, type: "spawn", actor: e.id, archetype: e.archetypeId, hp: e.maxHp100, max: e.maxHp100, slot: i });
    }
  }

  const firstAliveEnemy = (): ActorState | null => {
    for (const e of enemies) if (e.alive) return e;
    return null;
  };
  const aliveOr = (preferred: ActorState): ActorState | null => (preferred.alive ? preferred : firstAliveEnemy());
  const otherAlive = (target: ActorState): ActorState | null => {
    const start = enemies.indexOf(target);
    for (let step = 1; step < enemies.length; step += 1) {
      const candidate = enemies[(start + step) % enemies.length];
      if (candidate && candidate.alive && candidate !== target) return candidate;
    }
    return null;
  };

  const kill = (actor: ActorState): void => {
    actor.alive = false;
    actor.statuses = [];
    actor.nextAttackAt = NEVER;
    if (rec) emit({ t, type: "death", actor: actor.id });
  };

  /** Damage to the hero after the ward has taken its share (the ward is drained first). */
  const absorb = (ally: HeroRuntime, amount: number): number => {
    if (ally.ward100 <= 0) return amount;
    const taken = Math.min(ally.ward100, amount);
    ally.ward100 -= taken;
    counters.absorbed100 = (counters.absorbed100 ?? 0) + taken;
    return amount - taken;
  };

  const sourceCounter = (kind: SourceKind, amount: number): void => {
    switch (kind) {
      case "basic":
        counters.damageBasic100 += amount;
        break;
      case "class":
        counters.damageClass100 += amount;
        break;
      case "item":
        counters.damageItem100 += amount;
        break;
      case "enemy":
        break;
    }
  };

  const dealDamage = (
    src: ActorState,
    tgt: ActorState,
    base100: number,
    damageType: DamageType,
    via: string,
    kind: SourceKind,
  ): void => {
    let dmg = base100;
    if (cfg.damageVarianceBp > 0) {
      const roll = rng.nextInt(cfg.damageVarianceBp * 2 + 1);
      dmg = mulDivRound(dmg, BP - cfg.damageVarianceBp + roll, BP);
    }
    let crit = 0;
    if (rng.rollBp(src.critBp)) {
      crit = 1;
      dmg = mulDivRound(dmg, cfg.critMultiplierBp, BP);
      if (src.isHero) counters.crits += 1;
    }
    let armor = damageType === "magic" ? mulDivFloor(tgt.armor, 1, 2) : tgt.armor;
    const attacker = asHero(src);
    if (attacker) {
      // Execute checks the target of this hit, before the hit lands.
      for (const m of attacker.executes) {
        if (tgt.hp100 * BP <= m.thresholdBp * tgt.maxHp100) {
          dmg = mulDivRound(dmg, BP + m.bonusBp, BP);
          bump(m.id);
        }
      }
      if (attacker.pierceBp > 0) armor -= mulDivFloor(armor, attacker.pierceBp, BP);
    }
    dmg = Math.max(cfg.minDamage100, mulDivRound(dmg, 100, 100 + armor));
    const defender = asHero(tgt);
    const toHp = defender?.hasWard ? absorb(defender, dmg) : dmg;
    const before = tgt.hp100;
    tgt.hp100 = Math.max(0, before - toHp);
    const effective = before - tgt.hp100;
    if (src.isHero) {
      counters.damageDealt100 += effective;
      sourceCounter(kind, effective);
    } else {
      counters.damageTaken100 += effective;
    }
    if (rec) {
      if (defender?.hasWard) {
        emit({ t, type: "hit", src: src.id, tgt: tgt.id, amt: dmg, eff: effective, crit, via, dmg: damageType, hp: tgt.hp100, abs: dmg - toHp, ward: defender.ward100 });
      } else {
        emit({ t, type: "hit", src: src.id, tgt: tgt.id, amt: dmg, eff: effective, crit, via, dmg: damageType, hp: tgt.hp100 });
      }
    }
    if (tgt.hp100 === 0) kill(tgt);
  };

  const heal = (actor: ActorState, amount: number, via: string): void => {
    const before = actor.hp100;
    actor.hp100 = Math.min(actor.maxHp100, before + amount);
    const effective = actor.hp100 - before;
    counters.healing100 += effective;
    counters.overheal100 += amount - effective;
    if (rec) emit({ t, type: "heal", tgt: actor.id, amt: amount, eff: effective, via, hp: actor.hp100 });
  };

  const findStatus = (actor: ActorState, statusId: string, ownerId?: string): StatusState | undefined =>
    actor.statuses.find((s) => s.statusId === statusId && s.ownerId === ownerId);

  /** Direct damage without variance, crit or armor (like a DoT tick), from the hero. */
  const dealPureDamage = (hero: HeroRuntime, tgt: ActorState, amount100: number, via: string, kind: SourceKind): void => {
    const before = tgt.hp100;
    tgt.hp100 = Math.max(0, before - amount100);
    const effective = before - tgt.hp100;
    counters.damageDealt100 += effective;
    sourceCounter(kind, effective);
    if (rec) emit({ t, type: "hit", src: hero.id, tgt: tgt.id, amt: amount100, eff: effective, crit: 0, via, dmg: "pure", hp: tgt.hp100 });
    if (tgt.hp100 === 0) kill(tgt);
  };

  const removeStatus = (actor: ActorState, status: StatusState): void => {
    actor.statuses = actor.statuses.filter((s) => s !== status);
    if (rec) emit({ t, type: "status_end", tgt: actor.id, status: status.statusId });
  };

  const applyHaste = (actor: ActorState, statusId: string, hasteBp: number, durationMs: number, kind: SourceKind): void => {
    const existing = findStatus(actor, statusId);
    if (existing) {
      existing.expiresAt = t + durationMs;
      existing.hasteBp = hasteBp;
    } else {
      statusSeq += 1;
      actor.statuses.push({
        statusId,
        kind: "haste",
        stacks: 1,
        maxStacks: 1,
        perStack100: 0,
        tickMs: 0,
        nextTickAt: NEVER,
        expiresAt: t + durationMs,
        hasteBp,
        sourceKind: kind,
        seq: statusSeq,
      });
    }
    if (rec) emit({ t, type: "status", tgt: actor.id, status: statusId, stacks: 1, until: t + durationMs, haste: hasteBp });
  };

  const applyDot = (
    hero: HeroRuntime,
    target: ActorState,
    m: Extract<MechanicDef, { kind: "on_hit_dot" }>,
    perStack100: number,
    kind: SourceKind,
  ): void => {
    const ownerId = input.companions ? hero.id : undefined;
    const existing = findStatus(target, m.statusId, ownerId);
    let stacks = 1;
    if (existing) {
      existing.stacks = Math.min(existing.maxStacks, existing.stacks + 1);
      existing.maxStacks = m.maxStacks;
      existing.perStack100 = perStack100;
      existing.expiresAt = t + m.durationMs;
      stacks = existing.stacks;
    } else {
      statusSeq += 1;
      target.statuses.push({
        statusId: m.statusId,
        kind: "dot",
        stacks: 1,
        maxStacks: m.maxStacks,
        perStack100,
        tickMs: m.tickMs,
        nextTickAt: t + m.tickMs,
        expiresAt: t + m.durationMs,
        hasteBp: 0,
        sourceKind: kind,
        seq: statusSeq,
        ...(ownerId ? { ownerId } : {}),
      });
    }
    if (rec) emit({ t, type: "status", tgt: target.id, status: m.statusId, stacks, until: t + m.durationMs, ...(ownerId ? { src: ownerId } : {}) });
  };

  /** The class's own on-hit DoTs, applied by split shots and retaliation (never item DoTs). */
  const applyClassDots = (hero: HeroRuntime, target: ActorState): void => {
    for (let j = 0; j < hero.mechanics.length; j += 1) {
      const d = hero.mechanics[j];
      if (!d || d.kind !== "on_hit_dot" || hero.sources[j] !== "class") continue;
      if (!target.alive) return;
      if (!rng.rollBp(d.chanceBp)) continue;
      applyDot(hero, target, d, mulDivRound(hero.attack100, d.potencyBp, BP), "class");
      bump(d.id);
    }
  };

  /** Other living enemies after `primary`, in slot order (wrapping), at most `count`. */
  const otherTargets = (primary: ActorState, count: number): ActorState[] => {
    const out: ActorState[] = [];
    const start = enemies.indexOf(primary);
    for (let step = 1; step < enemies.length && out.length < count; step += 1) {
      const candidate = enemies[(start + step) % enemies.length];
      if (candidate && candidate.alive && candidate !== primary) out.push(candidate);
    }
    return out;
  };

  const heroAttack = (hero: HeroRuntime): void => {
    const { mechanics, sources, readyAt } = hero;
    const target = firstAliveEnemy();
    if (!target) return;
    hero.attackCount += 1;
    counters.heroAttacks += 1;
    if (rec) emit({ t, type: "attack", src: hero.id, tgt: target.id });
    dealDamage(hero, target, hero.attack100, hero.damageType, "basic", "basic");
    hero.hitCount += 1;
    counters.heroHits += 1;

    for (let i = 0; i < mechanics.length; i += 1) {
      const m = mechanics[i];
      if (!m) continue;
      const kind: SourceKind = sources[i] ?? "class";
      if (!hero.alive) break;
      switch (m.kind) {
        case "nth_hit_heal": {
          if (hero.hitCount % m.every === 0 && t >= (readyAt[i] ?? 0)) {
            heal(hero, mulDivRound(hero.attack100, m.potencyBp, BP), m.id);
            readyAt[i] = t + m.cooldownMs;
            bump(m.id);
          }
          break;
        }
        case "nth_hit_extra_damage": {
          if (hero.hitCount % m.every !== 0) break;
          if (m.requiresStatus !== undefined && !findStatus(hero, m.requiresStatus)) break;
          const tgt = aliveOr(target);
          if (!tgt) break;
          if (m.requiresTargetHpBelowBp !== undefined && tgt.hp100 * BP > m.requiresTargetHpBelowBp * tgt.maxHp100) break;
          dealDamage(hero, tgt, mulDivRound(hero.attack100, m.potencyBp, BP), m.damageType, m.id, kind);
          bump(m.id);
          break;
        }
        case "nth_hit_haste": {
          if (hero.hitCount % m.every !== 0) break;
          applyHaste(hero, m.statusId, m.hasteBp, m.durationMs, kind);
          bump(m.id);
          break;
        }
        case "on_hit_dot": {
          if (!target.alive) break;
          if (!rng.rollBp(m.chanceBp)) break;
          applyDot(hero, target, m, mulDivRound(hero.attack100, m.potencyBp, BP), kind);
          bump(m.id);
          break;
        }
        case "nth_attack_splash": {
          if (hero.attackCount % m.every !== 0) break;
          const alive = enemies.filter((e) => e.alive);
          if (alive.length === 0) break;
          for (const e of alive) {
            dealDamage(hero, e, mulDivRound(hero.attack100, m.potencyBp, BP), m.damageType, m.id, kind);
          }
          bump(m.id);
          break;
        }
        case "on_hit_echo": {
          if (!rng.rollBp(m.chanceBp)) break;
          const tgt = aliveOr(target);
          if (!tgt) break;
          dealDamage(hero, tgt, mulDivRound(hero.attack100, m.potencyBp, BP), m.damageType, m.id, kind);
          bump(m.id);
          break;
        }
        case "on_hit_chain": {
          if (!rng.rollBp(m.chanceBp)) break;
          const tgt = otherAlive(target) ?? aliveOr(target);
          if (!tgt) break;
          dealDamage(hero, tgt, mulDivRound(hero.attack100, m.potencyBp, BP), m.damageType, m.id, kind);
          bump(m.id);
          break;
        }
        case "nth_attack_split": {
          if (hero.attackCount % m.every !== 0) break;
          const extra = otherTargets(target, m.targets);
          if (extra.length === 0) break;
          for (const e of extra) {
            if (!e.alive) continue;
            dealDamage(hero, e, mulDivRound(hero.attack100, m.potencyBp, BP), m.damageType, m.id, kind);
            if (m.appliesDots === 1) applyClassDots(hero, e);
          }
          bump(m.id);
          break;
        }
        case "stack_burst": {
          if (!target.alive) break;
          const s = findStatus(target, m.statusId, input.companions ? hero.id : undefined);
          if (!s || s.kind !== "dot" || s.stacks < m.minStacks) break;
          const amount = Math.max(
            cfg.minDamage100,
            mulDivRound(mulDivRound(s.perStack100 * s.stacks, m.potencyBp, BP), effects.dotDamageBp, BP),
          );
          removeStatus(target, s);
          dealPureDamage(hero, target, amount, m.id, kind);
          bump(m.id);
          break;
        }
        case "ward": {
          if (hero.attackCount % m.every !== 0) break;
          const gain = mulDivRound(hero.attack100, m.potencyBp, BP);
          const next = Math.min(hero.wardCap100, hero.ward100 + gain);
          if (next === hero.ward100) break;
          const gained = next - hero.ward100;
          hero.ward100 = next;
          bump(m.id);
          if (rec) emit({ t, type: "ward", tgt: hero.id, amt: gained, via: m.id, ward: hero.ward100, cap: hero.wardCap100 });
          break;
        }
        case "on_damaged_retaliate":
        case "execute":
        case "armor_pierce":
          break;
      }
    }
    hero.nextAttackAt = t + intervalOf(hero);
  };

  const enemyAttack = (enemy: ActorState, hero: HeroRuntime): void => {
    const { mechanics, sources, readyAt } = hero;
    counters.enemyAttacks += 1;
    if (rec) emit({ t, type: "attack", src: enemy.id, tgt: hero.id });
    // Scheduled before any retaliation, so an enemy killed by it stays unscheduled.
    enemy.nextAttackAt = t + intervalOf(enemy);
    const hpBefore = hero.hp100;
    dealDamage(enemy, hero, enemy.attack100, enemy.damageType, "basic", "enemy");
    if (hero.hp100 === hpBefore) return;
    for (let i = 0; i < mechanics.length; i += 1) {
      const m = mechanics[i];
      if (!m || m.kind !== "on_damaged_retaliate") continue;
      if (!hero.alive || !enemy.alive) break;
      if (t < (readyAt[i] ?? 0)) continue;
      if (!rng.rollBp(m.chanceBp)) continue;
      readyAt[i] = t + m.cooldownMs;
      dealDamage(hero, enemy, mulDivRound(hero.attack100, m.potencyBp, BP), m.damageType, m.id, sources[i] ?? "class");
      if (m.appliesDots === 1) applyClassDots(hero, enemy);
      bump(m.id);
    }
  };

  let outcome: FightOutcome;
  for (;;) {
    if (!heroes.some(ally => ally.alive)) {
      outcome = "defeat";
      break;
    }
    if (!firstAliveEnemy()) {
      outcome = "victory";
      break;
    }

    let next = NEVER;
    for (const actor of actors) {
      if (!actor.alive) continue;
      if (actor.nextAttackAt < next) next = actor.nextAttackAt;
      for (const s of actor.statuses) {
        if (s.kind === "dot" && s.nextTickAt < next) next = s.nextTickAt;
        if (s.expiresAt < next) next = s.expiresAt;
      }
    }
    if (next > cfg.maxFightMs) {
      t = cfg.maxFightMs;
      outcome = "timeout";
      break;
    }
    t = next;

    // 1. DoT ticks
    for (const actor of actors) {
      if (!actor.alive) continue;
      for (const s of [...actor.statuses]) {
        if (!actor.alive) break;
        if (s.kind !== "dot" || s.nextTickAt !== t) continue;
        const amount = Math.max(
          cfg.minDamage100,
          mulDivRound(s.perStack100 * s.stacks, effects.dotDamageBp, BP),
        );
        const defender = asHero(actor);
        const toHp = defender?.hasWard ? absorb(defender, amount) : amount;
        const before = actor.hp100;
        actor.hp100 = Math.max(0, before - toHp);
        const effective = before - actor.hp100;
        if (actor.isHero) {
          counters.damageTaken100 += effective;
        } else {
          counters.damageDealt100 += effective;
          counters.damageDot100 += effective;
          sourceCounter(s.sourceKind, effective);
        }
        s.nextTickAt = t + s.tickMs;
        if (rec) {
          if (defender?.hasWard) {
            emit({ t, type: "tick", tgt: actor.id, status: s.statusId, amt: amount, eff: effective, stacks: s.stacks, hp: actor.hp100, abs: amount - toHp, ward: defender.ward100 });
          } else {
            emit({ t, type: "tick", tgt: actor.id, status: s.statusId, amt: amount, eff: effective, stacks: s.stacks, hp: actor.hp100, ...(s.ownerId ? { src: s.ownerId } : {}) });
          }
        }
        if (actor.hp100 === 0) kill(actor);
      }
    }
    if (!heroes.some(ally => ally.alive) || !firstAliveEnemy()) continue;

    // 2. Status expiries
    for (const actor of actors) {
      if (!actor.alive || actor.statuses.length === 0) continue;
      const kept: StatusState[] = [];
      for (const s of actor.statuses) {
        if (s.expiresAt <= t) {
          if (rec) emit({ t, type: "status_end", tgt: actor.id, status: s.statusId });
        } else {
          kept.push(s);
        }
      }
      actor.statuses = kept;
    }

    // 3. Attacks
    for (const ally of heroes) {
      if (ally.alive && ally.nextAttackAt === t) heroAttack(ally);
    }
    for (const [index, enemy] of enemies.entries()) {
      if (!enemy.alive || enemy.nextAttackAt !== t) continue;
      const target = heroes[index % heroes.length];
      const living = target?.alive ? target : heroes.find(ally => ally.alive);
      if (!living) break;
      enemyAttack(enemy, living);
    }
  }

  if (rec) emit({ t, type: "end", outcome, hp: hero.hp100 });

  const finalOf = (a: ActorState): ActorFinal => ({
    id: a.id,
    hp100: a.hp100,
    maxHp100: a.maxHp100,
    alive: a.alive,
    statuses: a.statuses.map((s) => ({ status: s.statusId, stacks: s.stacks, until: s.expiresAt })),
  });

  return {
    outcome,
    durationMs: t,
    hero: finalOf(hero),
    ...(input.companions ? { party: heroes.map(finalOf) } : {}),
    enemies: enemies.map(finalOf),
    counters,
    eventCount,
    rngDraws: rng.draws,
  };
}
