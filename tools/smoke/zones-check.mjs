#!/usr/bin/env node
/**
 * C1 zone flow in the built app (Chromium, 390x844 touch):
 * - Stage progress, full-size actors and Adventure actions have separate space on compact and standard phones
 * - the zone picker shows Greenfields open and Darkwood / Ashen Mountains locked
 * - the developer "Unlock all zones" helper opens them (visual check only)
 * - Push in Darkwood and in Ashen Mountains renders the zone's scene and enemies
 * - a level-1 Push in Ashen fails and the result recommends safe Farm and keeps the same zone available to retry
 *
 *   npm run build:web && (cd apps/mobile && npx vite preview --port 4173)
 *   node tools/smoke/zones-check.mjs [baseUrl]
 * Exits non-zero when a check fails. Screenshots: tools/smoke/out/zones-*.png
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://127.0.0.1:4173/";
const out = process.env.ZONES_REPORT_DIR ?? fileURLToPath(new URL("./out/", import.meta.url));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const page = await context.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
const shot = (label) => page.screenshot({ path: `${out}/zones-${label}.png` });

const zoneRow = (id) => page.locator(`.zone-row[data-zone="${id}"]`);
const rowText = async (id) => (await zoneRow(id).innerText()).replace(/\s+/g, " ").trim();
const actions = page.getByRole("region", { name: "Adventure actions" });
const changeZone = actions.getByRole("button", { name: "Change Zone", exact: true });
const picker = page.getByRole("dialog", { name: "Change Zone", exact: true });

async function checkAdventureLayout(width, height) {
  await page.setViewportSize({ width, height });
  const insets = width === 320 ? await page.addStyleTag({
    content: ":root { --safe-area-inset-top: 20px; --safe-area-inset-bottom: 24px; }",
  }) : null;
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await actions.evaluate((el) => {
    const screen = el.closest("main");
    const nav = document.querySelector(".nav");
    const progress = screen.querySelector(".world-zone").getBoundingClientRect();
    const arena = screen.querySelector(".combat-host").getBoundingClientRect();
    const canvas = screen.querySelector(".combat-canvas").getBoundingClientRect();
    if (screen.scrollHeight !== screen.clientHeight) throw new Error("Adventure must fit without scrolling");
    if (progress.bottom > arena.top) throw new Error("Stage progress must sit above combat");
    const scene = window.__emberRenderer.presentationSnapshot();
    for (const actor of scene.actors) {
      const top = canvas.top + (actor.world[1] - actor.anchor[1] * actor.scale[1]) * scene.cssScale;
      const bottom = top + actor.frame[1] * actor.scale[1] * scene.cssScale;
      if (top < arena.top || bottom > arena.bottom) throw new Error(`${actor.name} must fit fully inside the arena`);
      if (actor.production && actor.scale[1] !== 1) throw new Error(`${actor.name} must retain its native scale`);
    }
    if (canvas.width !== scene.width * 2) throw new Error("Combat sprites must retain their native 2× scale");
    for (const button of el.querySelectorAll("button")) {
      const bounds = button.getBoundingClientRect();
      if (bounds.top < 0 || bounds.bottom > nav.getBoundingClientRect().top || bounds.height < 48) {
        throw new Error(`${button.innerText} must fit above navigation at touch size`);
      }
    }
  });
  await insets?.evaluate((el) => el.remove());
}

// Fix the disposable character seed so the offline trail drops are reproducible.
await context.addInitScript(() => {
  const randomValues = Crypto.prototype.getRandomValues;
  Crypto.prototype.getRandomValues = function (array) {
    if (!(array instanceof Uint32Array) || array.length !== 1) return randomValues.call(this, array);
    array[0] = 1042;
    return array;
  };
});
await page.goto(base);
await page.getByText("Begin in Greenfields").tap({ timeout: 15_000 });
await page.locator(".combat-canvas").waitFor({ timeout: 15_000 });
await page.waitForFunction(() => window.__emberRenderer?.presentationSnapshot().actors.some((actor) => actor.id === "hero" && actor.production));
await checkAdventureLayout(320, 568);
await checkAdventureLayout(390, 844);
await actions.getByRole("button", { name: /^Farm\b/ }).tap();
await page.locator(".zone-context").getByText("Farming the trail", { exact: true }).waitFor();
await actions.getByRole("button", { name: /^Push\b/ }).tap();
await page.locator(".zone-context").getByText("Pushing", { exact: true }).waitFor();
await changeZone.tap();
await shot("01-list-new");
const fresh = {
  greenfields: await rowText("greenfields"),
  darkwood: await rowText("darkwood"),
  ashen: await rowText("ashen_mountains"),
};
await page.keyboard.press("Escape");
await picker.waitFor({ state: "hidden" });

await page.getByRole("button", { name: "Developer tools" }).tap();
await page.getByText("Unlock all zones").tap();
await page.getByRole("button", { name: "Close" }).first().tap();

const pushZone = async (id) => {
  await changeZone.tap();
  await zoneRow(id).getByRole("button", { name: "Push" }).tap();
  await picker.waitFor({ state: "hidden" });
  await page.locator(".zone-name").filter({ hasText: id === "darkwood" ? "Darkwood" : "Ashen Mountains" }).waitFor({ timeout: 5_000 });
  await page.waitForTimeout(3_000);
};

await pushZone("darkwood");
await page.waitForFunction(() => window.__emberRenderer?.presentationSnapshot().actors.some((actor) => actor.name === "spider" && actor.production));
await checkAdventureLayout(320, 568);
await page.setViewportSize({ width: 390, height: 844 });
await shot("02-darkwood");
const darkwoodEnemies = await page.locator(".combat-names span[title]").getAttribute("title");
const combatFailed = await page.getByText("Combat view unavailable").count();

await pushZone("ashen_mountains");
await checkAdventureLayout(320, 568);
const ashenSizes = await page.evaluate(() => window.__emberRenderer.presentationSnapshot().actors.filter((actor) => ["hound", "imp"].includes(actor.name)).map((actor) => actor.scale[1]));
assert.deepEqual(ashenSizes, [2, 2], "The compact Ashen formation has room for larger placeholder enemies");
await page.setViewportSize({ width: 390, height: 844 });
await shot("03-ashen");
const ashenEnemies = await page.locator(".combat-names span[title]").getAttribute("title");

// A level-1 hero cannot survive Ashen: wait for the run result.
await page.getByText(/Defeated|Out of time/).first().waitFor({ timeout: 90_000 });
await shot("04-failed");
const modal = (await page.locator(".modal").innerText()).replace(/\s+/g, " ");
const hasRetry = modal.includes("Retry Ashen Mountains");
const recommendsFarm = modal.includes("What to do next") && /Farm the Greenfields trail to gain levels/.test(modal);
const noEmptyBuildReview = !modal.includes("Change build");
// Since the C1 hotfix the safe Farm is already running while the result is shown ("Keep farming …").
const hasFarm = /(Keep farming|Farm) (the Greenfields trail|Greenfields)/.test(modal);
// Validate the level comparison and class context, not the obsolete sentence prefix.
const hasHint = /enemies are level \d+/.test(modal) && /level 1 Monk/.test(modal) && /Mastery M1/.test(modal);
await page.locator(".modal").getByRole("button", { name: /(Keep farming|Farm) (the Greenfields trail|Greenfields)/ }).tap();
await page.waitForTimeout(800);
const afterFarm = await page.locator(".zone-name").innerText();
await shot("05-after-farm");

await actions.getByRole("button", { name: /^Push.*Retry.*Ashen Mountains/ }).waitFor();
await changeZone.tap();
const next = page.getByRole("region", { name: "Next attempt" });
await next.getByText(/Last Push: Ashen Mountains/).waitFor();
await picker.getByRole("button", { name: "Close zone picker" }).tap();
// Return through a real browser save with no imported gear or reward grants.
await page.clock.setFixedTime(new Date(Date.now() + 2 * 3_600_000));
await page.reload();
await page.getByText("While you were away…", { exact: true }).waitFor();
await page.getByRole("button", { name: "Review new gear", exact: true }).tap();
const inventory = page.getByRole("dialog", { name: "Gear inventory", exact: true });
await inventory.getByRole("heading", { name: "Review new gear", exact: true }).waitFor();
const firstItem = await inventory.locator(".inventory-item").first().boundingBox();
assert(firstItem && firstItem.y < page.viewportSize().height, "New drops should start within the first screen");
await inventory.getByText(/duplicates? of equipped/).first().waitFor();
await shot("06-review-new");
await inventory.getByText("Inventory filters", { exact: true }).tap();
assert(await inventory.getByRole("checkbox", { name: "Only NEW" }).isChecked());
await inventory.getByLabel("Rarity", { exact: true }).selectOption("uncommon");
const gearCard = inventory.locator(".inventory-item").filter({ has: page.locator(".delta-up") }).first();
await gearCard.getByRole("button", { name: /^Manage copies of / }).tap();
const chosen = inventory.locator(".gear-copy").first();
const chosenId = Number(await chosen.getAttribute("data-instance-id"));
await chosen.getByRole("button", { name: /^Select copy #/ }).tap();
await page.getByRole("dialog", { name: "Equipment", exact: true }).getByRole("button", { name: /^Equip / }).tap();
await inventory.getByLabel("Inventory item types", { exact: true }).waitFor();
assert.equal(await inventory.getByRole("region", { name: "Manage inventory copies" }).count(), 0);
assert(await inventory.getByRole("checkbox", { name: "Only NEW" }).isChecked());
assert.equal(await inventory.getByLabel("Rarity", { exact: true }).inputValue(), "uncommon");
await inventory.getByRole("button", { name: "Retry Ashen Mountains", exact: true }).tap();
await page.locator(".zone-name").filter({ hasText: /^Ashen Mountains$/ }).waitFor();
const retried = await page.locator(".zone-context").getByText("Pushing", { exact: true }).isVisible();
assert(retried, "Retry should start Ashen Mountains rather than the Greenfields farm");
const equipped = await page.evaluate(() => JSON.parse(JSON.parse(window.__ember.exportSave()).payload).equipment);
assert(Object.values(equipped).includes(chosenId), "Retry should use the exact equipped copy");

await browser.close();

const checks = {
  freshGreenfieldsOpen: /Greenfields.*Enemy level 1–6/.test(fresh.greenfields) && !fresh.greenfields.includes("Locked"),
  freshDarkwoodLocked: fresh.darkwood.includes("Locked · clear Greenfields"),
  freshAshenLocked: fresh.ashen.includes("Locked · clear Darkwood"),
  darkwoodEnemies: /Gloom Spider/.test(darkwoodEnemies),
  ashenEnemies: /Ash Hound|Cinder Imp/.test(ashenEnemies),
  combatViewWorks: combatFailed === 0,
  failureOffersRetry: hasRetry,
  failureRecommendsSafeFarmWithStarterGear: recommendsFarm && noEmptyBuildReview,
  failureOffersSafeFarm: hasFarm,
  failureExplainsLevels: hasHint,
  farmMovesToGreenfields: afterFarm.includes("Greenfields"),
  newGearReviewAndSameZoneRetryAfterReload: retried,
  noConsoleErrors: errors.length === 0,
};
const report = { base, fresh, darkwoodEnemies, ashenEnemies, modal, checks, errors };
writeFileSync(`${out}/zones-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
