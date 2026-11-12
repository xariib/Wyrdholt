import { actorPack } from "./darkwood";
import type { ArtAsset, Pose } from "./types";
import { bareAppearance, heroAttackName, type GearSkin, type HeroAppearance, type HeroClass } from "./gearSkins";
import { CLASS_BODIES, type ClassBody } from "./classBodies";
import { Pixels, type PixelPoint as Point } from "./pixels";
import { head, chest, glove, boots, weapon, ring } from "./pixelGear";

// Original, composable pixel art. Body and each equipment slot are separate drawing
// passes, so taking off a helmet or swapping a weapon cannot leave baked-in armor.
const ink = "#202829", skin = "#cf9e78", skinLight = "#edc39a";
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

type RenderLayer = keyof HeroAppearance["slots"] | "body";
function drawHero(ctx: CanvasRenderingContext2D, look: HeroAppearance, pose: Pose | "flash", frame: number, layer?: RenderLayer) {
  const p = new Pixels(ctx), cls = look.classId, s = look.slots, b = CLASS_BODIES[cls];
  const show = (part: RenderLayer) => !layer || layer === part;
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
    if (frame >= 2) { ctx.translate(26, -13); ctx.rotate(-Math.PI / 2); }
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
    : attack === "ranger" && striking ? [0, -23] : [-9, b.hips];
  const front: Point = [frontBase[0], frontBase[1] + crouch], back: Point = [backBase[0], backBase[1] + crouch];
  const shoulderY = b.shoulders + 4 + crouch;
  const arm = (hand: Point, near: boolean) => {
    const shoulder: Point = [(near ? 4 : -6) * b.width + lean, shoulderY];
    const elbow: Point = [near ? striking ? 11 + lean : 10 : -9,
      striking && near ? hand[1] + (cls === "warrior" ? 3 : 1) : shoulderY + 8];
    const sleeve = cls === "mage" || cls === "ranger";
    const cloth = s.chest ?? { base: b.cloth, shade: b.clothShade, light: b.clothLight };
    const color = sleeve ? cloth.base : b.skin, shade = sleeve ? cloth.shade : b.skinShade;
    if (show("body")) {
      limb(p, shoulder, elbow, b.armWidth + (sleeve ? 2 : 1), b.armWidth, color, shade, near ? (sleeve ? cloth.light : b.skinLight) : shade);
      limb(p, elbow, hand, b.armWidth, 2, sleeve && cls === "mage" ? cloth.base : b.skin,
        sleeve && cls === "mage" ? cloth.shade : b.skinShade, near ? b.skin : b.skinShade);
    }
    if (show("chest") && near && s.chest && cls === "warrior") {
      p.poly(ink, [[shoulder[0] - 3, shoulder[1] - 3], [shoulder[0] + 3, shoulder[1] - 3], [shoulder[0] + 4, shoulder[1] + 2], [shoulder[0] - 4, shoulder[1] + 3]]);
      p.rect(cloth.base, shoulder[0] - 3, shoulder[1] - 2, 6, 3); p.rect(cloth.light, shoulder[0] - 2, shoulder[1] - 2, 4, 1);
    }
    if (show("body")) {
      p.poly(ink, [[hand[0] - 1, hand[1] - 2], [hand[0] + 3, hand[1] - 2], [hand[0] + 4, hand[1]], [hand[0] + 3, hand[1] + 3], [hand[0] - 1, hand[1] + 2]]);
      p.rect(b.skin, hand[0], hand[1] - 1, 3, 3); p.rect(b.skinLight, hand[0], hand[1] - 1, 3, 1);
    }
    if (show("gloves") && s.gloves) glove(p, s.gloves, hand, b.skin, elbow);
    if (show("weapon") && s.weapon && cls === "monk") weapon(p, s.weapon, hand, striking);
  };
  // Far arm first, then legs/body/head, then the near arm and held equipment.
  arm(back, false);
  for (const [i, foot] of b.feet.entries()) {
    const hip: Point = [i ? 3 : -4, b.hips];
    const knee: Point = [foot + (striking ? 2 : 1), Math.round(b.hips / 2) - 1];
    const ankle: Point = [foot + 1, -3];
    if (show("body")) {
      limb(p, hip, knee, b.legWidth + 1, b.legWidth, b.trousers, b.clothShade, i ? b.cloth : b.clothShade);
      limb(p, knee, ankle, b.legWidth, b.legWidth - 1, b.trousers, b.clothShade, b.cloth);
      p.line(b.clothLight, [knee[0] - 1, knee[1]], [knee[0] + 1, knee[1] + 1]);
    }
    if (s.boots && show("boots")) boots(p, s.boots, foot - 1, -2, b.skin, b.skinLight);
    else if (!s.boots && show("body")) {
      p.poly(ink, [[foot - 2, -4], [foot + 2, -4], [foot + 5, -2], [foot + 5, 0], [foot - 2, 0]]);
      p.rect(b.skinShade, foot - 1, -3, 4, 2); p.rect(b.skin, foot, -2, 4, 1);
    }
  }
  if (show("body")) everydayClothes(torso, b, cls);
  if (show("chest") && s.chest) chest(torso, s.chest);
  if (show("body")) face(skull, b, cls, pose === "idle" ? frame >= 2 ? 1 : 0 : striking ? 1 : 0);
  if (show("head") && s.head) head(skull, s.head);
  arm(front, true);
  if (s.weapon && cls !== "monk") {
    if (show("weapon")) weapon(p, s.weapon, front, striking);
    // Fingers cross in front of the grip, so a held weapon reads as held.
    if (!layer) {
      p.rect(s.gloves?.base ?? b.skin, front[0], front[1], 3, 1);
      p.rect(s.gloves?.light ?? b.skinLight, front[0], front[1], 1, 1);
    }
  }
  if (show("ring") && s.ring) ring(p, s.ring, back);
  ctx.restore();
}

/** Geometry/timing comes from the existing animation contract, pixels from the equipped layers. */
export function gearAtlas(asset: ArtAsset, appearance: HeroAppearance, layer?: RenderLayer): HTMLCanvasElement {
  const canvas = document.createElement("canvas"); canvas.width = asset.atlasWidth; canvas.height = asset.atlasHeight;
  const ctx = canvas.getContext("2d")!; ctx.imageSmoothingEnabled = false;
  const pose = (asset.id.split("/")[2] ?? "idle") as Pose | "flash";
  asset.frames.forEach((f, i) => {
    ctx.save(); ctx.beginPath(); ctx.rect(f.x, f.y, asset.width, asset.height); ctx.clip();
    ctx.translate(f.x + asset.anchor.x, f.y + asset.anchor.y);
    drawHero(ctx, appearance, pose, i, layer); ctx.restore();
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
  ctx.translate(16, 29);
  switch (s.slot) {
    case "head": ctx.translate(0, 21); head(p, s); break;
    case "chest": ctx.translate(0, 3); chest(p, s); break;
    case "boots": boots(p, s, -7, -6); boots(p, s, 2, -2); break;
    case "gloves": ctx.scale(2, 2); glove(p, s, [-5, -7]); glove(p, s, [1, -5]); break;
    case "weapon":
      if (s.classId === "monk") { ctx.scale(2, 2); weapon(p, s, [-5, -7], false); weapon(p, s, [1, -5], false); }
      else { weapon(new Pixels(ctx, (x, y) => [x * 0.72, y * 0.72]), s, [-5, -8], false); }
      break;
    case "ring": ring(p, s); break;
  }
  return canvas;
}
