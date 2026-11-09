#!/usr/bin/env node
/**
 * App lifecycle check (C1 playtest investigation, 21 Sep 2026): backgrounding the app and
 * returning later settles Character XP AND Class Mastery, and a character that just lost a
 * Push keeps progressing when the app is closed on the result screen.
 *
 * Time away is simulated by shifting Date.now() inside the page (the session settles by wall
 * clock) and toggling document.visibilityState, which is what the lifecycle hook listens to.
 *
 *   node tools/smoke/offline-mastery-check.mjs [distDir] [--baseline]
 * --baseline: only measure and print (for builds without the fix); no pass/fail.
 */
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const baseline = args.includes("--baseline");
const dist = args.find((a) => !a.startsWith("--")) ?? fileURLToPath(new URL("../../apps/mobile/dist/", import.meta.url));
const out = process.env.OFFLINE_MASTERY_REPORT_DIR ?? fileURLToPath(new URL("./out/", import.meta.url));
mkdirSync(out, { recursive: true });
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".json": "application/json", ".svg": "image/svg+xml" };
const PORT = 4177;
const HOUR = 3_600_000;

const server = createServer((req, res) => {
  let path = new URL(req.url, "http://x").pathname;
  if (path === "/") path = "/index.html";
  const file = join(dist, path);
  if (!existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
// Controllable wall clock and visibility (applies to the page and its workers' main-thread inputs).
await context.addInitScript(() => {
  const realNow = Date.now.bind(Date);
  window.__timeOffset = 0;
  Date.now = () => realNow() + window.__timeOffset;
  let hidden = false;
  Object.defineProperty(document, "visibilityState", { get: () => (hidden ? "hidden" : "visible") });
  Object.defineProperty(document, "hidden", { get: () => hidden });
  window.__setHidden = (h) => {
    hidden = h;
    document.dispatchEvent(new Event("visibilitychange"));
  };
});
const page = await context.newPage();
const changeZone = () => page.getByRole("button", { name: "Change Zone", exact: true }).tap();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

const header = async () => (await page.locator(".header").innerText()).replace(/\s+/g, " ");
const away = async (ms) => {
  await page.evaluate(() => window.__setHidden(true));
  await page.waitForTimeout(300);
  await page.evaluate((d) => (window.__timeOffset += d), ms);
  await page.evaluate(() => window.__setHidden(false));
};
const readOffline = async () => {
  const modal = page.getByText("While you were away…");
  const shown = await modal.waitFor({ timeout: 30_000 }).then(() => true).catch(() => false);
  if (!shown) return { shown: false, text: "", mastery: null, details: "" };
  const box = page.locator(".modal, .sheet, [role=dialog]").filter({ hasText: "While you were away…" }).first();
  const text = (await box.innerText().catch(() => "")).replace(/\s+/g, " ");
  const masteryText = (await page.locator('[data-testid="offline-mastery"]').innerText().catch(() => "")).replace(/\s+/g, " ");
  let details = "";
  const d = page.locator('[data-testid="offline-details"]');
  if (await d.count()) {
    await d.locator("summary").tap();
    details = (await d.innerText()).replace(/\s+/g, " ");
  }
  await page.screenshot({ path: join(out, `offline-mastery-${Date.now()}.png`) });
  await page.getByRole("button", { name: "Continue" }).tap();
  const m = masteryText.match(/\+([\d,]+)/);
  return { shown: true, text, mastery: m ? Number(m[1].replace(/,/g, "")) : null, masteryText, details };
};

// 1. Fresh character, a few seconds of play.
await page.goto(`http://127.0.0.1:${PORT}/`);
await page.getByText("Begin in Greenfields").tap({ timeout: 15_000 });
await page.locator(".combat-canvas").waitFor({ timeout: 15_000 });
await page.waitForTimeout(8_000);
const h0 = await header();

// 2. Backgrounded for 2 hours while pushing/farming.
await away(2 * HOUR);
const first = await readOffline();
const h1 = await header();

// 3. Lose a Push in the foreground, then close the app on the result screen for 1 hour.
await page.getByRole("button", { name: "Developer tools" }).tap();
await page.getByText("Unlock all zones").tap();
await page.getByRole("button", { name: "Close" }).first().tap();
await changeZone();
await page.locator('.zone-row[data-zone="ashen_mountains"] button').tap();
const defeated = await page.getByText("Defeated").waitFor({ timeout: 90_000 }).then(() => true).catch(() => false);
await page.waitForTimeout(500);
const resultText = defeated ? (await page.locator(".modal, [role=dialog]").filter({ hasText: "Defeated" }).first().innerText().catch(() => "")).replace(/\s+/g, " ") : "";
const modeTag = (await page.locator(".zone-card .tag").first().innerText().catch(() => "")).trim();
await page.screenshot({ path: join(out, "offline-mastery-defeat.png") });
const h2 = await header();
await away(1 * HOUR);
const second = await readOffline();
const h3 = await header();

// 4. With Greenfields cleared, the Farm button in an uncleared zone farms Greenfields (not the trail).
const keep = page.getByRole("button", { name: /Keep farming/ });
if (await keep.count()) await keep.tap();
await changeZone();
await page.locator('.zone-row[data-zone="greenfields"] button').tap();
await away(30 * 60_000);
const third = await readOffline();
await changeZone();
await page.locator('.zone-row[data-zone="darkwood"] button').tap();
await page.waitForTimeout(500);
const farmLabel = (await page.locator('[data-testid="farm-button"]').innerText().catch(() => "")).replace(/\s+/g, " ");
await page.locator('[data-testid="farm-button"]').tap();
await page.waitForTimeout(500);
const afterFarm = { zone: (await page.locator(".zone-name").innerText().catch(() => "")).trim(), tag: (await page.locator(".zone-card .tag").first().innerText().catch(() => "")).trim() };

await browser.close();
server.close();

const level = (h) => Number((h.match(/Lv\.\s*(\d+)/) ?? [])[1] ?? NaN);
const report = { dist, h0, first, h1, defeated, resultText, modeTag, h2, second, h3, third: { shown: third.shown, text: third.text }, farmLabel, afterFarm, errors };
const checks = {
  backgroundSettlesMastery: first.shown && (first.mastery ?? 0) > 0,
  backgroundSettlesXp: first.shown && level(h1) > level(h0),
  detailsShowClassAndTargets: /class: monk/.test(first.details) && /mastery XP monk \+/.test(first.details) && /targets:/.test(first.details),
  defeatKeepsFarming: defeated && /Farming/.test(modeTag) && /Keep farming/.test(resultText),
  closedOnResultScreenStillProgresses: second.shown && (second.mastery ?? 0) > 0,
  greenfieldsClearedOffline: third.shown && /Greenfields cleared/.test(third.text),
  farmButtonPicksClearedZone: /Stop Push · Greenfields/.test(farmLabel) && afterFarm.zone === "Greenfields" && /^Farming$/.test(afterFarm.tag),
  offlinePushFailureExplained: /Push failed at Greenfields · stage \d+\/10/.test(first.text) && /Safe farming switched to Greenfields/.test(first.text) && /Items/.test(first.text),
  resultShowsAttempts: /Your attempts:/.test(resultText),
  noConsoleErrors: errors.length === 0,
};
writeFileSync(join(out, "offline-mastery-report.json"), JSON.stringify({ ...report, checks }, null, 2));
console.log(JSON.stringify({ ...report, checks }, null, 2));
process.exit(baseline || Object.values(checks).every(Boolean) ? 0 : 1);
