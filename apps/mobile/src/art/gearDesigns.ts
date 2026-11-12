import type { SlotId } from "@emberbound/shared-types";
import type { HeroClass } from "./gearSkins";
export interface GearDesign {
    /** Named design, independent of rarity, copy ID, upgrade level and item stats. */
    shape: string;
    cut: HeroClass;
    variant: number;
    base: string;
    shade: string;
    light: string;
    trim: string;
}
type Palette = readonly [
    string,
    string,
    string,
    string
];
interface NamedDesign {
    slot: SlotId;
    colors: Palette;
}
const piece = (slot: SlotId, colors: Palette): NamedDesign => ({ slot, colors });
/** Deliberately authored materials for every live item family. No rarity lookup. */
export const NAMED_GEAR: Record<string, NamedDesign> = {
    linen_hood: piece("head", ["#b5a88b", "#6b6655", "#e0d7b6", "#877253"]),
    scout_hood: piece("head", ["#6d8456", "#354e3a", "#a7b883", "#c0a374"]),
    seers_circlet: piece("head", ["#819aa3", "#435663", "#c5d8d8", "#b5a2df"]),
    crown_of_thorns: piece("head", ["#806447", "#483f32", "#b5a773", "#a2c477"]),
    cinder_crown: piece("head", ["#ad7852", "#593e38", "#e9b779", "#ef8955"]),
    scribe_hood: piece("head", ["#63587b", "#363649", "#a49cc0", "#ded1a0"]),
    watch_helm: piece("head", ["#85999c", "#46535d", "#c9d4cb", "#b7a173"]),
    trail_tunic: piece("chest", ["#a39573", "#5e5b48", "#d3c7a1", "#76583e"]),
    rootwoven_coat: piece("chest", ["#728363", "#3c5146", "#b5b28a", "#b09864"]),
    ironbark_mantle: piece("chest", ["#817961", "#444c42", "#b4b79b", "#88a078"]),
    cinderweave: piece("chest", ["#8b5145", "#493a40", "#c08a68", "#eab77b"]),
    last_light_vest: piece("chest", ["#d3c7a4", "#7b7f76", "#f5e7bd", "#c9a65c"]),
    temple_vest: piece("chest", ["#b58a43", "#73543a", "#e6c582", "#864938"]),
    spellweave_robe: piece("chest", ["#586d94", "#303e63", "#9ca9ce", "#bfa6d9"]),
    bastion_mail: piece("chest", ["#869594", "#465762", "#c5ccc1", "#ab895e"]),
    worn_grips: piece("gloves", ["#917256", "#55463b", "#bfa17d", "#d6be92"]),
    duelist_gloves: piece("gloves", ["#7f4d43", "#453837", "#ba8371", "#d0ad76"]),
    flowing_wraps: piece("gloves", ["#779a9d", "#3d5e6c", "#bed3cb", "#dfd0a5"]),
    venom_grips: piece("gloves", ["#70814e", "#364a3c", "#adc67f", "#d5bc67"]),
    hands_of_the_dawn: piece("gloves", ["#c9ab6d", "#7c634b", "#f2df9f", "#d98253"]),
    fletchers_gloves: piece("gloves", ["#947e54", "#504c36", "#c3b585", "#91b397"]),
    road_boots: piece("boots", ["#84664c", "#4b4036", "#b49b72", "#c3b18d"]),
    windstep_boots: piece("boots", ["#657d77", "#354f50", "#a1bdb0", "#d0c4a0"]),
    huntsmans_stride: piece("boots", ["#786b43", "#414733", "#afa66f", "#d2b282"]),
    pilgrims_pace: piece("boots", ["#927460", "#5a4650", "#cbb69a", "#a8b5d0"]),
    ghostwalk: piece("boots", ["#647c95", "#34445e", "#b1cbd7", "#9ed9dc"]),
    courtyard_sandals: piece("boots", ["#aa7a48", "#694b31", "#e2bf7e", "#cfb489"]),
    thorntrail_boots: piece("boots", ["#60734c", "#35452e", "#a3b280", "#c5aa72"]),
    copper_band: piece("ring", ["#b4784f", "#6e4836", "#e7b385", "#da9665"]),
    amber_ring: piece("ring", ["#bd944e", "#725635", "#ebcf81", "#eda54d"]),
    ember_seal: piece("ring", ["#976449", "#583b36", "#dab288", "#f07b48"]),
    moonlit_loop: piece("ring", ["#9eabc7", "#5c6083", "#e2def0", "#b1a8e1"]),
    oath_of_embers: piece("ring", ["#bc9a66", "#745147", "#f0d3a4", "#eeaa73"]),
    wayfarer_blade: piece("weapon", ["#9fada9", "#586772", "#e2e3c9", "#9c7b51"]),
    briar_edge: piece("weapon", ["#7c9981", "#3c5651", "#c8d7af", "#a5b67a"]),
    bloodletter: piece("weapon", ["#b38682", "#593d4d", "#e8c6bd", "#db694e"]),
    iron_vow: piece("weapon", ["#788797", "#3b485b", "#bdccd0", "#c9b687"]),
    kingsfall: piece("weapon", ["#c6b583", "#6c5a49", "#f1e1af", "#bd6552"]),
    apprentice_staff: piece("weapon", ["#a18359", "#594e3a", "#d5bc86", "#b7a585"]),
    willow_focus: piece("weapon", ["#72805b", "#414b38", "#b8bd87", "#9fc384"]),
    coalheart_staff: piece("weapon", ["#805749", "#443738", "#bd8e64", "#ed8b55"]),
    stormcaller: piece("weapon", ["#697e9a", "#3c4665", "#bac9e1", "#b1dce8"]),
    starfall_spire: piece("weapon", ["#8b739f", "#4d416c", "#d2b8dd", "#f0d897"]),
    trail_bow: piece("weapon", ["#a08457", "#584a38", "#d4c394", "#80644b"]),
    yew_shortbow: piece("weapon", ["#a56c4c", "#5b3e35", "#d9aa78", "#c2b075"]),
    viper_bow: piece("weapon", ["#829153", "#405139", "#bacc89", "#c7a75c"]),
    gale_bow: piece("weapon", ["#8dabb0", "#465c70", "#cbe0d6", "#a3ccdf"]),
    venomstring: piece("weapon", ["#526d61", "#293e3e", "#9cb98a", "#dfba72"]),
    wayfarer_wraps: piece("weapon", ["#b0a58b", "#716953", "#e1d9b5", "#a78a60"]),
    reedweave_wraps: piece("weapon", ["#929255", "#535c38", "#d0ca8d", "#b09457"]),
    iron_palm_wraps: piece("weapon", ["#8b9b9c", "#485766", "#c7d3cb", "#b29561"]),
    thunder_palm_wraps: piece("weapon", ["#7c7eaa", "#414e73", "#c1c4e2", "#a6d5e9"]),
    stillwater_fists: piece("weapon", ["#72a0a0", "#3c5d72", "#bde0d1", "#d8c795"]),
};
export const CLASS_CUT = { monk: 0, warrior: 1, mage: 2, ranger: 3 } as const;
export function namedGearDesign(family: string, cls: HeroClass, slot: SlotId): GearDesign {
    const entry = NAMED_GEAR[family];
    if (!entry || entry.slot !== slot)
        throw new Error(`Missing pixel gear design: ${cls}/${family}/${slot}`);
    const [base, shade, light, trim] = entry.colors;
    return { shape: family, cut: cls, variant: CLASS_CUT[cls], base, shade, light, trim };
}
