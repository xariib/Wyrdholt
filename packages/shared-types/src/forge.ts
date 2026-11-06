import type { SlotId } from "./index";
export type ForgeMode = "configured" | "normal" | "critical";
export interface ForgeConfig {
  version: string;
  provisional: boolean;
  rarities: string[];
  recipes: Record<string, { count: number; gold: number; criticalBp: number }>;
  gates: { zoneId: string; maxRarity: string }[];
  outputPolicy: "uniform-catalog-by-slot-rarity";
}
export interface ForgeInput {
  transactionId: number;
  configVersion: string;
  slot: SlotId;
  rarity: string;
  instanceIds: number[];
  mode?: ForgeMode;
}
export interface ForgeReceipt {
  transactionId: number; inputKey: string; rulesVersion: string; configVersion: string;
  slot: SlotId; rarity: string; consumedIds: number[]; count: number; gold: number;
  seed: number; draws: number; critical: boolean; outputRarity: string;
  outputBaseId: string; outputInstanceId: number; mode: ForgeMode;
}
export interface ForgeState {
  version: 1;
  nextTransactionId: number;
  lastReceipt?: ForgeReceipt;
  devUnlocked?: boolean;
  devItemIds?: number[];
}
