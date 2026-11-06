#!/usr/bin/env node
/**
 * Startup investigation for P2 (device finding F6).
 *
 * Loads the built app in headless Chromium with CPU throttling (default 6×, roughly
 * where the Samsung A40 sat relative to the build machine in the self-test), creates
 * a character, then measures several "returning player" cold loads:
 * - startup phase marks from the app (js / saveLoaded / catchUpDone / ready / combatDrawn)
 * - a CPU profile of the load, summarised by script URL and by top self-time functions
 *
 *   npm run build:web && npx vite preview --port 4173 (in apps/mobile)
 *   node tools/perf/startup-profile.mjs [baseUrl] [--rate=6] [--runs=3] [--no-webgl]
 *
 * Headless numbers are for comparing builds, not for pass/fail. P2 is decided on the phone.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const base = args.find((a) => !a.startsWith("--")) ?? "http://127.0.0.1:4173/";
const rate = Number(args.find((a) => a.startsWith("--rate="))?.slice(7) ?? 6);
const runs = Number(args.find((a) => a.startsWith("--runs="))?.slice(7) ?? 3);
const noWebgl = args.includes("--no-webgl");
const out = new URL("./out/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const launchArgs = noWebgl ? ["--disable-gpu", "--disable-software-rasterizer"] : ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
const browser = await chromium.launch({ args: launchArgs });
const context = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

// Create a character once (unthrottled), let it play briefly so a save exists.
await page.goto(base);
await page.getByRole("button", { name: /Begin in Greenfields/ }).tap();
await page.waitForTimeout(4000);

const results = [];
let lastProfile = null;
let current = page;
for (let i = 0; i < runs; i += 1) {
  // A fresh page each time (the previous one is closed first), so the measurement does
  // not include tearing down a running game. Storage and HTTP cache are shared, like an
  // app restart with its local assets.
  await current.waitForTimeout(1500); // a short absence so startup has something to settle
  await current.close();
  current = await context.newPage();
  current.on("pageerror", (e) => errors.push(String(e)));
  const cdp = await context.newCDPSession(current);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
  await cdp.send("Profiler.start");
  const t0 = Date.now();
  await current.goto(base);
  await current.waitForFunction(() => {
    const m = window.__ember?.perf?.().startupMarks;
    return Boolean(m && m.ready !== undefined && m.combatDrawn !== undefined);
  }, null, { timeout: 120_000 }).catch(() => undefined);
  const wall = Date.now() - t0;
  const { profile } = await cdp.send("Profiler.stop");
  lastProfile = profile;
  const snap = await current.evaluate(() => window.__ember?.perf?.());
  const nav = await current.evaluate(() => {
    const n = performance.getEntriesByType("navigation")[0];
    return n ? { responseEnd: Math.round(n.responseEnd), domInteractive: Math.round(n.domInteractive), domContentLoaded: Math.round(n.domContentLoadedEventEnd) } : null;
  });
  results.push({ run: i + 1, wallMs: wall, marks: snap?.startupMarks, lastCatchUp: snap?.lastCatchUp, nav });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
}

// Summarise the last profile: self time by script URL and top functions.
function summarise(profile) {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  const dt = profile.timeDeltas;
  profile.samples.forEach((id, idx) => self.set(id, (self.get(id) ?? 0) + (dt[idx] ?? 0) / 1000));
  const byUrl = new Map();
  const byFn = new Map();
  for (const [id, ms] of self) {
    const cf = nodes.get(id).callFrame;
    const url = cf.url ? cf.url.replace(/^.*\//, "") : `(${cf.functionName || "native"})`;
    byUrl.set(url, (byUrl.get(url) ?? 0) + ms);
    const key = `${cf.functionName || "(anonymous)"} ${url}:${cf.lineNumber + 1}`;
    byFn.set(key, (byFn.get(key) ?? 0) + ms);
  }
  const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${v.toFixed(0).padStart(6)} ms  ${k}`);
  return { byUrl: top(byUrl, 12), byFunction: top(byFn, 25) };
}

const report = { base, rate, noWebgl, results, profile: lastProfile ? summarise(lastProfile) : null, errors };
writeFileSync(`${out}startup-${noWebgl ? "nowebgl" : "webgl"}-x${rate}.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ rate, noWebgl, results }, null, 2));
if (report.profile) {
  console.log("\nSelf time by script (last run):\n" + report.profile.byUrl.join("\n"));
  console.log("\nTop functions (last run):\n" + report.profile.byFunction.join("\n"));
}
if (errors.length) console.log("errors:", errors);
await browser.close();
