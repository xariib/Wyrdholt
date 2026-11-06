import { darkwoodAssets } from "./darkwood";
import approved from "./approved.json";
import { SPRITES } from "../render/pixelArt";
import { validateArt, type ArtAsset, type ArtId, type EnvironmentLayer } from "./types";

export const HEROES = ["warrior", "monk", "mage", "ranger"] as const;
export const ZONES = ["greenfields", "darkwood", "ashen"] as const;
export const VFX = ["ward", "poison", "bleed", "burn", "crit", "heal", "hit"] as const;
export const SLOT_ICONS = { weapon: "blade", head: "hood", chest: "tunic", gloves: "gloves", boots: "boots", ring: "ring" } as const;
export const ENEMIES = Object.keys(SPRITES).filter(name => !(HEROES as readonly string[]).includes(name));
export const productionAssets = [...(approved as ArtAsset[]), ...darkwoodAssets];
const errors = validateArt(productionAssets);
if (errors.length) throw new Error(`Invalid art manifest: ${errors.join("; ")}`);
const byId = new Map(productionAssets.map(a => [a.id, a]));
export function asset(id: ArtId): ArtAsset | undefined { return byId.get(id); }
export function actorId(name: string): ArtId {
  return `${(HEROES as readonly string[]).includes(name) ? "characters" : "enemies"}/${name}`;
}
/** Empty until approved environment art exists. Ordering is back to front. */
export const environments: Record<string, readonly EnvironmentLayer[]> = { greenfields: [], darkwood: [], ashen: [] };
