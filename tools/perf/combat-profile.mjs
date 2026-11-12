#!/usr/bin/env node
/** Comparative browser profiling; CPU throttling is not physical-device certification.
 * node tools/perf/combat-profile.mjs [dist-directory] [report-name]
 * CHROMIUM_EXECUTABLE_PATH optionally selects an installed Chromium browser.
 * Raw evidence stays in ignored tools/perf/out.
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { preview } from "vite";
import { chromium } from "playwright";

const out = resolve("tools/perf/out");
mkdirSync(out, { recursive: true });
const dist = resolve(process.argv[2] ?? "apps/mobile/dist");
const name = process.argv[3] ?? "combat";
assert.match(name, /^[\w-]+$/);
const web = await preview({ root: resolve("apps/mobile"), configFile: false, build: { outDir: dist }, preview: { host: "127.0.0.1", port: 0 } });
let browser;
const results = [];
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  for (const cls of ["Monk", "Mage", "Warrior", "Ranger"]) {
    const context = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    try {
      const page = await context.newPage(), errors = [];
      page.on("pageerror", e => errors.push(e.message));
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
      await page.goto(`http://127.0.0.1:${web.httpServer.address().port}`);
      await page.locator(".class-option").filter({ hasText: cls }).click();
      await page.getByText("Begin in Greenfields", { exact: true }).click();
      await page.waitForFunction(() => window.__emberRenderer?.info().artDecodedBytes > 10000);
      await page.waitForTimeout(5000);
      // Instrument actual geometry rebuilds and DOM writes, not just method calls.
      await page.evaluate(() => {
        const r = window.__emberRenderer;
        const hooked = new WeakSet();
        const state = window.__combatProfile = { frames: [], barClears: 0, pipClears: 0, hudMutations: 0, maxArtBytes: 0 };
        const drawBar = r.drawBar;
        r.drawBar = function(a) {
          if (!hooked.has(a)) {
            hooked.add(a);
            for (const [field, counter] of [["bar", "barClears"], ["pips", "pipClears"]]) {
              const clear = a[field].clear;
              a[field].clear = function(...args) { state[counter]++; return clear.apply(this, args); };
            }
          }
          return drawBar.call(this, a);
        };
        const frame = r.onFrame;
        r.onFrame = function(f) {
          const t = performance.now();
          frame.call(this, f);
          state.frames.push(performance.now() - t);
          state.maxArtBytes = Math.max(state.maxArtBytes, r.info().artDecodedBytes);
        };
        new MutationObserver(records => { state.hudMutations += records.length; }).observe(document.querySelector(".combat-vitals"), { subtree: true, childList: true, attributes: true, characterData: true });
      });
      const collect = () => page.evaluate(() => {
        const s = window.__combatProfile, sorted = [...s.frames].sort((a, b) => a - b);
        const result = { frames: sorted.length, rendererMedianMs: sorted[Math.floor(sorted.length / 2)] ?? 0, rendererP95Ms: sorted[Math.floor(sorted.length * .95)] ?? 0, barClears: s.barClears, pipClears: s.pipClears, hudMutations: s.hudMutations, maxArtBytes: s.maxArtBytes, renderer: window.__emberRenderer.info() };
        s.frames.length = 0; s.barClears = s.pipClears = s.hudMutations = s.maxArtBytes = 0;
        return result;
      });
      await page.waitForTimeout(12000);
      const active = await collect();
      await page.locator("nav").getByRole("button", { name: "Gear", exact: true }).click();
      await page.waitForTimeout(500);
      await collect();
      await page.waitForTimeout(3000);
      const hidden = await collect();
      await page.locator("nav").getByRole("button", { name: "Adventure", exact: true }).click();
      await page.waitForTimeout(1000);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${cls}: overflow`);
      assert.deepEqual(errors, []);
      results.push({ cls, cpuThrottle: 6, active, hidden, errors });
      console.log(JSON.stringify(results.at(-1)));
    } finally { await context.close(); }
  }
} finally {
  writeFileSync(resolve(out, `${name}.json`), JSON.stringify({ browser: browser?.version(), results }, null, 2));
  await browser?.close();
  await web.close();
}
