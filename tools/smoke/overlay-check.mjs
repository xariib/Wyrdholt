#!/usr/bin/env node
/**
 * Developer-overlay smoke test (device findings F3 and F4).
 * - F3: the overlay reports the 8-hour benchmark separately from real returns.
 * - F4: the overlay does not block taps on what it covers (Developer tools Close).
 *   A negative control re-applies the old CSS and expects the tap to be intercepted.
 *
 *   npm run build:web && npx vite preview --port 4173 (in apps/mobile)
 *   node tools/smoke/overlay-check.mjs [baseUrl]
 */
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://127.0.0.1:4173/";
const out = fileURLToPath(new URL("./out/", import.meta.url));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(base);
await page.getByText("Begin in Greenfields").waitFor({ timeout: 15000 });
await page.getByRole("button", { name: /Begin in Greenfields/ }).tap();
await page.getByRole("button", { name: "Developer tools" }).waitFor({ timeout: 15000 });
await page.getByRole("button", { name: "Developer tools" }).tap();
await page.getByText("Performance overlay").tap();
const overlay = page.locator(".perf-overlay");
await overlay.waitFor();
const before = await overlay.innerText();
// F4: Close must be tappable even where the overlay covers it (Playwright fails if another element intercepts).
await page.locator(".sheet").evaluate((el) => { el.scrollTop = 0; });
await page.waitForTimeout(400);
const close = page.getByRole("button", { name: "Close" });
// Negative control: with the old CSS (overlay catches taps), the tap must be intercepted.
const oldStyle = await page.addStyleTag({ content: ".perf-overlay{pointer-events:auto!important}" });
let oldCssIntercepted = false;
try { await close.tap({ timeout: 1500 }); } catch (e) { oldCssIntercepted = /intercepts pointer events/.test(String(e)); }
await oldStyle.evaluate((el) => el.remove());
const closeBox = await close.boundingBox();
const overlayBox = await overlay.boundingBox();
const overlaps = closeBox && overlayBox && closeBox.x + closeBox.width > overlayBox.x && closeBox.y + closeBox.height > overlayBox.y && closeBox.y < overlayBox.y + overlayBox.height;
await close.tap({ timeout: 5000 });
const closed = await page.getByText("Run determinism self-test").isHidden();
await page.getByRole("button", { name: "Developer tools" }).tap();
await page.getByRole("button", { name: /Benchmark 8-hour catch-up/ }).tap();
await page.getByText(/benchmark only/).waitFor({ timeout: 60000 });
await page.waitForTimeout(700);
const after = await overlay.innerText();
await page.screenshot({ path: out + "overlay-after-bench.png" });
const pass = oldCssIntercepted && overlaps && closed && /P3 8h bench \d+ ms total/.test(after) && /last return -/.test(after) && errors.length === 0;
console.log(JSON.stringify({ pass, oldCssIntercepted, overlaps, closed, before, after, errors }, null, 2));
await browser.close();
process.exit(pass ? 0 : 1);
