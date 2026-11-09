import type { Graphics } from "pixi.js";

/** Small, pixel-snapped accents. All timing comes from combat playback, never simulation. */
export type AttackStyle = "slash" | "palm" | "arcane" | "arrow" | "fang" | "venom" | "fire" | "earth";
export type EffectPoint = readonly [number, number];

export function attackStyle(sprite: string): AttackStyle {
  switch (sprite) {
    case "warrior": case "warlord": case "warden": return "slash";
    case "monk": return "palm";
    case "mage": case "wisp": return "arcane";
    case "ranger": return "arrow";
    case "wolf": case "hound": return "fang";
    case "spider": case "matron": case "slime": return "venom";
    case "imp": case "drake": return "fire";
    default: return "earth";
  }
}

const PALETTES: Record<AttackStyle, readonly [number, number]> = {
  slash: [0xffc478, 0xfff3d4], palm: [0x5edbd1, 0xd8fff3],
  arcane: [0xb48aff, 0xf3e3ff], arrow: [0x92d879, 0xf1ffd8],
  fang: [0xe59691, 0xffe3d3], venom: [0x92cd50, 0xe6ffad],
  fire: [0xff853c, 0xffe8a6], earth: [0xc6a173, 0xf2dfb1],
};

function pixel(g: Graphics, x: number, y: number, size: number, color: number, alpha = 1): void {
  g.rect(Math.round(x), Math.round(y), size, size).fill({ color, alpha });
}

/** Stepped strokes stay crisp at the canvas's fixed 2x CSS scale. */
function line(g: Graphics, x: number, y: number, tx: number, ty: number, color: number, size = 1, alpha = 1): void {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(tx - x), Math.abs(ty - y)) / size));
  for (let i = 0; i <= steps; i++) pixel(g, x + (tx - x) * i / steps, y + (ty - y) * i / steps, size, color, alpha);
}

function ring(g: Graphics, x: number, y: number, radius: number, color: number, alpha = 1, squash = 1): void {
  for (let i = 0; i < 24; i++) {
    const angle = i * Math.PI / 12;
    pixel(g, x + Math.cos(angle) * radius, y + Math.sin(angle) * radius * squash, 1, color, alpha);
  }
}

/** Neutral travel trail: no critical/proc information is revealed before the logged HIT. */
export function drawAttackTrail(g: Graphics, p: number, style: AttackStyle, from: EffectPoint, to: EffectPoint): void {
  g.clear();
  const [color, core] = PALETTES[style];
  const x = from[0] + (to[0] - from[0]) * p;
  const y = from[1] + (to[1] - from[1]) * p;
  const dx = to[0] - from[0], dy = to[1] - from[1];
  const length = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / length, uy = dy / length;
  for (let i = 1; i <= 7; i++) {
    const distance = Math.min(length * p, i * 3);
    const wobble = style === "arrow" ? 0 : Math.sin(p * 14 - i) * i * 0.35;
    pixel(g, x - ux * distance - uy * wobble, y - uy * distance + ux * wobble, i < 3 ? 2 : 1, color, 1 - i / 9);
  }
  if (style === "arrow") {
    line(g, x - ux * 9, y - uy * 9, x, y, core);
    line(g, x - ux * 3 - uy * 2, y - uy * 3 + ux * 2, x, y, core);
    line(g, x - ux * 3 + uy * 2, y - uy * 3 - ux * 2, x, y, core);
  } else {
    pixel(g, x - 2, y - 2, 4, color, 0.4);
    pixel(g, x - 1, y - 1, 2, core);
    if (style === "arcane") ring(g, from[0], from[1], 3 + p * 7, color, (1 - p) * 0.7, 1.3);
  }
}

