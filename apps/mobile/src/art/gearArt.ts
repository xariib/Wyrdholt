import { actorPack } from "./darkwood";
import type { ArtAsset, Pose } from "./types";
import { bareAppearance, heroAttackName, type GearSkin, type HeroAppearance, type HeroClass } from "./gearSkins";
import { CLASS_BODIES, type ClassBody } from "./classBodies";

// Original, composable pixel art. Body and each equipment slot are separate drawing
// passes, so taking off a helmet or swapping a weapon cannot leave baked-in armor.
const ink = "#20262c", skin = "#cf9e78", skinLight = "#edc39a", skinShade = "#986d55";
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
    p.rect(ink, -6, -40, 13, 4); p.rect(t >= 3 ? trim : base, -5, -39, 11, 2);
    p.rect(light, -4, -39, 3, 1); p.rect(trim, 3, -38, 2, 2);
    if (t >= 3) {
      for (const x of [-5, -1, 4]) { p.rect(ink, x, -43, 3, 5); p.rect(trim, x + 1, -42, 1, 4); }
      if (cls === "ranger") p.line(light, [-6, -39], [-10, -44], 1);
      if (cls === "warrior") { p.rect(shade, -7, -37, 2, 7); p.rect(base, -6, -37, 2, 6); }
    }
  } else if (cls === "monk") {
    p.rect(ink, -6, -39, 13, 4); p.rect(light, -5, -38, 11, 2);
    p.poly(base, [[-5, -37], [-10, -35], [-12, -29], [-9, -30], [-7, -35]]);
    if (t === 1) p.rect(trim, 3, -38, 2, 2);
  } else {
    // Linen coifs/hoods surround an open face. Only the named Watch Helm is metal.
    const metal = family === "watch_helm";
    p.poly(ink, [[-8, -30], [-8, -39], [-4, -43], [3, -43], [8, -38], [7, -36], [-3, -37], [-3, -31]]);
    p.poly(metal ? "#86918f" : base, [[-7, -31], [-7, -39], [-3, -42], [3, -42], [7, -38], [-4, -38], [-4, -32]]);
    p.line(metal ? "#c3ccc4" : light, [-4, -41], [2, -41]);
    p.rect(shade, -7, -36, 2, 5);
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
  if ((robe && t >= 1) || (cls === "ranger" && t >= 2)) {
    p.poly(ink, [[-7, -29], [-11, -24], [-13, -7], [-5, -9], [3, -7], [7, -11], [5, -26]]);
    p.poly(shade, [[-7, -28], [-10, -23], [-12, -8], [-4, -10], [5, -9], [4, -25]]);
    p.line(base, [-8, -25], [-10, -10]);
  }
  p.poly(ink, [[-7, -29], [5, -29], [9, -25], [6, -14], [8, robe ? -4 : -11], [-9, robe ? -4 : -11], [-7, -18], [-10, -25]]);
  p.poly(base, [[-6, -28], [4, -28], [8, -25], [5, -14], [7, robe ? -5 : -12], [-8, robe ? -5 : -12], [-6, -19], [-9, -25]]);
  p.poly(shade, [[-7, -26], [-3, -25], [-3, -15], [-6, robe ? -5 : -12], [-8, robe ? -5 : -12], [-6, -19]]);
  p.line(light, [0, -27], [5, -25]);
  if (cls === "monk") {
    p.poly(light, [[-5, -28], [-2, -27], [4, -18], [2, -18]]);
    p.line(shade, [4, -28], [-3, -19]);
    if (family === "temple_vest") p.rect(trim, 2, -24, 3, 3);
  } else if (plate) {
    p.poly(light, [[-5, -26], [5, -26], [6, -22], [2, -20], [-5, -22]]);
    p.poly(base, [[-4, -25], [4, -25], [5, -23], [1, -21], [-4, -23]]);
    for (const y of [-19, -17]) p.line(shade, [-5, y], [5, y]);
    p.rect(ink, -10, -28, 6, 5); p.rect(base, -9, -27, 5, 3); p.rect(light, -9, -27, 5, 1);
    p.rect(ink, 4, -28, 6, 5); p.rect(base, 5, -27, 4, 3); p.rect(light, 5, -27, 4, 1);
    if (family === "bastion_mail") for (let y = -23; y < -16; y += 2) { p.rect(light, -2, y, 1, 1); p.rect(light, 1, y + 1, 1, 1); }
  } else {
    p.line(shade, [0, -26], [0, robe ? -6 : -14]);
    p.rect(light, 1, -25, 1, 1); p.rect(light, 1, -22, 1, 1);
    if (cls === "ranger") p.line("#b29670", [-5, -27], [5, -16], 2);
  }
  p.rect(ink, -7, -16, 14, 3); p.rect("#68503b", -6, -15, 12, 2);
  p.rect(t > 0 ? trim : "#a58c67", 2, -15, 2, 2);
  if (t >= 2) {
    p.line(trim, [-7, robe ? -6 : -12], [6, robe ? -6 : -12]);
    if (robe) { p.line(trim, [4, -25], [4, -17]); p.line(trim, [4, -12], [5, -7]); }
    if (cls === "monk") p.rect(trim, -3, -13, 2, 6);
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
  p.rect(ink, -3, -32, 7, 6); p.rect(b.skinShade, -2, -32, 5, 5);
  if (cls === "warrior") {
    // Short hair, a heavy brow and a square, bearded jaw.
    p.poly(ink, [[-7, -41], [-3, -44], [4, -43], [7, -40], [7, -35], [9, -34], [8, -29], [-4, -29], [-7, -33]]);
    p.poly(b.skin, [[-6, -40], [-3, -42], [4, -41], [6, -38], [6, -34], [8, -33], [7, -30], [-3, -30], [-5, -34]]);
    p.rect(b.hair, -6, -42, 11, 4); p.rect(b.hairLight, -4, -43, 6, 2);
    p.rect(b.skinLight, 0, -38, 5, 3); p.rect(b.skinShade, -4, -36, 3, 3);
    p.poly(b.hair, [[-4, -34], [-1, -31], [7, -32], [6, -29], [-3, -30]]);
    p.rect(b.hairLight, 0, -30, 4, 1); p.rect(ink, 3, -37, 3, 1);
    p.line(b.skinShade, [2, -35], [1, -33]);
  } else if (cls === "mage") {
    // Receding silver hair, a long nose and a narrow beard.
    p.poly(ink, [[-4, -43], [3, -43], [6, -39], [6, -36], [10, -34], [7, -32], [6, -29], [0, -28], [-5, -32], [-7, -38]]);
    p.poly(b.skin, [[-3, -42], [3, -42], [5, -38], [5, -35], [8, -34], [6, -33], [5, -30], [0, -29], [-4, -33], [-5, -38]]);
    p.rect(b.skinLight, 0, -40, 4, 4); p.rect(b.skinShade, -3, -36, 2, 4);
    p.poly(b.hair, [[-5, -41], [-3, -42], [-3, -36], [-5 + sway, -30], [-7 + sway, -32], [-7, -38]]);
    p.line(b.hairLight, [-5, -39], [-5 + sway, -33]);
    p.poly(ink, [[-2, -33], [6, -32], [5 + sway, -23], [0 + sway, -25], [-3, -30]]);
    p.poly(b.hair, [[-1, -32], [5, -32], [4 + sway, -24], [1 + sway, -26], [-2, -30]]);
    p.line(b.hairLight, [3, -31], [3 + sway, -26]); p.rect(ink, 3, -37, 2, 1);
    p.rect(b.hairLight, 2, -39, 3, 1);
  } else if (cls === "ranger") {
    // Tied auburn hair and an angular, clean-shaven face.
    p.poly(ink, [[-6, -41], [-2, -44], [4, -43], [7, -39], [7, -35], [9, -34], [6, -31], [1, -29], [-4, -32], [-7, -37]]);
    p.poly(b.skin, [[-5, -40], [-2, -42], [4, -41], [6, -38], [6, -35], [7, -34], [5, -32], [1, -30], [-3, -33], [-5, -37]]);
    p.poly(ink, [[-6, -39], [-10, -39], [-13 - sway, -32], [-9 - sway, -26], [-7 - sway, -29], [-9, -33]]);
    p.poly(b.hair, [[-7, -38], [-9, -38], [-11 - sway, -32], [-9 - sway, -28], [-8 - sway, -30], [-9, -34]]);
    p.poly(b.hair, [[-6, -41], [-2, -43], [4, -42], [6, -39], [-1, -38], [-4, -34], [-6, -36]]);
    p.line(b.hairLight, [-4, -41], [2, -41]); p.rect(b.skinLight, 1, -38, 4, 3);
    p.rect(ink, 4, -36, 2, 1); p.line(b.skinShade, [4, -33], [1, -31]);
  } else {
    // Shaved head, high cheekbones and a calm, level gaze.
    p.poly(ink, [[-4, -43], [2, -43], [6, -40], [7, -36], [9, -34], [7, -32], [4, -29], [-2, -30], [-6, -34], [-7, -39]]);
    p.poly(b.skin, [[-4, -42], [2, -42], [5, -39], [6, -35], [7, -34], [6, -32], [3, -30], [-2, -31], [-5, -35], [-6, -39]]);
    p.line(b.skinLight, [-3, -41], [2, -41], 2); p.rect(b.skinLight, 1, -38, 4, 3);
    p.rect(b.skinShade, -4, -36, 3, 3); p.rect(ink, 4, -36, 2, 1);
    p.line(b.skinShade, [4, -33], [2, -32]);
  }
}

function drawHero(ctx: CanvasRenderingContext2D, look: HeroAppearance, pose: Pose | "flash", frame: number) {
  const p = new Pixels(ctx), cls = look.classId, s = look.slots, b = CLASS_BODIES[cls];
  const striking = pose === "attack" && (frame === 1 || frame === 2);
  const breath = pose === "idle" && frame >= 2 ? 1 : 0;
  const crouch = striking ? (cls === "warrior" ? 2 : cls === "mage" ? 0 : 1) : breath;
  const lean = striking ? (cls === "ranger" ? 3 : 2) : cls === "mage" ? 1 : 0;
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
  for (const [i, foot] of b.feet.entries()) {
    const hip: Point = [i ? 2 : -5, b.hips - 1];
    const knee: Point = [foot + (i ? 0 : -1) + (striking ? 2 : 0), Math.round(b.hips / 2) + (cls === "monk" ? -1 : 0)];
    const ankle: Point = [foot, -4];
    for (const [a, z] of [[hip, knee], [knee, ankle]] as const) {
      const half = Math.floor((b.legWidth + 2) / 2);
      p.line(ink, [a[0] + 2 - half, a[1] - half], [z[0] + 2 - half, z[1] - half], b.legWidth + 2);
      p.line(i ? b.trousers : b.clothShade, [a[0] + 3 - half, a[1] + 1 - half], [z[0] + 3 - half, z[1] + 1 - half], b.legWidth);
    }
    p.line(b.clothLight, [knee[0] + 2, knee[1] + 1], [foot + 2, -5]);
    if (s.boots) boots(p, s.boots, foot, -2, b.skin, b.skinLight);
    else { p.rect(ink, foot - 1, -3, 7, 3); p.rect(b.skin, foot, -2, 5, 1); }
  }
  // Everyday clothes are part of the base model; armor is exclusively an equipped layer.
  const hem = cls === "mage" ? -8 : -13;
  torso.poly(ink, [[-7, -29], [5, -29], [8, -25], [6, -17], [7, hem], [-8, hem], [-7, -19], [-9, -25]]);
  torso.poly(b.cloth, [[-6, -28], [4, -28], [7, -25], [5, -17], [6, hem - 1], [-7, hem - 1], [-6, -19], [-8, -25]]);
  torso.poly(b.clothShade, [[-7, -26], [-3, -25], [-3, -17], [-5, hem - 1], [-7, hem - 1], [-6, -19]]);
  if (cls === "monk") {
    torso.line(b.clothLight, [-5, -28], [3, -18], 2);
    torso.line(b.clothShade, [4, -28], [-4, -17]);
    torso.rect(b.clothLight, -6, -16, 12, 2);
  } else if (cls === "warrior") {
    torso.poly(b.skinShade, [[-4, -29], [4, -29], [2, -25], [-1, -25]]);
    torso.line(b.clothLight, [-2, -23], [4, -23]);
    torso.line(b.clothShade, [-5, -17], [5, -17]);
  } else {
    torso.line(b.clothLight, [-1, -27], [4, -25]);
    torso.line(b.clothShade, [0, -24], [0, hem - 2]);
    torso.rect(b.clothLight, 1, -23, 1, 1);
    if (cls === "ranger") torso.line(b.clothShade, [-6, -17], [5, -16]);
  }
  if (s.chest) chest(torso, s.chest);
  face(skull, b, cls, pose === "idle" ? frame % 2 : striking ? 1 : 0);
  if (s.head) head(skull, s.head);
  const attack = heroAttackName(look), unarmed = attack === "unarmed" || attack === "monk";
  const guard: Record<HeroClass, Point> = { monk: [9, -26], warrior: [12, -22], mage: [9, -26], ranger: [10, -27] };
  const fists: Record<HeroClass, readonly Point[]> = {
    monk: [[4, -25], [18, -27], [14, -25], [9, -26]],
    warrior: [[6, -20], [17, -23], [15, -20], [12, -22]],
    mage: [[4, -27], [17, -29], [13, -28], [9, -26]],
    ranger: [[4, -26], [19, -28], [14, -26], [10, -27]],
  };
  const frontBase: Point = unarmed ? pose === "attack" ? fists[cls][frame] ?? guard[cls] : guard[cls]
    : attack === "ranger" ? [striking ? 10 : 8, -21] : [striking ? 11 : 9, striking ? -23 : -19];
  const backBase: Point = unarmed ? [cls === "warrior" ? -10 : -7, b.shoulders + 7]
    : attack === "ranger" && striking ? [0, -21] : [-10, b.hips];
  const front: Point = [frontBase[0], frontBase[1] + crouch], back: Point = [backBase[0], backBase[1] + crouch];
  const shoulderY = b.shoulders + 4 + crouch;
  for (const [i, hand] of [back, front].entries()) {
    const shoulder: Point = [(i ? 5 : -8) * b.width + lean, shoulderY];
    const elbow: Point = [i ? (shoulder[0] + hand[0]) / 2 : shoulder[0] - 2,
      striking && i ? hand[1] + (cls === "warrior" ? 4 : 1) : shoulderY + (cls === "mage" ? 9 : 7)];
    for (const [a, z] of [[shoulder, elbow], [elbow, hand]] as const) {
      p.line(ink, a, z, b.armWidth + 2);
      p.line(b.skinShade, [a[0] + 1, a[1] + 1], [z[0] + 1, z[1] + 1], b.armWidth);
      p.line(b.skin, [a[0] + 1, a[1] + 1], [z[0] + 1, z[1] + 1]);
    }
    p.rect(b.skin, hand[0], hand[1], 4, 3); p.rect(b.skinLight, hand[0] + 1, hand[1], 3, 1);
    if (s.gloves) glove(p, s.gloves, hand, b.skin);
    if (s.weapon && cls === "monk") weapon(p, s.weapon, hand, striking);
  }
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
