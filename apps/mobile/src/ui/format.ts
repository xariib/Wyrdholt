import type { BossResult, ContentIndex } from "@emberbound/game-core";

export function bossResultLabel({ tier, outcome }: BossResult): string {
  switch (outcome) {
    case "victory": return `Tier ${tier} cleared`;
    case "defeat": return `Defeated on Tier ${tier}`;
    case "timeout": return `Time ran out on Tier ${tier}`;
    case "interrupted": return `Tier ${tier} interrupted by a game update`;
  }
}

export function hp(value100: number): string {
  return String(Math.ceil(value100 / 100));
}

export function pct(bp: number): string {
  const v = bp / 100;
  return `${Number.isInteger(v) ? v : v.toFixed(1)}%`;
}

/** Attack rate is additive attacks per second (LOOT_FORGE correction), never a percentage. */
export function rate(milli: number, signed = false): string {
  const v = (milli / 1000).toFixed(2).replace(/0$/, "");
  return `${signed && milli > 0 ? "+" : ""}${v}/s`;
}

export function duration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function number(n: number): string {
  return n.toLocaleString("en-US");
}

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
/** Header space is bounded; exact balances remain in its title and accessible label. */
export function compactNumber(n: number): string {
  return n >= 1_000_000 ? compact.format(n) : number(n);
}

export function rarityColor(content: ContentIndex, rarityId: string): string {
  return content.rarities.get(rarityId)?.color ?? "#b9b3a6";
}

export const SLOT_LABELS: Record<string, string> = {
  weapon: "Weapon",
  head: "Head",
  chest: "Chest",
  gloves: "Gloves",
  boots: "Boots",
  ring: "Ring",
};
