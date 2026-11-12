import type { GearSkin } from "./gearSkins";
import { Pixels, type PixelPoint as Point } from "./pixels";
const ink = "#202829";
export function head(p: Pixels, s: GearSkin) {
    const { base, shade, light, trim, family: f, classId: c } = s, v = s.design.variant;
    if (f === "linen_hood" || f === "scout_hood" || f === "scribe_hood") {
        if (c === "monk") {
            p.poly(ink, [[-6, -41], [4, -41], [6, -38], [-5, -37]]);
            p.line(base, [-5, -40], [4, -39], 2);
            p.line(light, [-4, -40], [1, -40]);
            const tail = f === "linen_hood" ? 4 : 8;
            p.poly(shade, [[-5, -39], [-8, -36], [-8 - tail / 2, -36 + tail], [-5, -34]]);
            p.line(trim, [-6, -37], [-7, -33]);
            if (f === "scout_hood")
                p.rect(trim, 2, -41, 2, 2);
        }
        else {
            const pointed = f === "scribe_hood" ? 3 : f === "scout_hood" ? 1 : 0;
            p.poly(ink, [[-8, -31], [-8, -39], [-5 - pointed, -44 - pointed], [0, -45], [6, -41], [7, -38], [3, -38], [-2, -40], [-4, -36], [-3, -31]]);
            p.poly(shade, [[-7, -32], [-7, -39], [-4 - pointed, -43 - pointed], [0, -44], [5, -41], [5, -39], [2, -40], [-2, -41], [-5, -36], [-4, -32]]);
            p.line(base, [-6, -40], [-3 - pointed, -43 - pointed], 2);
            p.line(light, [-3, -43], [1, -43]);
            p.line(base, [-6, -38], [-5, -33]);
            if (c === "mage") {
                p.rect(base, -8, -33, 3, 7);
                p.line(trim, [-6, -37], [-6, -29]);
            }
            if (c === "warrior") {
                p.rect(shade, -7, -34, 3, 5);
                p.rect(trim, -6, -33, 1, 3);
            }
            if (c === "ranger" && f === "scout_hood") {
                p.line(ink, [-6, -40], [-11, -44], 2);
                p.line(light, [-6, -40], [-10, -43]);
            }
            if (f === "scribe_hood") {
                p.rect(trim, -5, -41, 2, 2);
                p.line(trim, [-5, -36], [-5, -33]);
                p.rect(light, -4, -34, 1, 1);
            }
        }
    }
    else if (f === "watch_helm") {
        p.poly(ink, [[-8, -38], [-7, -43], [-3, -46], [2, -45], [6, -41], [7, -38], [5, -36], [4, -33], [2, -34], [3, -39], [-3, -40], [-4, -34], [-7, -34]]);
        p.poly(shade, [[-7, -38], [-6, -42], [-3, -45], [2, -44], [5, -41], [5, -39], [2, -40], [-3, -41], [-5, -36], [-6, -35]]);
        p.line(base, [-5, -42], [1, -44], 2);
        p.line(light, [-4, -43], [0, -44]);
        p.line(trim, [-6, -39], [4, -39]);
        p.line(base, [-6, -38], [-6, -34]);
        p.rect(light, 3, -38, 1, 3);
    }
    else {
        // Every circlet/crown sits across the brow and uses the skull's pose transform.
        p.line(ink, [-6, -40], [4, -39], 3);
        p.line(base, [-5, -40], [4, -39], 2);
        p.line(light, [-4, -40], [1, -40]);
        if (f === "seers_circlet") {
            p.poly(ink, [[0, -42], [3, -44], [6, -41], [3, -37]]);
            p.poly(trim, [[1, -41], [3, -43], [5, -41], [3, -38]]);
            p.rect(light, 3, -42, 1, 2);
            if (c === "mage")
                p.line(trim, [-5, -40], [-5, -34]);
            if (c === "ranger")
                p.line(base, [-5, -40], [-9, -42]);
            if (c === "warrior")
                p.rect(shade, -5, -38, 3, 3);
            if (c === "monk")
                p.rect(trim, -3, -41, 2, 2);
        }
        else if (f === "crown_of_thorns") {
            p.line(shade, [-6, -42], [4, -40], 2);
            for (const [x, y] of [[-5, -44], [-1, -43], [3, -45]] as const) {
                p.line(ink, [x, y + 4], [x - 2, y], 2);
                p.line(base, [x, y + 3], [x - 1, y]);
            }
            p.line(trim, [-3, -42], [-6 - v % 2, -45]);
            p.rect(light, 1, -40, 1, 1);
            if (c === "mage")
                p.line(shade, [-6, -41], [-7, -35]);
            if (c === "warrior")
                p.rect(trim, -4, -42, 2, 2);
            if (c === "ranger")
                p.poly(trim, [[-5, -43], [-9, -45], [-8, -41]]);
        }
        else if (f === "cinder_crown") {
            const high = c === "mage" ? -48 : -46;
            p.poly(ink, [[-6, -39], [-7, -44], [-3, -42], [-1, high], [2, -42], [5, -45], [5, -38]]);
            p.poly(base, [[-5, -40], [-5, -43], [-2, -41], [-1, high + 2], [2, -41], [4, -43], [4, -39]]);
            p.line(light, [-5, -40], [3, -39]);
            p.rect(trim, 1, -42, 2, 3);
            if (c === "monk")
                p.rect(shade, -5, -38, 2, 2);
            if (c === "warrior")
                p.rect(light, -4, -43, 2, 2);
            if (c === "ranger")
                p.line(shade, [-6, -41], [-8, -43]);
        }
    }
}
export function chest(p: Pixels, s: GearSkin) {
    const { classId: c, family: f, base, shade, light, trim } = s;
    const robe = c === "mage", wrap = c === "monk", plate = c === "warrior";
    const cloak = ["rootwoven_coat", "ironbark_mantle", "cinderweave", "last_light_vest", "spellweave_robe"].includes(f);
    const hem = robe ? -3 : wrap ? -9 : c === "ranger" ? -10 : -12;
    const split = f === "rootwoven_coat" ? 4 : f === "cinderweave" ? 3 : 1;
    if (cloak) {
        const end = f === "last_light_vest" ? -5 : f === "rootwoven_coat" ? -8 : -10;
        p.poly(ink, [[-7, -29], [-11, -25], [-13, end], [-7, end - 2], [-3, end + 1], [4, end - 1], [5, -26]]);
        p.poly(shade, [[-7, -28], [-10, -24], [-12, end - 1], [-7, end - 3], [-3, end], [3, end - 2], [4, -25]]);
        p.line(base, [-8, -26], [-10, end - 2]);
        if (c === "ranger")
            p.line(trim, [-10, -22], [-11, end - 3]);
    }
    p.poly(ink, [[-7, -29], [4, -29], [9, -25], [5, -17], [8, hem - 1], [2, hem], [-1, hem - split], [-9, hem], [-7, -18], [-10, -25]]);
    p.poly(shade, [[-6, -28], [4, -28], [8, -25], [4, -17], [7, hem - 2], [2, hem - 1], [-1, hem - split - 1], [-8, hem - 1], [-6, -19], [-9, -25]]);
    p.poly(base, [[-5, -28], [1, -28], [6, -25], [2, -18], [4, hem - 2], [0, hem - 2], [-3, -18], [-6, -23]]);
    p.poly(light, [[-5, -27], [-2, -28], [0, -26], [-4, -23], [-6, -24]]);
    if (wrap) {
        p.poly(light, [[-5, -28], [-3, -29], [5, -19], [3, -18]]);
        p.line(shade, [4, -28], [-3, -19]);
    }
    if (robe) {
        p.line(light, [-4, -20], [-6, hem - 2]);
        p.line(shade, [2, -25], [4, hem - 2]);
    }
    if (c === "ranger") {
        p.line(ink, [-6, -27], [5, -17], 3);
        p.line(trim, [-5, -27], [5, -17]);
    }
    if (f === "trail_tunic") {
        p.line(shade, [0, -25], [0, -18]);
        p.rect(trim, 1, -24, 1, 1);
        p.rect(trim, 1, -21, 1, 1);
        p.rect(shade, -6, -13, 3, 2);
        p.line(light, [-6, -12], [-4, -12]);
        if (plate)
            p.rect(base, -8, -27, 5, 5);
    }
    else if (f === "rootwoven_coat") {
        for (const y of [-25, -21, -13]) {
            p.line(trim, [-5, y], [-2, y + 2]);
            p.line(shade, [-2, y + 2], [1, y]);
        }
        p.poly(trim, [[2, -26], [5, -28], [4, -23]]);
        if (plate) {
            p.line(ink, [-8, -28], [-3, -25], 3);
            p.line(base, [-8, -28], [-3, -25]);
        }
    }
    else if (f === "ironbark_mantle") {
        for (const x of [-5, -1, 3]) {
            p.line(ink, [x, -26], [x + 1, -18], 3);
            p.line(base, [x, -26], [x + 1, -19]);
            p.rect(light, x, -25, 1, 3);
        }
        p.line(trim, [-6, -18], [5, -18]);
        p.poly(shade, [[-10, -28], [-7, -31], [-3, -28], [-4, -24], [-9, -24]]);
        if (!wrap)
            p.line(light, [-8, -28], [-4, -26]);
    }
    else if (f === "cinderweave") {
        p.poly(shade, [[-5, -25], [2, -28], [5, -24], [2, -20], [-3, -19]]);
        p.poly(trim, [[-2, -24], [0, -27], [1, -23], [3, -24], [2, -20], [-1, -21]]);
        for (const x of [-6, -2, 3])
            p.line(trim, [x, hem - 1], [x + 1, hem - 4]);
        if (plate)
            p.rect(base, -9, -27, 6, 3);
    }
    else if (f === "last_light_vest") {
        p.line(trim, [-6, -27], [0, -21], 2);
        p.line(trim, [5, -27], [0, -21], 2);
        p.line(light, [-5, -26], [-1, -22]);
        p.rect(trim, -1, -22, 3, 5);
        p.line(trim, [-7, hem - 2], [6, hem - 2]);
        if (plate) {
            p.poly(ink, [[-10, -27], [-8, -31], [-3, -29], [-2, -25], [-8, -23]]);
            p.poly(light, [[-9, -27], [-7, -30], [-4, -28], [-3, -26], [-7, -24]]);
        }
        if (wrap)
            p.poly(trim, [[1, -15], [4, -15], [6, -6], [2, -5]]);
    }
    else if (f === "temple_vest") {
        p.poly(shade, [[-7, -28], [-2, -27], [3, -20], [1, -18], [-4, -23]]);
        p.line(trim, [-4, -27], [2, -20], 2);
        p.rect(light, 2, -25, 3, 3);
        p.rect(trim, 3, -24, 1, 1);
        p.poly(trim, [[-1, -16], [3, -16], [2, -7], [-1, -5], [-3, -8]]);
    }
    else if (f === "spellweave_robe") {
        p.poly(shade, [[-6, -29], [-2, -31], [5, -27], [6, -24], [-1, -25]]);
        for (const y of [-24, -19, -10]) {
            p.poly(trim, [[-3, y], [-1, y - 2], [1, y], [-1, y + 2]]);
            p.rect(light, -1, y, 1, 1);
        }
        p.line(trim, [5, -24], [5, -6]);
        p.line(light, [-7, -5], [5, -5]);
    }
    else if (f === "bastion_mail") {
        p.poly(ink, [[-6, -27], [3, -28], [7, -24], [4, -19], [-1, -18], [-7, -22]]);
        p.poly(base, [[-5, -26], [3, -27], [6, -24], [3, -20], [-1, -19], [-6, -22]]);
        for (let y = -24; y < -18; y += 2)
            for (let x = -4; x < 4; x += 3)
                p.rect(light, x + (y % 4 ? 1 : 0), y, 1, 1);
        p.line(trim, [-6, -20], [-1, -18]);
        p.rect(shade, -9, -28, 5, 5);
        p.line(light, [-8, -28], [-5, -28]);
    }
    p.rect(ink, -7, -16, 14, 3);
    p.rect(shade, -6, -15, 12, 2);
    p.rect(trim, 2, -15, 2, 2);
    // Class-specific seams remain visible even when several named pieces share a material.
    if (c === "warrior")
        p.line(light, [-5, hem - 2], [-2, hem - 2]);
    if (c === "monk")
        p.line(light, [-6, -18], [-3, -17]);
}
/** Cuff axis follows the forearm; the palm and grip share the same hand joint. */
export function glove(p: Pixels, s: GearSkin, hand: Point, tone = "#cf9e78", elbow: Point = [hand[0], hand[1] - 8]) {
    const dx = hand[0] - elbow[0], dy = hand[1] - elbow[1], length = Math.hypot(dx, dy) || 1, ux = dx / length, uy = dy / length;
    const q = new Pixels(p.ctx, (x, y) => p.map(hand[0] + 1 + x * uy + y * ux, hand[1] + x * -ux + y * uy));
    const f = s.family, v = s.design.variant, len = f === "duelist_gloves" ? 6 : f === "flowing_wraps" ? 5 : f === "fletchers_gloves" ? 3 : 4;
    const width = s.classId === "warrior" ? 5 : s.classId === "mage" ? 3 : 4;
    q.poly(ink, [[-2, -len], [2, -len], [width - 2, -1], [2, 3], [-2, 3], [-3, 0]]);
    q.rect(s.shade, -1, -len + 1, 3, len + 1);
    q.rect(s.base, -2, -1, width, 3);
    q.line(s.light, [-1, -len + 1], [-1, 0]);
    if (f === "worn_grips") {
        q.rect(tone, 0, 1, 2, 2);
        q.line(s.trim, [-1, -2], [1, -1]);
    }
    if (f === "duelist_gloves") {
        q.line(s.trim, [-2, -len + 1], [2, -len + 1]);
        q.rect(s.light, 0, -3, 2, 3);
        q.rect(s.shade, 1, 1, 1, 1);
    }
    if (f === "flowing_wraps") {
        for (const y of [-4, -2, 0, 2])
            q.line(s.light, [-2, y], [2, y + 1]);
        q.rect(s.trim, 1, -3, 1, 2);
    }
    if (f === "venom_grips") {
        q.poly(s.trim, [[-1, -3], [2, -2], [0, 0], [2, 2], [-1, 1]]);
        q.rect(s.light, 1, -3, 1, 1);
    }
    if (f === "hands_of_the_dawn") {
        q.poly(s.light, [[-2, -2], [0, -4], [2, -2], [3, 1], [0, 0], [-2, 2]]);
        q.rect(s.trim, 0, -1, 1, 3);
    }
    if (f === "fletchers_gloves") {
        q.rect(tone, 1, 1, 2, 2);
        q.line(s.trim, [-2, -2], [1, 0]);
        q.rect(s.light, -1, -3, 2, 1);
    }
    if (v === 0)
        q.rect(s.trim, -2, 0, 1, 2);
    if (v === 1)
        q.rect(s.base, -3, -2, 2, 2);
    if (v === 2)
        q.line(s.trim, [1, -len], [2, -len + 2]);
    if (v === 3)
        q.rect(s.light, 2, 0, 1, 2);
}
export function boots(p: Pixels, s: GearSkin, x: number, y: number, tone = "#cf9e78", highlight = "#edc39a") {
    const f = s.family, c = s.classId, v = s.design.variant;
    const sandal = f === "courtyard_sandals" || (c === "monk" && (f === "road_boots" || f === "pilgrims_pace"));
    const high = f === "huntsmans_stride" || f === "thorntrail_boots" ? 7 : f === "ghostwalk" ? 6 : f === "road_boots" ? 4 : 5;
    const toe = c === "ranger" ? 6 : c === "mage" ? 5 : 4;
    p.poly(ink, [[x - 1, y - high], [x + 4, y - high], [x + 4, y - 2], [x + toe, y], [x + toe, y + 2], [x - 1, y + 2]]);
    p.rect(sandal ? tone : s.shade, x, y - high + 1, 4, high + 1);
    p.rect(sandal ? highlight : s.base, x + 1, y - 1, toe - 1, 2);
    if (sandal) {
        p.line(s.shade, [x, y - high + 2], [x + 3, y - 1]);
        p.line(s.trim, [x + 3, y - high + 2], [x, y]);
    }
    else {
        p.rect(s.base, x + 1, y - high + 1, 2, high - 1);
        p.line(s.light, [x + 1, y], [x + toe - 1, y]);
    }
    if (f === "road_boots")
        p.rect(s.trim, x, y - high + 1, 4, 1);
    if (f === "windstep_boots") {
        p.poly(s.trim, [[x - 1, y - 4], [x - 3, y - 6], [x - 1, y - 2], [x + 2, y - 1]]);
        p.rect(s.light, x + 2, y - 3, 2, 1);
    }
    if (f === "huntsmans_stride") {
        p.rect(s.light, x - 1, y - 7, 5, 2);
        p.rect(s.trim, x + 2, y - 4, 2, 2);
    }
    if (f === "pilgrims_pace") {
        p.line(s.trim, [x, y - 4], [x + 3, y - 2]);
        p.line(s.light, [x + 3, y - 4], [x, y - 2]);
        p.rect(s.shade, x + 2, y, 2, 1);
    }
    if (f === "ghostwalk") {
        p.line(s.trim, [x, y - 5], [x + 2, y - 1]);
        p.rect(s.light, x + 2, y, 3, 1);
        p.rect(s.shade, x + 1, y - 3, 1, 1);
    }
    if (f === "courtyard_sandals") {
        p.rect(s.trim, x - 1, y - 3, 5, 1);
        p.rect(s.light, x + 2, y - 2, 1, 3);
    }
    if (f === "thorntrail_boots") {
        p.line(s.trim, [x, y - 6], [x + 3, y - 1]);
        p.line(s.light, [x + 1, y - 4], [x - 1, y - 5]);
        p.rect(s.trim, x + 3, y - 6, 2, 1);
    }
    // Monk bindings, Warrior heel plate, Mage turned toe, Ranger laced shin.
    if (v === 0)
        p.rect(s.light, x, y - 2, 3, 1);
    if (v === 1)
        p.rect(s.shade, x - 1, y - 1, 2, 3);
    if (v === 2)
        p.rect(s.trim, x + toe - 1, y - 1, 2, 1);
    if (v === 3)
        p.rect(s.light, x + 2, y - high + 2, 1, 2);
}
export function weapon(p: Pixels, s: GearSkin, hand: Point, striking: boolean) {
    const { base, shade, light, trim, family: f, classId: c } = s;
    // (0,0) is the palm. All shafts, wraps and bow grips physically cross it.
    const origin: Point = [hand[0] + 1, hand[1] + 1];
    const q = new Pixels(p.ctx, (x, y) => p.map(origin[0] + x, origin[1] + y));
    if (c === "monk") {
        q.rect(ink, -2, -2, 5, 5);
        q.rect(base, -1, -1, 4, 3);
        if (f === "wayfarer_wraps") {
            q.line(light, [-1, -1], [2, 0]);
            q.line(light, [-1, 1], [2, 2]);
        }
        if (f === "reedweave_wraps") {
            q.line(trim, [-1, -2], [2, 2]);
            q.line(light, [2, -2], [-1, 2]);
        }
        if (f === "iron_palm_wraps") {
            q.rect(shade, -2, -1, 5, 3);
            q.rect(light, -1, -1, 3, 1);
            q.rect(trim, 2, 0, 1, 2);
        }
        if (f === "thunder_palm_wraps") {
            q.poly(trim, [[0, -2], [2, -2], [0, 0], [2, 0], [-1, 3], [0, 1], [-1, 1]]);
            q.rect(light, -2, -1, 1, 2);
        }
        if (f === "stillwater_fists") {
            q.rect(shade, -1, -2, 4, 4);
            q.line(light, [-1, -1], [2, 0]);
            q.line(trim, [-1, 1], [2, 1]);
            q.rect(light, 1, -2, 1, 1);
        }
    }
    else if (c === "warrior") {
        // Build the blade around a grip-local axis, then rotate into the strike.
        const w = new Pixels(p.ctx, (x, y) => p.map(origin[0] + (striking ? -y : x - y * .16), origin[1] + (striking ? x : y)));
        const length = f === "wayfarer_blade" ? 20 : f === "briar_edge" ? 21 : f === "bloodletter" ? 22 : f === "iron_vow" ? 20 : 23;
        const width = f === "iron_vow" ? 4 : f === "kingsfall" ? 3 : 2;
        w.poly(ink, [[-width, -5], [-width, -length + 3], [0, -length - 1], [width, -length + 3], [width, -5]]);
        w.poly(base, [[-width + 1, -6], [-width + 1, -length + 3], [0, -length], [width - 1, -length + 3], [width - 1, -6]]);
        w.line(light, [0, -length + 2], [0, -6]);
        w.line(shade, [-width + 1, -8], [-width + 1, -length + 4]);
        w.rect(ink, -1, -4, 3, 8);
        w.rect("#77533e", 0, -3, 1, 6);
        w.rect(trim, -3, -5, 7, 2);
        w.rect(light, -2, -5, 3, 1);
        w.rect(trim, -1, 3, 3, 2);
        if (f === "briar_edge") {
            for (const y of [-10, -15, -19])
                w.poly(trim, [[-2, y], [-4, y - 2], [-2, y + 1]]);
            w.line(shade, [-2, -4], [-4, -2]);
        }
        if (f === "bloodletter") {
            w.line(trim, [1, -18], [1, -7]);
            w.poly(shade, [[1, -21], [4, -19], [2, -17]]);
            w.rect(light, 1, -7, 2, 1);
        }
        if (f === "iron_vow") {
            w.rect(trim, -3, -9, 6, 2);
            w.rect(shade, -1, -18, 2, 5);
            w.rect(light, -2, -20, 4, 1);
        }
        if (f === "kingsfall") {
            w.poly(trim, [[-4, -7], [-2, -5], [0, -8], [2, -5], [4, -7], [3, -3], [-3, -3]]);
            w.rect(trim, -1, -14, 3, 3);
            w.rect(light, 0, -14, 1, 1);
        }
    }
    else if (c === "mage") {
        const top = -24;
        q.line(ink, [-1, 13], [1, top + 3], 3);
        q.line(base, [0, 12], [2, top + 3]);
        q.line(light, [1, 9], [3, top + 4]);
        q.rect(trim, -1, -6, 4, 2);
        q.rect(shade, 0, -1, 2, 4);
        if (f === "apprentice_staff") {
            q.poly(ink, [[-1, top + 5], [-2, top], [2, top - 2], [5, top], [4, top + 5]]);
            q.poly(base, [[0, top + 4], [-1, top + 1], [2, top - 1], [4, top + 1], [3, top + 4]]);
            q.rect(light, 1, top, 2, 2);
        }
        if (f === "willow_focus") {
            q.line(ink, [2, top + 5], [-3, top - 2], 3);
            q.line(base, [2, top + 4], [-2, top - 1], 2);
            q.line(base, [2, top + 3], [6, top - 2], 2);
            q.poly(trim, [[4, top - 1], [7, top - 4], [8, top], [5, top + 2]]);
        }
        if (f === "coalheart_staff") {
            q.poly(ink, [[2, top - 4], [7, top], [5, top + 6], [-1, top + 4], [-2, top]]);
            q.poly(shade, [[2, top - 3], [6, top], [4, top + 5], [0, top + 3]]);
            q.poly(trim, [[2, top - 2], [4, top], [3, top + 3], [1, top + 1]]);
            q.rect(light, 2, top, 1, 1);
        }
        if (f === "stormcaller") {
            q.line(ink, [-2, top + 5], [-3, top - 3], 3);
            q.line(light, [-1, top + 4], [-2, top - 2]);
            q.line(base, [3, top + 4], [7, top - 3], 2);
            q.poly(trim, [[3, top - 4], [5, top - 2], [3, top], [5, top], [1, top + 5], [2, top + 1], [0, top + 1]]);
        }
        if (f === "starfall_spire") {
            q.poly(ink, [[2, top - 5], [4, top - 1], [8, top], [4, top + 2], [3, top + 6], [1, top + 2], [-3, top], [1, top - 1]]);
            q.poly(trim, [[2, top - 4], [3, top], [7, top], [3, top + 1], [3, top + 5], [2, top + 1], [-2, top], [2, top]]);
            q.rect(light, 2, top, 1, 1);
        }
    }
    else {
        const length = f === "yew_shortbow" ? 10 : f === "gale_bow" ? 15 : f === "venomstring" ? 16 : 13;
        const bend = f === "viper_bow" ? 7 : f === "venomstring" ? 8 : 5;
        // The bow's curved centre is the grip, rather than an offset beside the fist.
        const ends: Point[] = [[-bend, -length], [-2, -length / 2], [0, 0], [-2, length / 2], [-bend, length]];
        for (let i = 1; i < ends.length; i++) {
            q.line(ink, ends[i - 1]!, ends[i]!, 3);
            q.line(base, ends[i - 1]!, ends[i]!, 2);
            q.line(light, ends[i - 1]!, ends[i]!);
        }
        const pull = striking ? -10 : -bend;
        q.line("#d7caa5", ends[0]!, [pull, 0]);
        q.line("#d7caa5", [pull, 0], ends[4]!);
        q.rect(ink, -1, -2, 4, 5);
        q.rect(shade, 0, -2, 2, 5);
        q.rect(trim, 0, -1, 2, 2);
        if (f === "yew_shortbow")
            q.line(shade, [-3, -7], [-1, -4], 2);
        if (f === "viper_bow") {
            q.poly(trim, [[-6, -13], [-2, -13], [-3, -9], [-7, -10]]);
            q.rect(light, -3, -12, 1, 1);
        }
        if (f === "gale_bow") {
            q.poly(trim, [[-4, -12], [-2, -16], [0, -13], [-1, -8]]);
            q.poly(light, [[-3, 11], [-1, 15], [1, 12], [-1, 8]]);
        }
        if (f === "venomstring") {
            q.line(trim, [-7, -15], [-3, -10], 2);
            q.line(trim, [-6, 14], [-2, 9], 2);
            q.rect(light, -1, -6, 2, 2);
            q.rect(light, -1, 5, 2, 2);
        }
        if (striking) {
            q.line("#bfa87d", [pull, 0], [14, 0]);
            q.poly(light, [[13, -2], [17, 0], [13, 2]]);
        }
    }
}
export function ring(p: Pixels, s: GearSkin, hand?: Point) {
    const f = s.family, v = s.design.variant;
    if (hand) {
        const [x, y] = hand;
        p.rect(s.shade, x, y, 3, 2);
        p.rect(s.trim, x, y, 3, 1);
        const gx = x + (v % 2), gy = y - (v >= 2 ? 1 : 0);
        if (f === "amber_ring")
            p.rect(s.light, gx, gy - 1, 2, 2);
        if (f === "ember_seal")
            p.rect(s.trim, gx, gy - 1, 3, 2);
        if (f === "moonlit_loop") {
            p.rect(s.light, gx, gy - 1, 1, 3);
            p.rect(s.light, gx + 1, gy + 1, 1, 1);
        }
        if (f === "oath_of_embers") {
            p.rect(s.light, gx, gy - 2, 1, 2);
            p.rect(s.trim, gx + 1, gy - 1, 2, 2);
        }
        if (f === "copper_band")
            p.rect(s.light, x + v % 3, y, 1, 1);
        return;
    }
    const width = 8 + v, height = 9 - v % 2;
    p.poly(ink, [[-width, -22], [-3, -25], [4, -24], [width, -19], [width, -9], [3, -4], [-6, -5], [-width, -11]]);
    p.poly(s.base, [[-width + 1, -21], [-3, -24], [4, -23], [width - 1, -18], [width - 1, -10], [3, -5], [-5, -6], [-width + 1, -11]]);
    p.ctx.globalCompositeOperation = "destination-out";
    p.poly(ink, [[-width + 3, -19], [-2, -21], [3, -20], [width - 3, -17], [width - 3, -11], [2, -8], [-4, -9], [-width + 3, -12]]);
    p.ctx.globalCompositeOperation = "source-over";
    p.line(s.light, [-width + 2, -20], [-4, -22]);
    if (f === "amber_ring")
        p.poly(s.trim, [[-3, -25], [2, -27], [5, -23], [2, -19], [-2, -20]]);
    if (f === "ember_seal") {
        p.rect(ink, -4, -27, 10, 8);
        p.rect(s.trim, -3, -26, 8, 6);
        p.poly(s.light, [[-1, -22], [0, -25], [2, -23], [3, -24], [2, -21]]);
    }
    if (f === "moonlit_loop") {
        p.poly(s.light, [[-3, -27], [1, -28], [-1, -25], [-1, -22], [3, -21], [0, -20], [-4, -23]]);
    }
    if (f === "oath_of_embers") {
        p.poly(ink, [[-4, -23], [-3, -28], [0, -26], [2, -29], [5, -25], [4, -21]]);
        p.poly(s.trim, [[-3, -23], [-2, -27], [0, -24], [2, -28], [4, -25], [3, -22]]);
        p.rect(s.light, 1, -25, 1, 2);
    }
    p.rect(s.shade, -width + 2, -12, 2, height - 6);
}
