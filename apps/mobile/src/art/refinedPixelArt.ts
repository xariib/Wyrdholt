import type { ArtAsset, Pose } from "./types";
import type { GearSkin, HeroAppearance, HeroClass } from "./gearSkins";
import { refinedBodies, refinedStrikes, refinedItems, pixelsOf, raster, type PixelRaster } from "./refinedPixelAssets";
import { Pixels, type PixelPoint as Point } from "./pixels";
export { loadRefinedHero, refinedReady, refinedDecodedBytes } from "./refinedPixelAssets";
export { REFINED_PIXEL_SCALE } from "./refinedPixelSources";
type Layer = keyof HeroAppearance["slots"] | "body";
interface Rig {
    near: Point;
    far: Point;
    elbow: Point;
    farElbow: Point;
    chest: readonly [
        number,
        number,
        number,
        number
    ];
    head: Point;
    feet: readonly [
        number,
        number
    ];
    arms: readonly (readonly Point[])[];
    face: readonly Point[];
}
// Landmarks measured on the generated, normalized 128px bodies. Units are logical pixels.
const RIG: Record<HeroClass, Rig> = {
    monk: { near: [-2.5, -29.5], far: [9.5, -31], elbow: [-9, -28.5], farElbow: [8, -28], chest: [-7, -38, 15, 28], head: [1, -44], feet: [-8.5, 7],
        arms: [[[51, 45], [57, 51], [58, 55], [63, 56], [67, 63], [60, 68], [55, 65], [45, 67], [42, 62], [46, 51]], [[74, 48], [80, 50], [86, 56], [86, 67], [79, 68], [73, 59]]],
        face: [[63, 29], [72, 29], [77, 34], [76, 43], [70, 47], [63, 42]] },
    warrior: { near: [-8, -21], far: [9.5, -21], elbow: [-9, -28], farElbow: [8, -28], chest: [-7, -39, 15, 25], head: [1, -45], feet: [-8.5, 7],
        arms: [[[48, 43], [55, 48], [55, 58], [50, 65], [51, 76], [53, 81], [48, 84], [44, 81], [43, 65], [43, 59]], [[76, 47], [81, 53], [81, 63], [85, 74], [85, 82], [81, 84], [77, 79], [76, 67]]],
        face: [[64, 28], [73, 28], [78, 34], [76, 45], [69, 48], [63, 42]] },
    mage: { near: [.5, -29], far: [9.5, -24], elbow: [-7, -31], farElbow: [8, -30], chest: [-10, -40, 21, 38], head: [1.5, -46], feet: [-8, 8],
        arms: [[[50, 43], [58, 48], [58, 54], [67, 54], [73, 58], [71, 63], [61, 63], [59, 70], [53, 73], [47, 64], [47, 54]], [[79, 61], [85, 64], [87, 74], [83, 78], [79, 73]]],
        face: [[66, 25], [75, 26], [80, 31], [77, 43], [72, 50], [65, 44]] },
    ranger: { near: [-2.5, -27], far: [9.5, -21], elbow: [-7, -29], farElbow: [8, -28], chest: [-7, -37, 15, 25], head: [2, -44.5], feet: [-8, 8],
        arms: [[[48, 46], [55, 49], [56, 56], [63, 57], [67, 62], [64, 67], [57, 66], [49, 66], [46, 62], [45, 54]], [[76, 56], [80, 58], [84, 72], [86, 79], [82, 82], [79, 77], [77, 67]]],
        face: [[65, 29], [74, 29], [79, 35], [77, 44], [70, 48], [64, 42]] },
};
const STRIKE_RIG: Record<HeroClass, Rig> = {
    monk: { near: [16.5, -36.5], far: [-4.5, -30], elbow: [9.5, -36.5], farElbow: [-8.5, -29], chest: [-7, -37, 15, 27], head: [1, -43], feet: [-10.5, 10],
        arms: [[[69, 43], [79, 44], [85, 45], [98, 45], [104, 48], [103, 53], [95, 54], [83, 51], [73, 52]], [[43, 55], [49, 55], [53, 57], [60, 57], [62, 64], [55, 67], [48, 65], [42, 62]]],
        face: [[63, 31], [73, 31], [78, 37], [75, 47], [68, 49], [62, 43]] },
    warrior: { near: [16, -35], far: [-5.5, -28.5], elbow: [9, -35], farElbow: [-9, -31], chest: [-7, -38, 16, 25], head: [3, -43], feet: [-12, 11],
        arms: [[[71, 43], [81, 45], [84, 48], [97, 46], [102, 49], [102, 55], [91, 56], [81, 53], [76, 54]], [[47, 56], [54, 59], [61, 60], [63, 64], [59, 68], [51, 66], [45, 62]]],
        face: [[67, 30], [76, 30], [81, 36], [78, 47], [71, 50], [65, 43]] },
    mage: { near: [14, -40.5], far: [-6, -30], elbow: [9, -37], farElbow: [-10, -34], chest: [-10, -40, 22, 38], head: [2, -46], feet: [-12, 11],
        arms: [[[74, 43], [80, 44], [86, 41], [91, 36], [98, 37], [98, 44], [93, 46], [91, 62], [84, 64], [77, 54]], [[43, 54], [50, 54], [55, 56], [61, 58], [62, 64], [54, 65], [48, 70], [42, 66]]],
        face: [[66, 25], [76, 26], [81, 31], [78, 43], [72, 50], [65, 44]] },
    ranger: { near: [-4.5, -37.5], far: [15.5, -36.5], elbow: [-9, -35], farElbow: [9, -35.5], chest: [-7, -37, 16, 25], head: [2.5, -43], feet: [-12, 11],
        arms: [[[43, 45], [49, 43], [51, 39], [57, 39], [59, 44], [55, 47], [49, 48], [45, 51], [41, 49]], [[73, 45], [82, 47], [86, 47], [94, 44], [101, 44], [103, 49], [101, 53], [92, 52], [84, 53], [77, 52]]],
        face: [[65, 30], [75, 30], [81, 36], [78, 46], [71, 49], [64, 43]] },
};
const rigFor = (cls: HeroClass, strike: boolean) => strike ? STRIKE_RIG[cls] : RIG[cls];
const staticLayers = new Map<string, PixelRaster>();
const MAX_LAYERS = 160;
export function refinedLayerBytes(): number { return [...staticLayers.values()].reduce((n, p) => n + p.width * p.height * 8, 0); }
function ctxOf(p: PixelRaster) { const ctx = p.canvas.getContext("2d", { willReadFrequently: true })!; ctx.imageSmoothingEnabled = false; return ctx; }
function opaque(p: PixelRaster): PixelRaster {
    const ctx = ctxOf(p), d = ctx.getImageData(0, 0, p.width, p.height);
    for (let i = 3; i < d.data.length; i += 4)
        d.data[i] = d.data[i]! >= 128 ? 255 : 0;
    ctx.putImageData(d, 0, 0);
    return pixelsOf(p.canvas);
}
function item(s: GearSkin): PixelRaster {
    const result = refinedItems.get(`${s.classId}/${s.family}`);
    if (!result)
        throw new Error(`Missing refined item artwork: ${s.id}`);
    return result;
}
function paste(target: PixelRaster, source: PixelRaster, x: number, y: number, width: number, height: number) {
    ctxOf(target).drawImage(source.canvas, Math.round(64 + x * 2), Math.round(120 + y * 2), Math.round(width * 2), Math.round(height * 2));
}
function fit(source: PixelRaster, maxWidth: number, maxHeight: number): readonly [
    number,
    number
] {
    const ratio = Math.min(maxWidth / source.width, maxHeight / source.height);
    return [source.width * ratio, source.height * ratio];
}
function cuff(target: PixelRaster, s: GearSkin, hand: Point, elbow: Point, fist = false) {
    const source = item(s), [w, h] = fit(source, fist ? 5.5 : 5, fist ? 5 : 7);
    const ctx = ctxOf(target), angle = Math.atan2(hand[1] - elbow[1], hand[0] - elbow[0]) - Math.PI / 2;
    ctx.save();
    ctx.translate(Math.round(64 + hand[0] * 2), Math.round(120 + hand[1] * 2));
    ctx.rotate(angle);
    ctx.drawImage(source.canvas, -Math.round(w), -Math.round(h * 1.35), Math.round(w * 2), Math.round(h * 2));
    ctx.restore();
}
function clothingLayer(look: HeroAppearance, slot: Exclude<Layer, "body" | "weapon">, strike: boolean): PixelRaster {
    const s = look.slots[slot]!;
    const key = `${s.id}:${strike}`;
    const existing = staticLayers.get(key);
    if (existing)
        return existing;
    const p = raster(128, 128), r = rigFor(look.classId, strike), source = item(s);
    if (slot === "chest")
        paste(p, source, ...r.chest);
    if (slot === "head") {
        const hood = s.family.endsWith("hood") || s.family === "watch_helm";
        const [w, h] = fit(source, hood ? 15 : 14, hood ? 17 : s.family === "cinder_crown" ? 10 : 7);
        paste(p, source, r.head[0] - w / 2 - .5, hood ? r.head[1] - 8 : r.head[1] - h + 2, w, h);
    }
    if (slot === "boots")
        for (const foot of r.feet) {
            const [w, h] = fit(source, 8, s.family === "road_boots" || s.family === "courtyard_sandals" ? 6 : 9);
            paste(p, source, foot - 3, -h, w, h);
        }
    if (slot === "gloves") {
        cuff(p, s, r.near, r.elbow);
        cuff(p, s, r.far, r.farElbow);
    }
    if (slot === "ring") {
        const [w, h] = fit(source, 2.5, 2.5);
        const hand = look.classId === "ranger" ? r.near : r.far;
        paste(p, source, hand[0] - w / 2, hand[1] - h / 2, w, h);
    }
    const ready = opaque(p);
    if (staticLayers.size >= MAX_LAYERS)
        staticLayers.delete(staticLayers.keys().next().value!);
    staticLayers.set(key, ready);
    return ready;
}
function restore(body: PixelRaster, target: PixelRaster, shapes: readonly (readonly Point[])[]) {
    const ctx = ctxOf(target);
    ctx.save();
    ctx.beginPath();
    for (const points of shapes) {
        points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
        ctx.closePath();
    }
    ctx.clip();
    ctx.drawImage(body.canvas, 0, 0);
    ctx.restore();
}
function outfit(look: HeroAppearance, layer: Layer | undefined, strike: boolean): PixelRaster {
    const result = raster(128, 128), ctx = ctxOf(result), body = (strike ? refinedStrikes : refinedBodies).get(look.classId)!, r = rigFor(look.classId, strike);
    if (!layer || layer === "body")
        ctx.drawImage(body.canvas, 0, 0);
    for (const slot of ["boots", "chest"] as const)
        if (look.slots[slot] && (!layer || layer === slot))
            ctx.drawImage(clothingLayer(look, slot, strike).canvas, 0, 0);
    if (!layer)
        restore(body, result, r.arms);
    for (const slot of ["head", "gloves", "ring"] as const)
        if (look.slots[slot] && (!layer || layer === slot))
            ctx.drawImage(clothingLayer(look, slot, strike).canvas, 0, 0);
    if (!layer && look.slots.head && (look.slots.head.family.endsWith("hood") || look.slots.head.family === "watch_helm"))
        restore(body, result, [r.face]);
    if (look.classId === "monk" && look.slots.weapon && (!layer || layer === "weapon")) {
        cuff(result, look.slots.weapon, r.near, r.elbow, true);
        cuff(result, look.slots.weapon, r.far, r.farElbow, true);
    }
    return opaque(result);
}
function posePoint(x: number, y: number, _look: HeroAppearance, pose: Pose | "flash", frame: number): Point {
    const upper = Math.max(0, Math.min(1, (-y - 5) / 35));
    const lean = pose === "attack" ? [-.5, .5, 0, .25][frame % 4]! : 0;
    const breath = pose === "idle" ? [0, .25, .5, .25][frame % 4]! : 0;
    const recoil = pose === "hit" || pose === "flash" ? (frame ? 1 : 2) : 0;
    return [x + upper * (lean - recoil), y + upper * (breath + recoil * .25)];
}
function warped(ctx: CanvasRenderingContext2D, source: PixelRaster, look: HeroAppearance, pose: Pose | "flash", frame: number) {
    // Whole illustrated pose: only a tiny row-wise lean/breathing shift, never limb stretching.
    const d = source.rgba, colors = new Map<number, string>();
    for (let y = 0; y < 128; y++) {
        const top = posePoint(-32, y / 2 - 60, look, pose, frame), bottom = posePoint(-32, (y + 1) / 2 - 60, look, pose, frame);
        const dx = Math.round(top[0] * 2), dy = Math.round(top[1] * 2), height = Math.round(bottom[1] * 2) - dy;
        if (height <= 0)
            continue;
        for (let x = 0; x < 128;) {
            const n = (y * 128 + x) * 4;
            if (!d[n + 3]) {
                x++;
                continue;
            }
            const rgb = (d[n]! << 16) | (d[n + 1]! << 8) | d[n + 2]!, start = x++;
            while (x < 128) {
                const k = (y * 128 + x) * 4;
                if (!d[k + 3] || ((d[k]! << 16) | (d[k + 1]! << 8) | d[k + 2]!) !== rgb)
                    break;
                x++;
            }
            let color = colors.get(rgb);
            if (!color) {
                color = "#" + rgb.toString(16).padStart(6, "0");
                colors.set(rgb, color);
            }
            ctx.fillStyle = color;
            ctx.fillRect(dx + start, dy, x - start, height);
        }
    }
}
function grip(source: PixelRaster, cls: HeroClass): Point {
    const y = Math.round(source.height * (cls === "warrior" ? .86 : .5));
    let bestX = source.width / 2, best = 0;
    for (let x = 1; x < source.width - 1; x++) {
        let score = 0;
        for (let dy = -2; dy <= 2; dy++)
            for (let dx = -1; dx <= 1; dx++)
                if (source.rgba[((y + dy) * source.width + x + dx) * 4 + 3])
                    score++;
        if (score > best || (score === best && cls === "ranger")) {
            best = score;
            bestX = x;
        }
    }
    return [bestX, y];
}
function held(ctx: CanvasRenderingContext2D, look: HeroAppearance, pose: Pose | "flash", frame: number, layer?: Layer) {
    const s = look.slots.weapon;
    if (!s || look.classId === "monk")
        return;
    const strike = pose === "attack" && (frame === 1 || frame === 2), r = rigFor(look.classId, strike), hand = look.classId === "ranger" ? r.far : r.near, p = posePoint(...hand, look, pose, frame);
    const source = item(s), anchor = grip(source, look.classId);
    const h = look.classId === "warrior" ? 25 : look.classId === "mage" ? (s.family === "willow_focus" ? 37 : 38) : 29, scale = h * 2 / source.height;
    const angle = look.classId === "warrior" ? (strike ? Math.PI / 3 - .12 : .12) : look.classId === "mage" ? (strike ? -.95 : .5) : 0;
    const w = raster(144, 144), wc = ctxOf(w);
    wc.translate(Math.round(72 + p[0] * 2), Math.round(128 + p[1] * 2));
    wc.rotate(angle);
    wc.drawImage(source.canvas, -anchor[0] * scale, -anchor[1] * scale, source.width * scale, source.height * scale);
    ctx.drawImage(opaque(w).canvas, -72, -128);
    if (look.classId === "ranger" && strike) {
        const draw = posePoint(...r.near, look, pose, frame), pen = new Pixels(ctx);
        pen.line("#d5c5a0", [p[0] * 2 - 8, p[1] * 2 - 27], [draw[0] * 2, draw[1] * 2]);
        pen.line("#d5c5a0", [draw[0] * 2, draw[1] * 2], [p[0] * 2 - 8, p[1] * 2 + 27]);
        pen.line("#b99b65", [draw[0] * 2, draw[1] * 2], [p[0] * 2 + 20, draw[1] * 2]);
        pen.poly("#dadbd0", [[p[0] * 2 + 19, draw[1] * 2 - 2], [p[0] * 2 + 24, draw[1] * 2], [p[0] * 2 + 19, draw[1] * 2 + 2]]);
    }
    if (!layer) {
        const pen = new Pixels(ctx), color = look.slots.gloves?.base ?? (look.classId === "warrior" ? "#dca17f" : look.classId === "mage" ? "#e7b7a0" : "#dfad89");
        pen.rect(color, Math.round(p[0] * 2) - 1, Math.round(p[1] * 2), 4, 2);
        pen.rect("#f0c2a1", Math.round(p[0] * 2) - 1, Math.round(p[1] * 2), 1, 1);
    }
}
/** Same physical pixel grid and layers feed combat and portraits. */
export function refinedAtlas(asset: ArtAsset, look: HeroAppearance, layer?: Layer): HTMLCanvasElement {
    const c = raster(asset.atlasWidth * 2, asset.atlasHeight * 2), ctx = ctxOf(c);
    const pose = (asset.id.split("/")[2] ?? "idle") as Pose | "flash";
    for (const [i, f] of asset.frames.entries()) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(f.x * 2, f.y * 2, asset.width * 2, asset.height * 2);
        ctx.clip();
        ctx.translate((f.x + asset.anchor.x) * 2, (f.y + asset.anchor.y) * 2);
        if (pose === "death") {
            if (i >= 2) {
                ctx.translate(54, -26);
                ctx.rotate(-Math.PI / 2);
            }
            else
                ctx.translate(-i * 4, i * 3);
        }
        warped(ctx, outfit(look, layer, pose === "attack" && (i === 1 || i === 2)), look, pose, i);
        if (!layer || layer === "weapon")
            held(ctx, look, pose, i, layer);
        ctx.restore();
    }
    if (pose === "flash") {
        ctx.globalCompositeOperation = "source-in";
        ctx.fillStyle = "#fff5dc";
        ctx.fillRect(0, 0, c.width, c.height);
    }
    return c.canvas;
}
export function refinedIcon(s: GearSkin): HTMLCanvasElement {
    const source = item(s), c = raster(64, 64), ctx = ctxOf(c), [w, h] = fit(source, 56, 56);
    ctx.drawImage(source.canvas, Math.round((64 - w) / 2), Math.round((64 - h) / 2), Math.round(w), Math.round(h));
    return opaque(c).canvas;
}
