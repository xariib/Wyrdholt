#!/usr/bin/env node
/**
 * C1 zone flow in the built app (Chromium, 390x844 touch):
 * - a new character sees Greenfields open and Darkwood / Ashen Mountains locked
 * - the developer "Unlock all zones" helper opens them (visual check only)
 * - Push in Darkwood and in Ashen Mountains renders the zone's scene and enemies
 * - a level-1 Push in Ashen fails and the result offers Retry / Change build / safe Farm
 *
 *   npm run build:web && (cd apps/mobile && npx vite preview --port 4173)
 *   node tools/smoke/zones-check.mjs [baseUrl]
 * Exits non-zero when a check fails. Screenshots: tools/smoke/out/zones-*.png
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://127.0.0.1:4173/";
const out = fileURLToPath(new URL("./out/", import.meta.url));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const page = await context.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
const shot = (label) => page.screenshot({ path: `${out}zones-${label}.png` });

const zoneRow = (id) => page.locator(`.zone-row[data-zone="${id}"]`);
const rowText = async (id) => (await zoneRow(id).innerText()).replace(/\s+/g, " ").trim();

await page.goto(base);
await page.getByText("Begin in Greenfields").tap({ timeout: 15_000 });
await page.locator(".combat-canvas").waitFor({ timeout: 15_000 });
await zoneRow("ashen_mountains").scrollIntoViewIfNeeded();
await shot("01-list-new");
const fresh = {
  greenfields: await rowText("greenfields"),
  darkwood: await rowText("darkwood"),
  ashen: await rowText("ashen_mountains"),
};

await page.getByRole("button", { name: "Developer tools" }).tap();
await page.getByText("Unlock all zones").tap();
await page.getByRole("button", { name: "Close" }).first().tap();

const pushZone = async (id) => {
  await zoneRow(id).scrollIntoViewIfNeeded();
  await zoneRow(id).getByRole("button", { name: "Push" }).tap();
  await page.locator(".zone-name").filter({ hasText: id === "darkwood" ? "Darkwood" : "Ashen Mountains" }).waitFor({ timeout: 5_000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(3_000);
};

await pushZone("darkwood");
await shot("02-darkwood");
const darkwoodEnemies = await page.locator(".combat-names span[title]").getAttribute("title");
const combatFailed = await page.getByText("Combat view unavailable").count();

await pushZone("ashen_mountains");
await shot("03-ashen");
const ashenEnemies = await page.locator(".combat-names span[title]").getAttribute("title");

// A level-1 hero cannot survive Ashen: wait for the run result.
await page.getByText(/Defeated|Out of time/).first().waitFor({ timeout: 90_000 });
await shot("04-failed");
const modal = (await page.locator(".modal").innerText()).replace(/\s+/g, " ");
const hasRetry = modal.includes("Retry Push");
const hasChange = modal.includes("Change build");
// Since the C1 hotfix the safe Farm is already running while the result is shown ("Keep farming …").
const hasFarm = /(Keep farming|Farm) (the Greenfields trail|Greenfields)/.test(modal);
// Validate the level comparison and class context, not the obsolete sentence prefix.
const hasHint = /enemies are level \d+/.test(modal) && /level 1 Monk/.test(modal) && /Mastery M1/.test(modal);
await page.getByRole("button", { name: /(Keep farming|Farm) (the Greenfields trail|Greenfields)/ }).tap();
await page.waitForTimeout(800);
const afterFarm = await page.locator(".zone-name").innerText();
await zoneRow("greenfields").scrollIntoViewIfNeeded();
await shot("05-after-farm");

await browser.close();

const checks = {
  freshGreenfieldsOpen: /Greenfields.*Enemy level 1–6/.test(fresh.greenfields) && !fresh.greenfields.includes("Locked"),
  freshDarkwoodLocked: fresh.darkwood.includes("Locked · clear Greenfields"),
  freshAshenLocked: fresh.ashen.includes("Locked · clear Darkwood"),
  darkwoodEnemies: /Gloom Spider/.test(darkwoodEnemies),
  ashenEnemies: /Ash Hound|Cinder Imp/.test(ashenEnemies),
  combatViewWorks: combatFailed === 0,
  failureOffersRetry: hasRetry,
  failureOffersChangeBuild: hasChange,
  failureOffersSafeFarm: hasFarm,
  failureExplainsLevels: hasHint,
  farmMovesToGreenfields: afterFarm.includes("Greenfields"),
  noConsoleErrors: errors.length === 0,
};
const report = { base, fresh, darkwoodEnemies, ashenEnemies, modal, checks, errors };
writeFileSync(`${out}zones-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
