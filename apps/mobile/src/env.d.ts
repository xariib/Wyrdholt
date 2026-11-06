/// <reference types="vite/client" />

declare const __BUILD_ID__: string;
declare const __BUILD_TIME__: string;
declare const __GIT_COMMIT__: string;
declare const __GIT_BRANCH__: string;
declare const __DEV_TOOLS__: boolean;

interface Performance {
  /** Non-standard (Chromium / Android WebView). */
  memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
}
