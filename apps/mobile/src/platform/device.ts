import { Capacitor } from "@capacitor/core";

export const BUILD_ID = __BUILD_ID__;
export const BUILD_TIME = __BUILD_TIME__;
export const GIT_COMMIT = __GIT_COMMIT__;
export const GIT_BRANCH = __GIT_BRANCH__;
export const DEV_TOOLS = __DEV_TOOLS__;

export function platformName(): string {
  return Capacitor.isNativePlatform() ? `${Capacitor.getPlatform()} app` : "browser";
}

/** Engine string for matching device results to the engine that produced them (R5). */
export function engineDescription(): string {
  const ua = navigator.userAgent;
  const chrome = /Chrome\/([\d.]+)/.exec(ua);
  const safari = /Version\/([\d.]+).*Safari/.exec(ua);
  const android = /Android ([\d.]+)/.exec(ua);
  const ios = /OS (\d+[_\d]*) like Mac OS X/.exec(ua);
  const os = android ? `Android ${android[1]}` : ios ? `iOS ${ios[1]?.replace(/_/g, ".")}` : navigator.platform;
  if (chrome) return `${os} · Chromium/WebView ${chrome[1]} (V8)`;
  if (safari || /AppleWebKit/.test(ua)) return `${os} · WebKit ${safari?.[1] ?? ""} (JavaScriptCore)`;
  return `${os} · ${ua}`;
}

/**
 * JS heap from `performance.memory` (Chromium only). Chromium reports this value
 * in coarse, rounded steps for privacy, so it is NOT a measurement for R1 (F7).
 * Use the phone's own app-memory screen for R1.
 */
export function memoryInfo(): string | null {
  const m = performance.memory;
  if (!m) return null;
  return `JS heap ~${(m.usedJSHeapSize / 1_048_576).toFixed(1)} MB (coarse, not for R1) / ${(m.jsHeapSizeLimit / 1_048_576).toFixed(0)} MB limit`;
}

export function randomSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] ?? 1;
}
