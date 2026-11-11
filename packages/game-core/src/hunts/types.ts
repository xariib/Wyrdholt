import type { FightRecord, HuntRoute, SlotId } from "@emberbound/shared-types";

export interface HuntDiscovery {
  id: number;
  huntId: string;
  /** 0 = approach, 1 = route choice/detour, 2 = boss. */
  step: number;
  slot: SlotId | null;
  route: HuntRoute | null;
  hp100: number | null;
}
export interface HuntAttempt {
  record: FightRecord;
  elapsedMs: number;
}
export interface HuntResult {
  discoveryId: number;
  huntId: string;
  step: number;
  outcome: "victory" | "defeat" | "timeout" | "interrupted";
  itemIds: number[];
  gold: number;
  enemyHp100: number;
  enemyMaxHp100: number;
}
export interface HuntState {
  version: 1;
  progressMs: number;
  nextDiscoveryId: number;
  completed: number;
  queue: HuntDiscovery[];
  active: HuntAttempt | null;
  lastResult: HuntResult | null;
}
