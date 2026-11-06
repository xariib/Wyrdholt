import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export interface UpdateState {
  currentVersion: string;
  supported: boolean;
  published: boolean;
  available: boolean;
  ready: boolean;
  version?: string;
  bytes?: number;
}

export interface UpdateProgress {
  received: number;
  total: number;
}

export const AppUpdater = registerPlugin<{
  getState(): Promise<UpdateState>;
  check(): Promise<UpdateState>;
  download(): Promise<UpdateState>;
  cancel(): Promise<void>;
  install(): Promise<void>;
  addListener(event: "progress", listener: (progress: UpdateProgress) => void): Promise<PluginListenerHandle>;
}>("AppUpdater");

export function hasAppUpdater(): boolean {
  return Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("AppUpdater");
}
