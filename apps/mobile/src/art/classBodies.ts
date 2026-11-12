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
  monk: { shoulders: -32, hips: -18, width: 0.94, headWidth: 1, armWidth: 3, legWidth: 5, feet: [-10, 4],
    skin: "#b78258", skinLight: "#e3b77d", skinShade: "#80533f", hair: "#37312d", hairLight: "#706048",
    cloth: "#b9aa81", clothLight: "#e5d7ac", clothShade: "#756e56", trousers: "#726b56", reach: 26 },
  warrior: { shoulders: -33, hips: -17, width: 1.16, headWidth: 1, armWidth: 4, legWidth: 5, feet: [-8, 5],
    skin: "#bb8567", skinLight: "#e4b58a", skinShade: "#805449", hair: "#40332e", hairLight: "#77604a",
    cloth: "#827761", clothLight: "#b5a488", clothShade: "#514e45", trousers: "#4c504b", reach: 22 },
  mage: { shoulders: -36, hips: -19, width: 0.82, headWidth: 1, armWidth: 3, legWidth: 3, feet: [-5, 3],
    skin: "#bea88e", skinLight: "#e5d1ac", skinShade: "#89786c", hair: "#aeb8ac", hairLight: "#e1dfc5",
    cloth: "#64757c", clothLight: "#98a9a6", clothShade: "#3c4d59", trousers: "#3c454c", reach: 24 },
  ranger: { shoulders: -33, hips: -18, width: 0.9, headWidth: 1, armWidth: 3, legWidth: 4, feet: [-9, 5],
    skin: "#b79067", skinLight: "#ddbd8b", skinShade: "#7c604b", hair: "#643d2d", hairLight: "#a46d42",
    cloth: "#6d8060", clothLight: "#a6b28a", clothShade: "#3e5749", trousers: "#494e3c", reach: 27 },
};
