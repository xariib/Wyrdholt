import { actorPack } from "./darkwood";
import type { ArtAsset, Pose } from "./types";
import { bareAppearance, heroAttackName, type GearSkin, type HeroAppearance, type HeroClass } from "./gearSkins";
import { CLASS_BODIES, type ClassBody } from "./classBodies";

// Original, composable pixel art. Body and each equipment slot are separate drawing
// passes, so taking off a helmet or swapping a weapon cannot leave baked-in armor.
const ink = "#202829", skin = "#cf9e78", skinLight = "#edc39a";
type Point = readonly [number, number];
class Pixels {
  constructor(readonly ctx: CanvasRenderingContext2D, readonly map: (x: number, y: number) => Point = (x, y) => [x, y]) {}
  rect(color: string, x: number, y: number, w: number, h: number) {
    if (w <= 0 || h <= 0) return;
    const a = this.map(x, y), b = this.map(x + w, y + h);
    this.ctx.fillStyle = color;
    this.ctx.fillRect(Math.round(a[0]), Math.round(a[1]), Math.max(1, Math.round(b[0]) - Math.round(a[0])), Math.max(1, Math.round(b[1]) - Math.round(a[1])));
  }
  poly(color: string, points: readonly Point[]) {
    // Scan convert instead of antialiasing: every native pixel stays crisp at 2x/3x.
    const low = Math.min(...points.map(p => p[1])), high = Math.max(...points.map(p => p[1]));
    for (let y = low; y < high; y++) {
      const hits: number[] = [];
      points.forEach((a, i) => {
        const b = points[(i + 1) % points.length]!;
        if ((a[1] <= y + 0.5 && b[1] > y + 0.5) || (b[1] <= y + 0.5 && a[1] > y + 0.5))
          hits.push(a[0] + (y + 0.5 - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
      });
      hits.sort((a, b) => a - b);
      for (let i = 0; i + 1 < hits.length; i += 2) this.rect(color, Math.ceil(hits[i]!), y, Math.ceil(hits[i + 1]!) - Math.ceil(hits[i]!), 1);
    }
  }
  line(color: string, a: Point, b: Point, width = 1) {
    const steps = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    for (let i = 0; i <= steps; i++) {
      const t = steps ? i / steps : 0;
      this.rect(color, Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), width, width);
    }
  }
}

function head(p: Pixels, s: GearSkin) {
  const { classId: cls, tier: t, base, shade, light, trim, family } = s;
  if (t >= 2) {
    p.line(ink, [-6, -40], [4, -39], 3);
    p.line(t >= 3 ? trim : light, [-5, -40], [4, -39]);
    p.rect(shade, -5, -39, 4, 1); p.rect(trim, 2, -40, 3, 3); p.rect(light, 3, -40, 1, 1);
    if (t === 3) {
      // An uneven woven crown, with short thorns instead of identical royal prongs.
      p.line(shade, [-5, -42], [4, -41]);
      for (const [x, y] of [[-5, -43], [-1, -42], [3, -44]] as const) {
        p.line(ink, [x, y + 3], [x - 1, y], 2); p.line(trim, [x, y + 2], [x - 1, y]);
      }
    } else if (t >= 4) {
      p.poly(ink, [[-6, -44], [-3, -41], [-1, -46], [2, -42], [4, -44], [5, -38], [-6, -39]]);
      p.poly(shade, [[-5, -43], [-2, -40], [-1, -44], [2, -40], [4, -42], [4, -39], [-5, -40]]);
      p.line(trim, [-5, -43], [-4, -40]); p.line(trim, [-1, -44], [0, -40]); p.line(trim, [4, -42], [4, -39]);
      p.rect(light, -1, -44, 1, 1); p.rect(light, 3, -40, 1, 1);
    }
  } else if (cls === "monk") {
    p.rect(ink, -6, -40, 12, 3); p.rect(base, -5, -39, 10, 1); p.rect(light, -4, -39, 5, 1);
    p.poly(shade, [[-5, -38], [-9, -36], [-11, -30], [-8, -32], [-7, -36]]);
    p.line(light, [-7, -37], [-9, -32]);
    if (t === 1) p.rect(trim, 3, -38, 2, 2);
  } else {
    // Linen coifs/hoods surround an open face. Only the named Watch Helm is metal.
    const metal = family === "watch_helm";
    p.poly(ink, [[-8, -30], [-8, -39], [-4, -45], [1, -45], [6, -41], [7, -38], [3, -38], [-2, -40], [-4, -36], [-3, -31]]);
    p.poly(metal ? "#6d8384" : shade, [[-7, -31], [-7, -39], [-3, -44], [1, -44], [5, -41], [6, -39], [3, -39], [-2, -41], [-5, -36], [-4, -32]]);
    p.poly(metal ? "#9fafa4" : base, [[-6, -40], [-3, -43], [1, -43], [4, -41], [-2, -42], [-5, -39]]);
    p.line(metal ? "#d0d5ba" : light, [-4, -42], [0, -43]);
    p.line(metal ? "#9fafa4" : base, [-6, -38], [-5, -33]);
    if (cls === "mage") {
      p.rect(base, -8, -31, 3, 5); p.rect(light, -5, -38, 1, 6);
      if (family === "scribe_hood") { p.rect(trim, -6, -39, 2, 2); p.rect(trim, -5, -36, 1, 1); }
    }
    if (cls === "ranger" && t) p.line(trim, [-6, -39], [-10, -43], 1);
  }
}

function chest(p: Pixels, s: GearSkin) {
  const { classId: cls, tier: t, base, shade, light, trim, family } = s;
  const robe = cls === "mage", plate = cls === "warrior" && t >= 2;
  if ((robe && t >= 1) || ((cls === "ranger" || cls === "warrior") && t >= 2)) {
    p.poly(ink, [[-7, -29], [-11, -24], [-13, -7], [-5, -9], [3, -7], [7, -11], [5, -26]]);
    p.poly(shade, [[-7, -28], [-10, -23], [-12, -8], [-4, -10], [5, -9], [4, -25]]);
    p.line(base, [-8, -25], [-10, -10]);
  }
  const hem = robe ? -3 : cls === "ranger" ? -9 : -11;
  p.poly(ink, [[-7, -29], [4, -29], [9, -25], [5, -17], [8, hem - 1], [2, hem], [-1, hem - 2], [-9, hem], [-7, -18], [-10, -25]]);
  p.poly(shade, [[-6, -28], [4, -28], [8, -25], [4, -17], [7, hem - 2], [2, hem - 1], [-1, hem - 3], [-8, hem - 1], [-6, -19], [-9, -25]]);
  p.poly(base, [[-5, -28], [1, -28], [6, -25], [2, -18], [4, hem - 2], [0, hem - 2], [-3, -18], [-6, -23]]);
  p.poly(light, [[-5, -27], [-2, -28], [0, -26], [-4, -23], [-6, -24]]);
  p.line(base, [-5, -16], [-6, hem - 2]); p.line(light, [-2, -15], [-1, hem - 3]);
  if (cls === "monk") {
    p.poly(light, [[-5, -28], [-3, -29], [5, -19], [3, -18]]);
    p.line(shade, [4, -28], [-3, -19]);
    if (family === "temple_vest") p.rect(trim, 2, -24, 3, 3);
  } else if (plate) {
    p.poly(ink, [[-5, -28], [3, -28], [7, -25], [5, -20], [0, -18], [-6, -21]]);
    p.poly(shade, [[-4, -27], [3, -27], [6, -25], [4, -21], [0, -19], [-5, -22]]);
    p.poly(base, [[-4, -26], [1, -27], [4, -25], [2, -21], [0, -20], [-4, -22]]);
    p.line(light, [-4, -26], [0, -27]); p.line(light, [-3, -25], [-3, -23]);
    p.line(light, [0, -26], [2, -23]); p.line(trim, [-4, -21], [0, -19]);
    for (const y of [-18, -12]) { p.line(ink, [-6, y], [5, y]); p.line(base, [-5, y + 1], [3, y + 1]); }
    p.poly(ink, [[-10, -27], [-8, -30], [-4, -29], [-3, -24], [-9, -23]]);
    p.poly(base, [[-9, -27], [-7, -29], [-5, -28], [-4, -25], [-8, -24]]); p.line(light, [-8, -28], [-5, -28]);
    if (family === "bastion_mail") for (let y = -23; y < -16; y += 2) { p.rect(light, -2, y, 1, 1); p.rect(light, 1, y + 1, 1, 1); }
  } else {
    p.line(shade, [0, -26], [0, robe ? -6 : -14]);
    p.rect(light, 1, -25, 1, 1); p.rect(light, 1, -22, 1, 1);
    if (cls === "ranger") {
      p.poly(ink, [[-7, -30], [-2, -31], [5, -28], [7, -25], [-1, -23], [-8, -26]]);
      p.poly(base, [[-6, -29], [-2, -30], [4, -27], [5, -26], [-1, -25], [-7, -27]]);
      p.line(light, [-5, -29], [-1, -28]); p.line(shade, [-6, -27], [0, -25]);
      p.line("#443b31", [-5, -26], [5, -16], 3); p.line("#a78b64", [-5, -26], [5, -16]);
      p.rect(trim, 1, -21, 2, 2);
    }
  }
  p.rect(ink, -7, -16, 14, 3); p.rect("#68503b", -6, -15, 12, 2);
  p.rect(t > 0 ? trim : "#a58c67", 2, -15, 2, 2);
  if (t >= 2) {
    p.line(trim, [-7, hem - 2], [-3, hem - 2]); p.line(trim, [2, hem - 2], [6, hem - 2]);
    if (robe) { p.line(trim, [4, -25], [4, -17]); p.line(trim, [4, -12], [5, -7]); }
    if (cls === "monk") { p.poly(shade, [[1, -14], [4, -14], [6, -7], [2, -5]]); p.line(trim, [2, -13], [3, -7]); }
  }
  if (t >= 3) { p.rect(trim, 1, -24, 3, 3); p.rect(light, 2, -24, 1, 1); }
}

function boots(p: Pixels, s: GearSkin, x: number, y: number, tone = skin, highlight = skinLight) {
  const sandal = s.classId === "monk" && s.tier < 2;
  p.rect(ink, x - 1, y - (sandal ? 1 : 5), 7, sandal ? 3 : 7);
  p.rect(sandal ? tone : s.shade, x, y - (sandal ? 1 : 4), 4, sandal ? 2 : 5);
  p.rect(sandal ? highlight : s.base, x + 1, y - (sandal ? 1 : 4), 3, sandal ? 1 : 4);
  p.rect(sandal ? "#8e7250" : s.light, x + 1, y, 4, 1);
  p.rect(s.tier ? s.trim : "#75604b", x, y - (sandal ? 1 : 4), 4, 1);
  if (s.tier >= 2) p.rect(s.trim, x + 2, y - 2, 1, 1);
  if (s.family === "courtyard_sandals") { p.rect("#584e3f", x + 2, y - 1, 1, 2); p.rect(s.trim, x, y - 3, 3, 1); }
  if (s.family === "ghostwalk") p.rect(s.trim, x + 4, y - 3, 2, 1);
}

function glove(p: Pixels, s: GearSkin, hand: Point, tone = skin) {
  const [x, y] = hand;
  p.rect(ink, x - 1, y - 2, 6, 6); p.rect(s.shade, x, y - 1, 4, 4);
  // Wrist cuffs remain visible underneath a Monk's separate weapon wraps.
  p.rect(ink, x - 1, y - 5, 5, 4); p.rect(s.base, x, y - 4, 3, 3); p.rect(s.light, x, y - 4, 3, 1);
  if (s.tier >= 1) p.rect(s.trim, x + 1, y - 2, 2, 1);
  p.rect(s.base, x + 1, y - 1, 3, 3); p.rect(s.light, x, y - 1, 4, 1);
  if (s.classId === "monk") { p.rect(s.light, x, y + 1, 4, 1); p.rect(tone, x + 3, y, 1, 2); }
  if (s.tier >= 1) p.rect(s.trim, x + 1, y + 1, 2, 1);
  if (s.family === "fletchers_gloves") p.rect(tone, x + 2, y + 2, 2, 1);
}

function weapon(p: Pixels, s: GearSkin, hand: Point, striking: boolean) {
  const [x, y] = hand, t = s.tier;
  if (s.classId === "monk") {
    p.rect(ink, x - 1, y - 1, 6, 5); p.rect(s.base, x, y, 5, 3);
    p.rect(s.light, x, y, 4, 1); p.rect(s.light, x, y + 2, 4, 1);
    if (t) p.rect(s.trim, x + 3, y, 2, 3);
    if (t >= 2) p.rect(s.shade, x + 4, y + 1, 1, 1);
  } else if (s.classId === "warrior") {
    const tip: Point = striking ? [x + 13 + t, y - 3] : [x + 7, y - 21 - t];
    const base: Point = striking ? [x + 4, y] : [x + 2, y - 5];
    p.line(ink, [x, y + 4], tip, t >= 3 ? 5 : 4);
    p.line("#9daaa9", base, tip, t >= 3 ? 3 : 2);
    p.line("#dbe0ca", [base[0] + 1, base[1]], [tip[0] + 1, tip[1]], 1);
    p.line("#76563f", [x + 1, y + 3], [base[0], base[1] + 3], 2);
    if (striking) p.line(t ? s.trim : "#96866b", [x + 3, y - 3], [x + 4, y + 5], 2);
    else p.line(t ? s.trim : "#96866b", [x - 1, y - 4], [x + 6, y - 2], 2);
    if (t >= 2) p.rect(s.trim, tip[0], tip[1] + 2, 2, 3);
  } else if (s.classId === "mage") {
    p.line(ink, [x, y + 13], [x + 3, y - 23], 4);
    p.line("#8f714e", [x + 1, y + 12], [x + 4, y - 22], 2);
    p.line("#baa17c", [x + 2, y + 8], [x + 4, y - 20]);
    p.rect(s.trim, x + 2, y - 9, 3, 2);
    if (t === 0) { p.rect(ink, x + 1, y - 23, 6, 5); p.rect("#a78a61", x + 2, y - 22, 4, 3); }
    else {
      p.poly(ink, [[x, y - 23], [x + 4, y - 28], [x + 9, y - 23], [x + 5, y - 17]]);
      p.poly(s.trim, [[x + 1, y - 23], [x + 4, y - 27], [x + 8, y - 23], [x + 5, y - 19]]);
      p.line(s.light, [x + 4, y - 26], [x + 4, y - 21]);
      if (t >= 3) { p.rect(s.trim, x - 1, y - 24, 1, 6); p.rect(s.trim, x + 9, y - 24, 1, 6); }
    }
  } else {
    const bend = 6 + Math.min(t, 3), length = 12 + t;
    const points: Point[] = [[x + 2, y - length], [x + bend, y - 7], [x + bend + 1, y], [x + bend, y + 7], [x + 2, y + length]];
    for (let i = 1; i < points.length; i++) { p.line(ink, points[i - 1]!, points[i]!, 3); p.line(t >= 2 ? s.base : "#a68a61", points[i - 1]!, points[i]!, 2); }
    p.line("#d0c7a7", points[0]!, [striking ? x - 5 : x + 2, y]);
    p.line("#d0c7a7", [striking ? x - 5 : x + 2, y], points[4]!);
    p.rect(t ? s.trim : "#6b513c", x + bend, y - 2, 3, 5);
    if (striking) { p.line("#d9ccb0", [x - 5, y], [x + 15, y]); p.poly("#bfc7c5", [[x + 14, y - 2], [x + 18, y], [x + 14, y + 2]]); }
    if (t >= 2) { p.rect(s.trim, x + 3, y - length, 2, 3); p.rect(s.trim, x + 3, y + length - 2, 2, 3); }
  }
}

function face(p: Pixels, b: ClassBody, cls: HeroClass, sway: number) {
  // A small three-quarter face: lit brow/cheek, a one-pixel nose and a shaded jaw.
  // Keep the eyes and mouth separate so the face reads at the actual 2x game scale.
  p.poly(ink, [[-3, -34], [3, -34], [3, -28], [-4, -28]]);
  p.rect(b.skinShade, -2, -33, 4, 5); p.rect(b.skin, 0, -32, 2, 3);
  if (cls === "mage" || cls === "ranger") {
    p.poly(ink, [[-5, -41], [-8, -36], [-8 - sway, -29], [-4, -27], [-2, -34]]);
    p.poly(b.hair, [[-5, -40], [-7, -35], [-7 - sway, -30], [-5, -29], [-3, -35]]);
    p.line(b.hairLight, [-6, -36], [-6 - sway, -31]);
  }
  p.poly(ink, [[-4, -43], [1, -44], [5, -41], [5, -37], [7, -35], [5, -34], [4, -31], [0, -30], [-5, -33], [-6, -39]]);
  p.poly(b.skinShade, [[-4, -41], [0, -43], [4, -40], [4, -36], [6, -35], [4, -34], [3, -32], [0, -31], [-4, -34], [-5, -38]]);
  p.poly(b.skin, [[-3, -41], [0, -42], [3, -40], [4, -36], [5, -35], [3, -34], [2, -32], [-1, -33], [-3, -36]]);
  p.poly(b.skinLight, [[-3, -40], [-1, -42], [2, -40], [2, -38], [-2, -38]]);
  p.rect(b.skinLight, 2, -35, 2, 1);
  p.rect(b.skin, -5, -36, 2, 3); p.rect(b.skinLight, -5, -36, 1, 1);
  p.rect(ink, 2, -38, 3, 1); p.rect(ink, 3, -37, 1, 1);
  p.rect(b.skinShade, -1, -37, 1, 1); p.rect(ink, 2, -33, 2, 1);
  if (cls === "warrior") {
    p.poly(b.hair, [[-5, -42], [-1, -45], [3, -44], [5, -41], [2, -39], [-2, -40], [-3, -35], [-5, -36]]);
    p.line(b.hairLight, [-3, -42], [1, -43]); p.rect(b.hairLight, -4, -40, 2, 1);
    p.poly(b.hair, [[-3, -35], [-1, -33], [3, -33], [4, -34], [4, -31], [1, -29], [-3, -32]]);
    p.rect(b.hairLight, -1, -32, 2, 1); p.rect(b.skin, 1, -34, 2, 1);
  } else if (cls === "mage") {
    p.poly(b.hair, [[-5, -41], [-2, -44], [2, -43], [4, -41], [-1, -41], [-3, -36], [-5, -34]]);
    p.line(b.hairLight, [-3, -42], [1, -43]); p.line(b.hairLight, [-4, -40], [-4, -36]);
    p.poly(ink, [[-3, -34], [0, -33], [5, -34], [5, -30], [2 + sway, -24], [-2, -28], [-4, -32]]);
    p.poly(b.hair, [[-2, -33], [0, -32], [4, -33], [3, -29], [2 + sway, -26], [-1, -29], [-3, -32]]);
    p.line(b.hairLight, [0, -32], [1 + sway, -27]); p.rect(b.hairLight, 2, -39, 3, 1);
  } else if (cls === "ranger") {
    p.poly(b.hair, [[-5, -41], [-2, -44], [2, -44], [5, -41], [5, -40], [0, -40], [-3, -36], [-4, -34], [-5, -37]]);
    p.line(b.hairLight, [-3, -42], [1, -43]); p.line(b.hairLight, [-4, -40], [-2, -40]);
    p.rect(b.clothLight, -7, -35, 2, 1);
  } else {
    p.rect(b.skinLight, -2, -42, 3, 1);
    p.rect(b.skinShade, -2, -34, 2, 1);
  }
}

/** Tapered volumes replace square brush strokes at shoulders, elbows and knees. */
function limb(p: Pixels, a: Point, z: Point, width: number, endWidth: number, base: string, shade: string, light: string) {
  const dx = z[0] - a[0], dy = z[1] - a[1], length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length, ny = dx / length;
  const shape = (w: number, e: number): Point[] => [
    [a[0] + nx * w, a[1] + ny * w], [a[0] - nx * w, a[1] - ny * w],
    [z[0] - nx * e, z[1] - ny * e], [z[0] + nx * e, z[1] + ny * e],
  ];
  p.poly(ink, shape(width / 2 + 1, endWidth / 2 + 1));
  p.poly(shade, shape(width / 2, endWidth / 2));
  p.line(base, [a[0] - 1, a[1]], [z[0] - 1, z[1]], Math.max(1, Math.floor(endWidth / 2)));
  p.line(light, [a[0] - 1, a[1] + 1], [(a[0] + z[0]) / 2 - 1, (a[1] + z[1]) / 2]);
}

function everydayClothes(p: Pixels, b: ClassBody, cls: HeroClass) {
  const hem = cls === "mage" ? -3 : cls === "ranger" ? -10 : -12;
  p.poly(ink, [[-6, -30], [3, -30], [8, -26], [5, -18], [8, hem - 1], [2, hem], [-2, hem - 1], [-9, hem], [-6, -18], [-9, -25]]);
  p.poly(b.clothShade, [[-6, -29], [3, -29], [7, -26], [4, -18], [7, hem - 2], [1, hem - 1], [-2, hem - 2], [-8, hem - 1], [-5, -18], [-8, -25]]);
  p.poly(b.cloth, [[-5, -28], [1, -29], [5, -26], [2, -18], [4, hem - 2], [-1, hem - 2], [-4, -18], [-6, -24]]);
  p.poly(b.clothLight, [[-5, -27], [-2, -28], [-1, -25], [-4, -21], [-6, -24]]);
  p.line(b.cloth, [-5, -16], [-6, hem - 2]); p.line(b.clothLight, [-2, -16], [-1, hem - 3]);
  if (cls === "monk") {
    p.poly(b.skinShade, [[-3, -30], [4, -29], [4, -25], [1, -24]]);
    p.poly(b.skin, [[-2, -29], [3, -28], [3, -26], [1, -25]]);
    p.poly(b.clothLight, [[-5, -29], [-3, -29], [5, -20], [3, -19]]);
    p.line(b.clothShade, [4, -28], [-4, -18]);
    p.rect("#785241", -6, -17, 12, 3); p.line("#b58d61", [-5, -17], [4, -17]);
    p.poly("#785241", [[1, -15], [4, -15], [5, -9], [2, -7], [1, -11]]);
    p.line("#b58d61", [2, -14], [3, -9]);
  } else if (cls === "warrior") {
    p.poly(ink, [[-3, -30], [4, -29], [1, -24], [-2, -25]]);
    p.poly(b.skinShade, [[-2, -29], [3, -28], [1, -26], [-1, -26]]);
    p.line("#b2a184", [-1, -25], [1, -23]); p.rect("#b2a184", 0, -22, 2, 1);
    p.line(b.clothShade, [-4, -20], [3, -19]);
    p.rect(ink, -6, -16, 12, 3); p.rect("#715540", -5, -16, 10, 2); p.rect("#bca57b", 1, -16, 3, 2); p.rect(ink, 2, -16, 1, 1);
    p.line(b.clothLight, [-6, -12], [-3, -12]);
  } else if (cls === "mage") {
    p.poly(b.clothLight, [[-5, -30], [-2, -29], [3, -24], [1, -22], [-6, -27]]);
    p.line(b.clothShade, [2, -24], [3, -6]); p.line(b.clothLight, [-4, -17], [-6, -5]);
    p.line(b.cloth, [5, -14], [6, -5]); p.line("#b8ab83", [-7, -5], [5, -5]);
    p.rect("#655748", -5, -17, 10, 2); p.rect("#b8ab83", 1, -17, 2, 2);
    p.line("#b8ab83", [2, -15], [1, -11]); p.rect("#d4c89e", 0, -11, 3, 2);
  } else {
    // A folded cowl and split tunic are everyday fabric, never baked-in armor.
    p.poly(ink, [[-7, -30], [-2, -31], [5, -29], [6, -26], [-1, -23], [-8, -26]]);
    p.poly(b.clothShade, [[-6, -29], [-1, -30], [4, -28], [4, -26], [-1, -25], [-7, -27]]);
    p.line(b.clothLight, [-5, -29], [1, -27]); p.line(b.cloth, [-6, -27], [-1, -25]);
    p.line("#423d30", [-5, -25], [4, -17], 2); p.line("#978064", [-5, -25], [4, -17]);
    p.rect("#534735", -5, -17, 10, 2); p.rect("#b7a17b", 2, -17, 2, 2);
    p.poly(b.clothShade, [[0, -15], [2, -15], [1, -10], [-2, -12]]);
  }
}

function drawHero(ctx: CanvasRenderingContext2D, look: HeroAppearance, pose: Pose | "flash", frame: number) {
  const p = new Pixels(ctx), cls = look.classId, s = look.slots, b = CLASS_BODIES[cls];
  const striking = pose === "attack" && (frame === 1 || frame === 2);
  const breath = pose === "idle" && frame >= 2 ? 1 : 0;
  const crouch = striking ? (cls === "warrior" ? 2 : cls === "mage" ? 0 : 1) : breath;
  const lean = striking ? (cls === "ranger" ? 3 : 2) : pose === "attack" && frame === 0 ? -1 : 0;
  // Deform each clothing/armor layer around the same anatomical landmarks.
  const torso = new Pixels(ctx, (x, y) => {
    const t = Math.max(0, Math.min(1, (-15 - y) / 14));
    const yy = y < -15 ? b.hips + (y + 15) * (b.hips - b.shoulders) / 14 : y * b.hips / -15;
    return [x * b.width + lean * t, yy + crouch * t];
  });
  const skull = new Pixels(ctx, (x, y) => [x * b.headWidth + lean, y + b.shoulders + 29 + crouch]);
  ctx.save();
  if (pose === "death") {
    if (frame >= 2) { ctx.translate(22, -13); ctx.rotate(-Math.PI / 2); }
    else ctx.translate(-frame * 2, frame * 2);
  }
  if (pose === "hit" || pose === "flash") ctx.translate(-2, 0);
  const attack = heroAttackName(look), unarmed = attack === "unarmed" || attack === "monk";
  const guard: Record<HeroClass, Point> = { monk: [9, -26], warrior: [11, -19], mage: [9, -25], ranger: [10, -22] };
  const fists: Record<HeroClass, readonly Point[]> = {
    monk: [[4, -25], [18, -27], [14, -25], [9, -26]],
    warrior: [[6, -20], [17, -23], [15, -20], [12, -22]],
    mage: [[4, -27], [17, -29], [13, -28], [9, -26]],
    ranger: [[4, -26], [19, -28], [14, -26], [10, -27]],
  };
  const frontBase: Point = unarmed ? pose === "attack" ? fists[cls][frame] ?? guard[cls] : guard[cls]
    : attack === "ranger" ? [striking ? 10 : 8, -23] : [striking ? 11 : 9, striking ? -23 : -19];
  const backBase: Point = unarmed ? [cls === "warrior" ? -11 : -9, cls === "monk" ? -25 : cls === "mage" ? -21 : -18]
    : attack === "ranger" && striking ? [0, -24] : [-9, b.hips];
  const front: Point = [frontBase[0], frontBase[1] + crouch], back: Point = [backBase[0], backBase[1] + crouch];
  const shoulderY = b.shoulders + 4 + crouch;
  const arm = (hand: Point, near: boolean) => {
    const shoulder: Point = [(near ? 4 : -6) * b.width + lean, shoulderY];
    const elbow: Point = [near ? striking ? 11 + lean : 10 : -9,
      striking && near ? hand[1] + (cls === "warrior" ? 3 : 1) : shoulderY + 8];
    const sleeve = cls === "mage" || cls === "ranger";
    const cloth = s.chest ?? { base: b.cloth, shade: b.clothShade, light: b.clothLight };
    const color = sleeve ? cloth.base : b.skin, shade = sleeve ? cloth.shade : b.skinShade;
    limb(p, shoulder, elbow, b.armWidth + (sleeve ? 2 : 1), b.armWidth, color, shade, near ? (sleeve ? cloth.light : b.skinLight) : shade);
    limb(p, elbow, hand, b.armWidth, 2, sleeve && cls === "mage" ? cloth.base : b.skin,
      sleeve && cls === "mage" ? cloth.shade : b.skinShade, near ? b.skin : b.skinShade);
    if (near && s.chest && cls === "warrior") {
      p.poly(ink, [[shoulder[0] - 3, shoulder[1] - 3], [shoulder[0] + 3, shoulder[1] - 3], [shoulder[0] + 4, shoulder[1] + 2], [shoulder[0] - 4, shoulder[1] + 3]]);
      p.rect(cloth.base, shoulder[0] - 3, shoulder[1] - 2, 6, 3); p.rect(cloth.light, shoulder[0] - 2, shoulder[1] - 2, 4, 1);
    }
    p.poly(ink, [[hand[0] - 1, hand[1] - 2], [hand[0] + 3, hand[1] - 2], [hand[0] + 4, hand[1]], [hand[0] + 3, hand[1] + 3], [hand[0] - 1, hand[1] + 2]]);
    p.rect(b.skin, hand[0], hand[1] - 1, 3, 3); p.rect(b.skinLight, hand[0], hand[1] - 1, 3, 1);
    if (s.gloves) glove(p, s.gloves, hand, b.skin);
    if (s.weapon && cls === "monk") weapon(p, s.weapon, hand, striking);
  };
  // Far arm first, then legs/body/head, then the near arm and held equipment.
  arm(back, false);
  for (const [i, foot] of b.feet.entries()) {
    const hip: Point = [i ? 3 : -4, b.hips];
    const knee: Point = [foot + (striking ? 2 : 1), Math.round(b.hips / 2) - 1];
    const ankle: Point = [foot + 1, -3];
    limb(p, hip, knee, b.legWidth + 1, b.legWidth, b.trousers, b.clothShade, i ? b.cloth : b.clothShade);
    limb(p, knee, ankle, b.legWidth, b.legWidth - 1, b.trousers, b.clothShade, b.cloth);
    p.line(b.clothLight, [knee[0] - 1, knee[1]], [knee[0] + 1, knee[1] + 1]);
    if (s.boots) boots(p, s.boots, foot - 1, -2, b.skin, b.skinLight);
    else {
      p.poly(ink, [[foot - 2, -4], [foot + 2, -4], [foot + 5, -2], [foot + 5, 0], [foot - 2, 0]]);
      p.rect(b.skinShade, foot - 1, -3, 4, 2); p.rect(b.skin, foot, -2, 4, 1);
    }
  }
  everydayClothes(torso, b, cls);
  if (s.chest) chest(torso, s.chest);
  face(skull, b, cls, pose === "idle" ? frame >= 2 ? 1 : 0 : striking ? 1 : 0);
  if (s.head) head(skull, s.head);
  arm(front, true);
  if (s.weapon && cls !== "monk") weapon(p, s.weapon, front, striking);
  if (s.ring) { p.rect(s.ring.trim, back[0] + 2, back[1] + 1, 2, 1); if (s.ring.tier >= 2) p.rect(s.ring.light, back[0] + 3, back[1], 1, 1); }
  ctx.restore();
}

/** Geometry/timing comes from the existing animation contract, pixels from the equipped layers. */
export function gearAtlas(asset: ArtAsset, appearance: HeroAppearance): HTMLCanvasElement {
  const canvas = document.createElement("canvas"); canvas.width = asset.atlasWidth; canvas.height = asset.atlasHeight;
  const ctx = canvas.getContext("2d")!; ctx.imageSmoothingEnabled = false;
  const pose = (asset.id.split("/")[2] ?? "idle") as Pose | "flash";
  asset.frames.forEach((f, i) => {
    ctx.save(); ctx.beginPath(); ctx.rect(f.x, f.y, asset.width, asset.height); ctx.clip();
    ctx.translate(f.x + asset.anchor.x, f.y + asset.anchor.y);
    drawHero(ctx, appearance, pose, i); ctx.restore();
  });
  if (pose === "flash") { ctx.globalCompositeOperation = "source-in"; ctx.fillStyle = "#fff5dc"; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  return canvas;
}

export function portraitAtlas(classId: HeroClass, appearance = bareAppearance(classId)): HTMLCanvasElement {
  const clip = actorPack[classId]!.animations.idle;
  const canvas = document.createElement("canvas"); canvas.width = clip.frame[0]! * clip.ms.length; canvas.height = clip.frame[1]!;
  const ctx = canvas.getContext("2d")!;
  clip.ms.forEach((_, i) => { ctx.save(); ctx.translate(i * clip.frame[0]! + clip.anchor[0]!, clip.anchor[1]!); drawHero(ctx, appearance, "idle", i); ctx.restore(); });
  return canvas;
}

/** Inventory art uses the same equipment shapes and materials as the worn layers. */
export function gearIcon(s: GearSkin): HTMLCanvasElement {
  const canvas = document.createElement("canvas"); canvas.width = 32; canvas.height = 32;
  const ctx = canvas.getContext("2d")!, p = new Pixels(ctx);
  ctx.translate(16, 28);
  switch (s.slot) {
    case "head": ctx.translate(0, 21); head(p, s); break;
    case "chest": ctx.translate(0, 3); chest(p, s); break;
    case "boots": boots(p, s, -7, -6); boots(p, s, 2, -2); break;
    case "gloves": ctx.scale(2, 2); glove(p, s, [-5, -7]); glove(p, s, [1, -5]); break;
    case "weapon":
      if (s.classId === "monk") { ctx.scale(2, 2); weapon(p, s, [-5, -7], false); weapon(p, s, [1, -5], false); }
      else { ctx.scale(0.75, 0.75); weapon(p, s, [-5, -8], false); }
      break;
    case "ring":
      p.poly(ink, [[-7, -22], [4, -22], [8, -17], [8, -9], [3, -4], [-7, -4], [-11, -9], [-11, -17]]);
      p.poly(s.trim, [[-6, -21], [3, -21], [7, -16], [7, -10], [2, -5], [-6, -5], [-10, -10], [-10, -16]]);
      ctx.globalCompositeOperation = "destination-out";
      p.poly(ink, [[-5, -18], [2, -18], [4, -15], [4, -11], [1, -8], [-5, -8], [-7, -11], [-7, -15]]);
      ctx.globalCompositeOperation = "source-over";
      p.rect(s.light, -7, -19, 3, 2);
      if (s.tier) { p.rect(ink, -2, -24, 6, 6); p.rect(s.trim, -1, -23, 4, 4); p.rect(s.light, -1, -23, 2, 2); }
  }
  return canvas;
}
