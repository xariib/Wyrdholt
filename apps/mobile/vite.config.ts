import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function gitValue(args: string[]): string {
  try { return execFileSync("git", args, { cwd: fileURLToPath(new URL("../..", import.meta.url)), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return "unknown"; }
}
const commit = process.env.EMBERBOUND_GIT_COMMIT ?? gitValue(["rev-parse", "HEAD"]);
const branch = process.env.EMBERBOUND_GIT_BRANCH ?? gitValue(["branch", "--show-current"]);

const now = new Date();
const pad = (n: number) => String(n).padStart(2, "0");
const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}.${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}`;
const buildId = process.env.EMBERBOUND_BUILD_ID ?? `EMB-0.1.0-${stamp}`;

export default defineConfig({
  // Relative asset paths: the same build works inside Capacitor and on any private host path.
  base: "./",
  plugins: [react()],
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
    __BUILD_TIME__: JSON.stringify(now.toISOString()),
    __GIT_COMMIT__: JSON.stringify(commit),
    __GIT_BRANCH__: JSON.stringify(branch || "detached"),
    // Developer tools ship in spike test builds; set EMBERBOUND_DEV_TOOLS=false for a clean build.
    __DEV_TOOLS__: JSON.stringify(process.env.EMBERBOUND_DEV_TOOLS !== "false"),
  },
  worker: { format: "es" },
  build: {
    // ES2022 syntax runs on the oldest test WebView (Chrome 97, Samsung A40).
    // Runtime APIs are not polyfilled: tools/check-web-compat.mjs guards them after each build.
    target: "es2022",
    sourcemap: true,
    chunkSizeWarningLimit: 1200,
  },
  server: { host: true },
});
