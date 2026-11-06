import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.emberbound.spike",
  appName: "Wyrdholt: Idle",
  webDir: "dist",
  backgroundColor: "#0b0f18",
  android: {
    backgroundColor: "#0b0f18",
    webContentsDebuggingEnabled: process.env.WYRDHOLT_RELEASE !== "1",
  },
  ios: {
    backgroundColor: "#0b0f18",
    contentInset: "never",
  },
  plugins: {
    SystemBars: {
      // Injects --safe-area-inset-* CSS variables (works around old Android WebView env() bugs).
      insetsHandling: "css",
      initialViewportFitValueHint: "cover",
      style: "DARK",
    },
  },
};

export default config;
