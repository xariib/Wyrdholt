import { actorPack } from "./darkwood";
import type { ArtAsset, Pose } from "./types";
import { bareAppearance, heroAttackName, type GearSkin, type HeroAppearance, type HeroClass } from "./gearSkins";

// Original, composable pixel art. Body and each equipment slot are separate drawing
// passes, so taking off a helmet or swapping a weapon cannot leave baked-in armor.
const ink = "#20262c", skin = "#cf9e78", skinLight = "#edc39a", skinShade = "#986d55";
type Point = readonly [number, number];
class Pixels {
  constructor(readonly ctx: CanvasRenderingContext2D) {}
  rect(color: string, x: number, y: number, w: number, h: number) {
    this.ctx.fillStyle = color; this.ctx.fillRect(Math.round(x), Math.round(y), w, h);
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

function boots(p: Pixels, s: GearSkin, x: number, y: number) {
  const sandal = s.classId === "monk" && s.tier < 2;
  p.rect(ink, x - 1, y - (sandal ? 1 : 5), 7, sandal ? 3 : 7);
  p.rect(sandal ? skin : s.shade, x, y - (sandal ? 1 : 4), 4, sandal ? 2 : 5);
  p.rect(sandal ? skinLight : s.base, x + 1, y - (sandal ? 1 : 4), 3, sandal ? 1 : 4);
  p.rect(sandal ? "#8e7250" : s.light, x + 1, y, 4, 1);
  p.rect(s.tier ? s.trim : "#75604b", x, y - (sandal ? 1 : 4), 4, 1);
  if (s.tier >= 2) p.rect(s.trim, x + 2, y - 2, 1, 1);
  if (s.family === "courtyard_sandals") { p.rect("#584e3f", x + 2, y - 1, 1, 2); p.rect(s.trim, x, y - 3, 3, 1); }
  if (s.family === "ghostwalk") p.rect(s.trim, x + 4, y - 3, 2, 1);
}

function glove(p: Pixels, s: GearSkin, hand: Point) {
  const [x, y] = hand;
  p.rect(ink, x - 1, y - 2, 6, 6); p.rect(s.shade, x, y - 1, 4, 4);
  // Wrist cuffs remain visible underneath a Monk's separate weapon wraps.
  p.rect(ink, x - 1, y - 5, 5, 4); p.rect(s.base, x, y - 4, 3, 3); p.rect(s.light, x, y - 4, 3, 1);
  if (s.tier >= 1) p.rect(s.trim, x + 1, y - 2, 2, 1);
  p.rect(s.base, x + 1, y - 1, 3, 3); p.rect(s.light, x, y - 1, 4, 1);
  if (s.classId === "monk") { p.rect(s.light, x, y + 1, 4, 1); p.rect(skin, x + 3, y, 1, 2); }
  if (s.tier >= 1) p.rect(s.trim, x + 1, y + 1, 2, 1);
  if (s.family === "fletchers_gloves") p.rect(skin, x + 2, y + 2, 2, 1);
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

function drawHero(ctx: CanvasRenderingContext2D, look: HeroAppearance, pose: Pose | "flash", frame: number) {
  const p = new Pixels(ctx), cls = look.classId, s = look.slots;
  const striking = pose === "attack" && (frame === 1 || frame === 2);
  const bob = pose === "idle" && frame % 4 >= 2 ? 1 : 0;
  ctx.save();
  if (pose === "death") {
    if (frame >= 2) { ctx.translate(17, -13); ctx.rotate(-Math.PI / 2); }
    else ctx.translate(-frame * 2, frame * 2);
  }
  if (pose === "hit" || pose === "flash") ctx.translate(-2, 0);
  // Feet stay planted while the torso breathes.
  p.poly(ink, [[-7, -15], [6, -15], [8, -2], [1, -1], [-1, -10], [-4, -1], [-11, -1]]);
  p.poly("#686658", [[-6, -14], [-1, -14], [-5, -2], [-9, -2]]);
  p.poly("#85816c", [[0, -14], [5, -14], [6, -2], [2, -2]]);
  p.line("#aaa18a", [3, -12], [4, -4]);
  for (const x of [-10, 2]) {
    if (s.boots) boots(p, s.boots, x, -2);
    else { p.rect(ink, x - 1, -3, 7, 3); p.rect(skin, x, -2, 5, 1); }
  }
  ctx.translate(0, bob);
  // Plain undershirt remains when Chest is empty; no shoulder plates or cape.
  p.poly(ink, [[-7, -29], [5, -29], [9, -24], [6, -13], [-8, -13], [-10, -24]]);
  p.poly("#aaa18b", [[-6, -28], [4, -28], [8, -24], [5, -14], [-7, -14], [-9, -24]]);
  p.rect("#756d5e", -6, -24, 3, 10); p.line("#d1c4a6", [-2, -27], [4, -25]);
  if (s.chest) chest(p, s.chest);
  // Neck, head and face remain the same person across equipment changes.
  p.rect(ink, -3, -32, 7, 6); p.rect(skinShade, -2, -32, 5, 5);
  p.poly(ink, [[-5, -42], [3, -42], [7, -38], [7, -34], [9, -34], [8, -32], [5, -29], [-3, -30], [-7, -35], [-7, -39]]);
  p.poly(skin, [[-4, -41], [3, -41], [6, -37], [6, -34], [8, -34], [7, -33], [4, -30], [-2, -31], [-5, -35], [-5, -39]]);
  p.rect(skinLight, 0, -39, 5, 4); p.rect(skinShade, -4, -36, 3, 4);
  p.rect("#4a3830", -5, -41, 8, 3); p.rect("#6b5040", -4, -41, 5, 1);
  if (cls === "monk") { p.rect(skin, -5, -41, 8, 3); p.rect(skinLight, -2, -41, 4, 1); }
  p.rect(ink, 4, -36, 2, 1); p.rect(skinShade, 3, -32, 3, 1);
  if (cls === "mage") { p.rect("#c4bfa7", -1, -32, 5, 3); p.rect("#e4d9bb", 2, -32, 2, 3); }
  if (s.head) head(p, s.head);
  const attack = heroAttackName(look);
  const front: Point = attack === "unarmed"
    ? pose === "attack" ? ([[4, -23], [17, -25], [13, -24], [8, -21]] as const)[frame] ?? [8, -21] : [8, -21]
    : attack === "monk" ? [striking ? 17 : 9, striking ? -25 : -21]
    : attack === "ranger" ? [striking ? 13 : 9, -20] : [striking ? 12 : 9, striking ? -23 : -18];
  const back: Point = attack === "unarmed" ? [-5, -23] : attack === "monk" ? [-9, -20] : attack === "ranger" && striking ? [1, -20] : [-10, -15];
  for (const [shoulder, hand] of [[[-8, -25], back], [[6, -25], front]] as const) {
    p.line(ink, shoulder, hand, 5); p.line(skinShade, [shoulder[0] + 1, shoulder[1] + 1], [hand[0] + 1, hand[1] + 1], 3);
    p.rect(skin, hand[0], hand[1], 4, 3); p.rect(skinLight, hand[0] + 1, hand[1], 3, 1);
    if (s.gloves) glove(p, s.gloves, hand);
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