export function drawAttackImpact(
  g: Graphics, p: number, style: AttackStyle, from: EffectPoint, to: EffectPoint,
  critical: boolean, technique: boolean,
): void {
  g.clear();
  const [color, pale] = PALETTES[style];
  const core = critical ? 0xfff0ab : pale;
  const strength = critical ? 1.35 : technique ? 1.15 : 1;
  const fade = (1 - p) ** 1.4;
  const [x, y] = to;
  const direction = to[0] >= from[0] ? 1 : -1;
  g.alpha = fade;

  if (style === "slash") {
    // A curved blade sweep, with a fine bright edge and a warm trailing edge.
    const radius = (14 + p * 7) * strength;
    const sweep = Math.min(1, p * 4);
    for (let i = 0; i < 24; i++) {
      const t = i / 23;
      if (t > sweep) break;
      const angle = -1.25 + t * 2.5;
      const sx = x + direction * (Math.cos(angle) * radius - 9);
      const sy = y + Math.sin(angle) * radius;
      pixel(g, sx - direction * 2, sy, 3, color, 0.45);
      pixel(g, sx, sy, 2, core);
    }
    if (technique) line(g, x - 9 * direction, y + 10, x + 9 * direction, y - 10, core, 1, 0.7);
  } else if (style === "palm") {
    ring(g, x, y, (4 + p * 20) * strength, color);
    ring(g, x, y, (2 + p * 12) * strength, core, 0.8);
    for (let i = -1; i <= 1; i++) {
      line(g, x - direction * (18 - p * 6), y + i * 4, x - direction * 3, y + i * 2, core, 1, 0.7);
    }
  } else if (style === "arcane") {
    ring(g, x, y, (5 + p * 15) * strength, color, 0.85);
    const r = (6 + p * 9) * strength;
    line(g, x - r, y, x + r, y, core);
    line(g, x, y - r, x, y + r, core);
    ring(g, x, y, (3 + p * 8) * strength, core, 0.8);
  } else if (style === "arrow") {
    // A tapered streak through the contact point reads as arrow momentum.
    line(g, x - direction * 13, y + 3, x + direction * (6 + p * 13), y - 4, color, 2, 0.7);
    line(g, x - direction * 6, y + 1, x + direction * (7 + p * 13), y - 4, core);
    if (technique) ring(g, x, y, 4 + p * 12, color, 0.7, 0.7);
  } else if (style === "fang") {
    for (let i = -1; i <= 1; i++) line(g, x - 7 + i * 5, y - 9, x + 2 + i * 5, y + 6 + p * 4, core, 1);
  } else if (style === "venom") {
    ring(g, x, y + 4, 4 + p * 13, color, 0.8, 0.45);
    for (let i = 0; i < 5; i++) {
      const angle = Math.PI + i * Math.PI / 4;
      pixel(g, x + Math.cos(angle) * (3 + p * 15), y + Math.sin(angle) * p * 18 + p * p * 12, 2, i % 2 ? core : color);
    }
  } else if (style === "fire") {
    for (let i = 0; i < 5; i++) {
      const xx = x + (i - 2) * (2 + p * 3);
      line(g, xx, y + 5 - p * 8, xx + direction * 3, y - 3 - p * (12 + i % 2 * 7), i % 2 ? core : color, 2);
    }
  } else {
    ring(g, x, y + 5, 4 + p * 17, color, 0.8, 0.4);
    for (let i = -2; i <= 2; i++) pixel(g, x + i * (3 + p * 5), y - Math.sin(p * Math.PI) * (8 - Math.abs(i)) + 5, 2, core);
  }

  // A brief contact glint and a restrained spray of pixel sparks.
  if (p < 0.32) {
    const r = Math.max(1, Math.round((1 - p / 0.32) * 4 * strength));
    line(g, x - r, y, x + r, y, core);
    line(g, x, y - r, x, y + r, core);
  }
  const count = critical ? 10 : 5;
  for (let i = 0; i < count; i++) {
    const angle = i * Math.PI * 2 / count + 0.35;
    const distance = (4 + p * (12 + i % 3 * 3)) * strength;
    pixel(g, x + Math.cos(angle) * distance, y + Math.sin(angle) * distance + p * p * 5, i % 3 === 0 ? 2 : 1, critical ? core : color);
  }
}
