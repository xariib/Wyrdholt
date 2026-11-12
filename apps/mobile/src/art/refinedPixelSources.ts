import type { HeroClass } from "./gearSkins";
export const REFINED_PIXEL_SCALE = 2;
export const REFINED_LINEUP = { file: "art/refined-pixel/poses-v1.png", width: 1254, height: 1254 };
export const REFINED_CLASSES = ["monk", "warrior", "mage", "ranger"] as const;
const shared = {
    ringsA: ["copper_band", "amber_ring", "ember_seal"],
    heads: ["linen_hood", "scout_hood", "seers_circlet", "crown_of_thorns", "cinder_crown"],
    ringsB: ["moonlit_loop", "oath_of_embers"],
    chests: ["trail_tunic", "rootwoven_coat", "ironbark_mantle", "cinderweave", "last_light_vest"],
    glovesA: ["worn_grips", "duelist_gloves", "flowing_wraps"],
    boots: ["road_boots", "windstep_boots", "huntsmans_stride", "pilgrims_pace", "ghostwalk"],
    glovesB: ["venom_grips", "hands_of_the_dawn"],
};
const weapons: Record<HeroClass, string[]> = {
    monk: ["wayfarer_wraps", "reedweave_wraps", "iron_palm_wraps", "thunder_palm_wraps", "stillwater_fists"],
    warrior: ["wayfarer_blade", "briar_edge", "bloodletter", "iron_vow", "kingsfall"],
    mage: ["apprentice_staff", "willow_focus", "coalheart_staff", "stormcaller", "starfall_spire"],
    ranger: ["trail_bow", "yew_shortbow", "viper_bow", "gale_bow", "venomstring"],
};
const unique: Record<HeroClass, readonly [
    string,
    string
]> = {
    monk: ["courtyard_sandals", "temple_vest"], warrior: ["watch_helm", "bastion_mail"],
    mage: ["scribe_hood", "spellweave_robe"], ranger: ["fletchers_gloves", "thorntrail_boots"],
};
export function refinedGearFamilies(cls: HeroClass): readonly string[] {
    return [...weapons[cls], ...shared.ringsA, ...shared.heads, ...shared.ringsB, unique[cls][0],
        ...shared.chests, ...shared.glovesA, ...shared.boots, ...shared.glovesB, unique[cls][1]];
}
export function refinedGearSource(cls: HeroClass) {
    return { file: `art/refined-pixel/${cls}-gear-v1.png`, width: 1774, height: 887 };
}
