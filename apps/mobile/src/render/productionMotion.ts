import { attackDurations, sequenceIndex, type ProductionActor } from "../art/darkwood";
import type { Pose } from "../art/types";

/** Disposable visual state. The combat event stream is never written or rescheduled. */
export class ProductionMotion {
  pose: Pose = "idle";
  start = 0;
  critical = false;
  absorbed = false;
  attackSerial = 0;
  private durations: number[] = [];
  private impactSeen = false;
  private impactUntil = 0;
  private pendingHit: boolean | null = null;
  private pendingAttack: number | null = null;
  constructor(readonly actor: ProductionActor) {}
  attack(now: number, interval: number): void {
    if (this.pose === "death") return;
    if (this.pose === "attack" && (!this.impactSeen || now < this.impactUntil)) { this.pendingAttack = interval; return; }
    this.pose = "attack"; this.start = now; this.critical = false;
    this.durations = attackDurations(this.actor.animations.attack, interval);
    this.impactSeen = false; this.impactUntil = 0; this.attackSerial++;
  }
  /** A prepared log owns visual cadence; never queue this behind an obsolete reaction. */
  scheduledAttack(now: number, interval: number): void {
    if (this.pose === "death") return;
    this.pose = "idle"; this.pendingHit = null; this.pendingAttack = null;
    this.attack(now, interval);
  }
  crit(): void {
    this.critical = true;
    if (this.pose === "attack") this.durations[2] = this.actor.animations.attack.crit_hold_ms ?? this.durations[2]!;
  }
  hit(now: number, absorbed: boolean): void {
    if (this.pose === "death") return;
    if (this.pose === "attack") this.sample(now);
    if (this.pose === "attack" && this.impactSeen && now < this.impactUntil) { this.pendingHit = absorbed; return; }
    this.pose = "hit"; this.start = now; this.absorbed = absorbed;
  }
  death(now: number): void { this.pose = "death"; this.start = now; this.pendingHit = null; this.pendingAttack = null; }
  sample(now: number): { pose: Pose; index: number; impact: boolean } {
    if (this.pose === "attack") {
      const c = this.actor.animations.attack;
      const impact = c.impact_frame ?? 1;
      let index = sequenceIndex(this.durations, now - this.start);
      if (!this.impactSeen && index >= impact) {
        this.impactSeen = true; this.impactUntil = now + (c.min_ms?.[impact] ?? c.ms[impact]!);
        // Even a slow render frame must show the entire minimum impact window.
        this.start = now - this.durations.slice(0, impact).reduce((a, b) => a + b, 0);
        index = impact;
      }
      if (this.impactSeen && now < this.impactUntil) return { pose: "attack", index: impact, impact: true };
      if (this.pendingHit !== null) {
        const absorbed = this.pendingHit; this.pendingHit = null; this.hit(now, absorbed);
      } else if (this.pendingAttack !== null) {
        const interval = this.pendingAttack; this.pendingAttack = null; this.attack(now, interval);
        return { pose: "attack", index: 0, impact: false };
      } else if (now - this.start < this.durations.reduce((a, b) => a + b, 0)) return { pose: "attack", index, impact: false };
      else { this.pose = "idle"; this.start = now; }
    }
    const c = this.actor.animations[this.pose];
    if (this.pose === "hit" && now - this.start >= (this.absorbed ? c.ms[1]! : c.ms.reduce((a, b) => a + b, 0))) { this.pose = "idle"; this.start = now; }
    const clip = this.actor.animations[this.pose];
    return { pose: this.pose, index: this.pose === "hit" && this.absorbed ? 1 : sequenceIndex(clip.ms, now - this.start, clip.loop), impact: false };
  }
}
