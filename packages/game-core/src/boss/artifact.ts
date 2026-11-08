export const ASHEN_CROWN = {
  id: "ashen_crown",
  name: "Ashen Crown",
  milestones: [
    { tier: 1, rank: 1, attackBp: 300 },
    { tier: 3, rank: 2, attackBp: 600 },
    { tier: 5, rank: 3, attackBp: 900 },
  ],
} as const;

/** A cleared tier is the source of truth for the permanent reward. */
export function ashenCrownAt(clearedTier: number) {
  const milestones = ASHEN_CROWN.milestones;
  for (let i = milestones.length - 1; i >= 0; i -= 1) {
    const milestone = milestones[i]!;
    if (clearedTier >= milestone.tier) return milestone;
  }
  return undefined;
}
