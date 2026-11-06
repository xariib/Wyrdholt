import type { ItemDef } from "@emberbound/shared-types";

/**
 * Item catalog: five rarities × six slots, names from the Godot catalog
 * (PROGRESSION_BALANCE). Stats are PROVISIONAL.
 *
 * Eligibility by encounter level: Rare 5+, Epic 9+, Legendary 13+.
 * C3 adds the ten previously missing Epic/Legendary effects. Their values are
 * provisional playtest tuning (ITEM-EFFECTS-006); existing stats/effects are kept.
 */
export const ITEMS: ItemDef[] = [
  // ---------------------------------------------------------------- Common
  { id: "wayfarer_blade", name: "Wayfarer Blade", slot: "weapon", rarity: "common", stats: { attack: 3 }, minEncounterLevel: 1, tags: [], icon: "blade" },
  { id: "linen_hood", name: "Linen Hood", slot: "head", rarity: "common", stats: { hp: 8 }, minEncounterLevel: 1, tags: [], icon: "hood" },
  { id: "trail_tunic", name: "Trail Tunic", slot: "chest", rarity: "common", stats: { hp: 12, armor: 2 }, minEncounterLevel: 1, tags: [], icon: "tunic" },
  { id: "worn_grips", name: "Worn Grips", slot: "gloves", rarity: "common", stats: { attackRateMilli: 50 }, minEncounterLevel: 1, tags: [], icon: "gloves" },
  { id: "road_boots", name: "Road Boots", slot: "boots", rarity: "common", stats: { hp: 6, armor: 1 }, minEncounterLevel: 1, tags: [], icon: "boots" },
  { id: "copper_band", name: "Copper Band", slot: "ring", rarity: "common", stats: { attack: 1, critBp: 100 }, minEncounterLevel: 1, tags: [], icon: "ring" },

  // -------------------------------------------------------------- Uncommon
  { id: "briar_edge", name: "Briar Edge", slot: "weapon", rarity: "uncommon", stats: { attack: 6 }, minEncounterLevel: 1, tags: [], icon: "blade" },
  { id: "scout_hood", name: "Scout Hood", slot: "head", rarity: "uncommon", stats: { hp: 14, critBp: 150 }, minEncounterLevel: 1, tags: ["CRIT"], icon: "hood" },
  { id: "rootwoven_coat", name: "Rootwoven Coat", slot: "chest", rarity: "uncommon", stats: { hp: 24, armor: 4 }, minEncounterLevel: 1, tags: [], icon: "tunic" },
  { id: "duelist_gloves", name: "Duelist Gloves", slot: "gloves", rarity: "uncommon", stats: { attack: 2, attackRateMilli: 80 }, minEncounterLevel: 1, tags: ["FAST ATTACKS"], icon: "gloves" },
  { id: "windstep_boots", name: "Windstep Boots", slot: "boots", rarity: "uncommon", stats: { armor: 2, attackRateMilli: 60 }, minEncounterLevel: 1, tags: ["FAST ATTACKS"], icon: "boots" },
  { id: "amber_ring", name: "Amber Ring", slot: "ring", rarity: "uncommon", stats: { attack: 3, hp: 10 }, minEncounterLevel: 1, tags: [], icon: "ring" },

  // ------------------------------------------------------------------ Rare
  {
    id: "bloodletter",
    name: "Bloodletter",
    slot: "weapon",
    rarity: "rare",
    stats: { attack: 9, critBp: 300 },
    effect: {
      name: "Rend",
      description: "20% chance on hit to apply Bleed for 4s (25% attack per second).",
      mechanics: [
        { kind: "on_hit_dot", id: "rend", statusId: "bleed", chanceBp: 2_000, maxStacks: 1, tickMs: 1_000, durationMs: 4_000, potencyBp: 2_500 },
      ],
    },
    minEncounterLevel: 5,
    tags: ["DOT", "CRIT"],
    icon: "blade",
  },
  { id: "seers_circlet", name: "Seer's Circlet", slot: "head", rarity: "rare", stats: { attack: 3, hp: 12, critBp: 400 }, minEncounterLevel: 5, tags: ["CRIT"], icon: "circlet" },
  { id: "ironbark_mantle", name: "Ironbark Mantle", slot: "chest", rarity: "rare", stats: { hp: 40, armor: 8 }, minEncounterLevel: 5, tags: ["SUSTAIN"], icon: "tunic" },
  {
    id: "flowing_wraps",
    name: "Flowing Wraps",
    slot: "gloves",
    rarity: "rare",
    stats: { attack: 6, attackRateMilli: 120, armor: 4, critBp: 500 },
    effect: {
      name: "Flow",
      description: "After 3 consecutive hits, gain +15% attack speed for 3s.",
      mechanics: [
        { kind: "nth_hit_haste", id: "wraps_flow", every: 3, statusId: "wraps_flow", hasteBp: 1_500, durationMs: 3_000 },
      ],
    },
    minEncounterLevel: 5,
    tags: ["FAST ATTACKS"],
    icon: "wraps",
  },
  { id: "huntsmans_stride", name: "Huntsman's Stride", slot: "boots", rarity: "rare", stats: { hp: 10, attackRateMilli: 90, critBp: 300 }, minEncounterLevel: 5, tags: ["FAST ATTACKS", "CRIT"], icon: "boots" },
  {
    id: "ember_seal",
    name: "Ember Seal",
    slot: "ring",
    rarity: "rare",
    stats: { attack: 4 },
    effect: {
      name: "Kindling",
      description: "15% chance on hit to apply Ember Burn for 3s (30% attack per second).",
      mechanics: [
        { kind: "on_hit_dot", id: "kindling", statusId: "ember_burn", chanceBp: 1_500, maxStacks: 1, tickMs: 1_000, durationMs: 3_000, potencyBp: 3_000 },
      ],
    },
    minEncounterLevel: 5,
    tags: ["DOT", "BURN"],
    icon: "ring",
  },

  // ------------------------------------------------------------------ Epic
  {
    id: "stormcaller",
    name: "Stormcaller",
    slot: "weapon",
    rarity: "epic",
    stats: { attack: 12, critBp: 200 },
    effect: {
      name: "Stormcall",
      description: "12% chance on hit to chain lightning to another enemy for 60% attack.",
      mechanics: [{ kind: "on_hit_chain", id: "stormcall", chanceBp: 1_200, potencyBp: 6_000, damageType: "magic" }],
    },
    minEncounterLevel: 9,
    tags: ["ON-HIT", "MULTI-TARGET"],
    icon: "staff",
  },
  {
    id: "crown_of_thorns", name: "Crown of Thorns", slot: "head", rarity: "epic",
    stats: { hp: 30, armor: 6, critBp: 300 }, minEncounterLevel: 9, tags: ["CRIT", "RETALIATION"], icon: "circlet",
    effect: {
      name: "Thornbound", description: "When an enemy attack damages health, 10% chance to strike back for 30% attack. 2s cooldown.",
      mechanics: [{ kind: "on_damaged_retaliate", id: "thornbound", chanceBp: 1_000, potencyBp: 3_000, damageType: "physical", cooldownMs: 2_000, appliesDots: 0 }],
    },
  },
  {
    id: "cinderweave", name: "Cinderweave", slot: "chest", rarity: "epic",
    stats: { hp: 55, armor: 12, attack: 3 }, minEncounterLevel: 9, tags: ["SUSTAIN", "WARD"], icon: "tunic",
    effect: {
      name: "Cinder Guard", description: "Every fifth attack adds 1% attack to a ward, up to 3% max health. Ward fades after each fight; multiple wards share the highest cap.",
      mechanics: [{ kind: "ward", id: "cinder_guard", startBp: 0, every: 5, potencyBp: 100, capBp: 300 }],
    },
  },
  {
    id: "venom_grips",
    name: "Venom Grips",
    slot: "gloves",
    rarity: "epic",
    stats: { attack: 5, attackRateMilli: 180, armor: 6, critBp: 800 },
    effect: {
      name: "Poison Touch",
      description: "30% chance on hit to apply Poison for 4s (25% attack per second).",
      mechanics: [
        { kind: "on_hit_dot", id: "poison_touch", statusId: "poison", chanceBp: 3_000, maxStacks: 1, tickMs: 1_000, durationMs: 4_000, potencyBp: 2_500 },
      ],
    },
    minEncounterLevel: 9,
    tags: ["POISON", "FAST ATTACKS"],
    icon: "wraps",
  },
  {
    id: "pilgrims_pace", name: "Pilgrim's Pace", slot: "boots", rarity: "epic",
    stats: { hp: 20, armor: 4, attackRateMilli: 140 }, minEncounterLevel: 9, tags: ["FAST ATTACKS", "HEAL"], icon: "boots",
    effect: {
      name: "Second Wind", description: "Every sixth hit heals 3% attack, up to max health. 8s cooldown.",
      mechanics: [{ kind: "nth_hit_heal", id: "second_wind", every: 6, potencyBp: 300, cooldownMs: 8_000 }],
    },
  },
  {
    id: "moonlit_loop", name: "Moonlit Loop", slot: "ring", rarity: "epic",
    stats: { attack: 7, hp: 15, critBp: 600 }, minEncounterLevel: 9, tags: ["CRIT", "ECHO"], icon: "ring",
    effect: {
      name: "Moon Echo", description: "8% chance on hit to deal an extra magic strike for 35% attack.",
      mechanics: [{ kind: "on_hit_echo", id: "moon_echo", chanceBp: 800, potencyBp: 3_500, damageType: "magic" }],
    },
  },

  // ------------------------------------------------------------- Legendary
  {
    id: "venomstring", name: "Venomstring", slot: "weapon", rarity: "legendary",
    stats: { attack: 18, attackRateMilli: 60, critBp: 400 }, minEncounterLevel: 13, tags: ["FAST ATTACKS", "CRIT", "POISON"], icon: "bow",
    effect: {
      name: "Venom Thread", description: "25% chance on hit to apply Poison for 5s (15% attack per second per stack), up to 2 stacks. Separate from class Poison.",
      mechanics: [{ kind: "on_hit_dot", id: "venom_thread", statusId: "poison", chanceBp: 2_500, maxStacks: 2, tickMs: 1_000, durationMs: 5_000, potencyBp: 1_500 }],
    },
  },
  {
    id: "cinder_crown", name: "Cinder Crown", slot: "head", rarity: "legendary",
    stats: { attack: 5, hp: 40, critBp: 500 }, minEncounterLevel: 13, tags: ["CRIT", "MULTI-TARGET"], icon: "circlet",
    effect: {
      name: "Cinder Nova", description: "Every sixth attack deals 35% attack as magic damage to each living enemy.",
      mechanics: [{ kind: "nth_attack_splash", id: "cinder_nova", every: 6, potencyBp: 3_500, damageType: "magic" }],
    },
  },
  {
    id: "last_light_vest", name: "Last-light Vest", slot: "chest", rarity: "legendary",
    stats: { hp: 85, armor: 18 }, minEncounterLevel: 13, tags: ["SUSTAIN", "WARD"], icon: "tunic",
    effect: {
      name: "Last Light", description: "Start each fight with a ward of 5% max health. Every sixth attack adds 5% attack, up to 10% max health. Ward fades after each fight; multiple wards share the highest cap.",
      mechanics: [{ kind: "ward", id: "last_light", startBp: 500, every: 6, potencyBp: 500, capBp: 1_000 }],
    },
  },
  {
    id: "hands_of_the_dawn", name: "Hands of the Dawn", slot: "gloves", rarity: "legendary",
    stats: { attack: 9, attackRateMilli: 240, armor: 6, critBp: 600 }, minEncounterLevel: 13, tags: ["FAST ATTACKS", "CRIT", "ON-HIT"], icon: "wraps",
    effect: {
      name: "Dawn Strike", description: "Every fourth hit deals an extra physical strike for 50% attack.",
      mechanics: [{ kind: "nth_hit_extra_damage", id: "dawn_strike", every: 4, potencyBp: 5_000, damageType: "physical" }],
    },
  },
  {
    id: "ghostwalk", name: "Ghostwalk", slot: "boots", rarity: "legendary",
    stats: { hp: 30, armor: 8, attackRateMilli: 180, critBp: 300 }, minEncounterLevel: 13, tags: ["FAST ATTACKS", "HASTE"], icon: "boots",
    effect: {
      name: "Ghost Step", description: "Every fifth hit grants +20% attack speed for 3s.",
      mechanics: [{ kind: "nth_hit_haste", id: "ghost_step", every: 5, statusId: "ghost_step", hasteBp: 2_000, durationMs: 3_000 }],
    },
  },
  {
    id: "oath_of_embers", name: "Oath of Embers", slot: "ring", rarity: "legendary",
    stats: { attack: 11, hp: 25, critBp: 400 }, minEncounterLevel: 13, tags: ["CRIT", "EXECUTE"], icon: "ring",
    effect: {
      name: "Ember Oath", description: "Direct hits deal +20% damage to enemies at or below 25% health.",
      mechanics: [{ kind: "execute", id: "ember_oath", thresholdBp: 2_500, bonusBp: 2_000 }],
    },
  },
];

export const STARTER_ITEMS = ["wayfarer_blade", "linen_hood", "trail_tunic", "worn_grips", "road_boots", "copper_band"];

/** Items the developer "grant sample gear" action adds, for Gear UX evaluation. */
export const DEV_SAMPLE_ITEMS: readonly string[] = [
  "briar_edge",
  "scout_hood",
  "rootwoven_coat",
  "duelist_gloves",
  "flowing_wraps",
  "venom_grips",
  "windstep_boots",
  "pilgrims_pace",
  "amber_ring",
  "ember_seal",
  "stormcaller",
  "bloodletter",
  "ironbark_mantle",
  "seers_circlet",
];
