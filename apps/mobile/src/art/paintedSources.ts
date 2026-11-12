/** Physical source sheets; logical actor geometry remains in the animation contract. */
export const HERO_RESOLUTION = 4;
export const PAINTED_SHEETS: Record<string, { file: string; width: number; height: number }> = {
  monk: { file: "art/painted/monk-outfits-v1.png", width: 384, height: 256 },
  warrior: { file: "art/painted/warrior-outfits-v1.png", width: 384, height: 256 },
  mage: { file: "art/painted/mage-outfits-v1.png", width: 384, height: 256 },
  ranger: { file: "art/painted/ranger-outfits-v1.png", width: 384, height: 256 },
  weapons: { file: "art/painted/weapons-v1.png", width: 384, height: 256 },
  headgear: { file: "art/painted/headgear-v1.png", width: 512, height: 128 },
};
