import type { HeroClass } from "./gearSkins";

/** Visual anatomy only. Combat attributes, cadence and outcomes remain in game-core. */
export interface ClassBody {
  shoulders: number;
  hips: number;
  width: number;
  headWidth: number;
  armWidth: number;
  legWidth: number;
  feet: readonly [number, number];
  skin: string;
  skinLight: string;
  skinShade: string;
  hair: string;
  hairLight: string;
  cloth: string;
  clothLight: string;
  clothShade: string;
  trousers: string;
  reach: number;
}

export const CLASS_BODIES: Record<HeroClass, ClassBody> = {
  monk: { shoulders: -30, hips: -16, width: 0.95, headWidth: 0.9, armWidth: 3, legWidth: 5, feet: [-11, 4],
    skin: "#ad7853", skinLight: "#d6a67a", skinShade: "#754b39", hair: "#40372e", hairLight: "#77634a",
    cloth: "#c4b99b", clothLight: "#e2d8b9", clothShade: "#81765f", trousers: "#918369", reach: 26 },
  warrior: { shoulders: -31, hips: -15, width: 1.28, headWidth: 1.08, armWidth: 5, legWidth: 6, feet: [-13, 5],
    skin: "#c18c70", skinLight: "#e3b092", skinShade: "#8b5c4d", hair: "#49352c", hairLight: "#755340",
    cloth: "#8f8472", clothLight: "#b4a58b", clothShade: "#5e574d", trousers: "#62605a", reach: 22 },
  mage: { shoulders: -36, hips: -19, width: 0.76, headWidth: 0.87, armWidth: 2, legWidth: 3, feet: [-7, 2],
    skin: "#b7a18c", skinLight: "#d9c7af", skinShade: "#82756b", hair: "#aaa99f", hairLight: "#dedbc8",
    cloth: "#797d90", clothLight: "#a6a7b5", clothShade: "#4f5466", trousers: "#555866", reach: 24 },
  ranger: { shoulders: -33, hips: -18, width: 0.83, headWidth: 0.86, armWidth: 3, legWidth: 4, feet: [-12, 6],
    skin: "#b59368", skinLight: "#dac09a", skinShade: "#7d644d", hair: "#6b392b", hairLight: "#a3633b",
    cloth: "#7e8b70", clothLight: "#aab496", clothShade: "#4b5b49", trousers: "#5c6350", reach: 27 },
};
