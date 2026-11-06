import { useSyncExternalStore } from "react";
import { session, type UiState } from "../game/session";

/** Coarse UI snapshot. Changes only on meaningful game events, never per frame. */
export function useUi(): UiState {
  return useSyncExternalStore(session.subscribe, session.getSnapshot);
}
