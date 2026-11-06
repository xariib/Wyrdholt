#!/usr/bin/env node
// Built Gear UI, real storage and controlled profiles; no human/native claim.
// node --import tsx tools/smoke/gear-review-check.mjs [dist] [output]
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { chromium, webkit, expect } from "playwright/test";
import { CONTENT } from "@emberbound/game-content";
import { ContentIndex, createInstance, createProfile, parseSave, serializeSave } from "@emberbound/game-core";

const dist = resolve(process.argv[2] ?? "apps/mobile/dist");
const out = resolve(process.argv[3] ?? "tools/smoke/out/gear-review");
mkdirSync(out, { recursive: true });
const content = new ContentIndex(CONTENT);
const selected = (process.env.GEAR_REVIEW_ENGINES ?? "chromium,webkit").split(",");
assert(selected.length && selected.every(e => ["chromium", "webkit"].includes(e)));
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const server = createServer((req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  if (path === "/observer") { res.setHeader("content-type", "text/html"); res.end('<!doctype html><title>Fixture observer</title><link rel="icon" href="/brand/I0_32_native.png">'); return; }
  const file = resolve(dist, "." + (path === "/" ? "/index.html" : path));
  try {
    assert(file.startsWith(dist + sep) && statSync(file).isFile());
    res.setHeader("content-type", types[extname(file)] ?? "application/octet-stream"); res.end(readFileSync(file));
  } catch { res.writeHead(404); res.end(); }
});
const report = { pass: false, dist, selected, notRun: ["chromium", "webkit"].filter(e => !selected.includes(e)), cases: [], errors: [] };
const exported = page => page.evaluate(() => JSON.parse(JSON.parse(window.__ember.exportSave()).payload));
const stableGear = p => ({ inventory: p.inventory, equipment: p.equipment, pending: p.pending, gold: p.gold, forge: p.forge });
function fixture() {
  const p = createProfile(content, { name: "Gear review", activeClassId: "monk", alternateClassId: "mage", masterSeed: 1042, nowWallMs: Date.now() });
  p.inventory.instances = p.inventory.instances.filter(i => content.item(i.baseId).slot !== "head");
  delete p.equipment.head;
  for (let i = 0; i < 6000; i++) createInstance(p, "wayfarer_blade", { isNew: false });
  createInstance(p, "briar_edge", { isNew: false });
  createInstance(p, "bloodletter", { isNew: false });
  const reviewedIds = [createInstance(p, "bloodletter", { isNew: true }).id, createInstance(p, "bloodletter", { isNew: true }).id];
  const queued = createInstance(p, "stormcaller", { isNew: true }).id;
  p.pending = { equipment: { weapon: queued } };
  createInstance(p, "venomstring", { isNew: false });
  const raw = serializeSave(p, Date.now());
  assert(parseSave(raw).ok, "Controlled seed must be a valid save");
  return { raw, reviewedIds, copies: p.inventory.instances.filter(i => content.item(i.baseId).slot === "weapon").length };
}
async function seed(page, url, raw) {
  await page.goto(url + "/observer");
  await page.evaluate(async raw => {
    const db = await new Promise((ok, fail) => {
      const r = indexedDB.open("Disc", 1);
      r.onupgradeneeded = () => { const s = r.result.createObjectStore("FileStorage", { keyPath: "path" }); s.createIndex("by_folder", "folder"); };
      r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error);
    });
    try { await new Promise((ok, fail) => {
      const tx = db.transaction("FileStorage", "readwrite");
      tx.objectStore("FileStorage").put({ path: "/DATA/saves/profile.json", folder: "/DATA/saves", type: "file", content: raw, size: raw.length, ctime: 1, mtime: 1 });
      tx.oncomplete = ok; tx.onerror = () => fail(tx.error);
    }); } finally { db.close(); }
  }, raw);
  await page.goto(url); await page.locator(".header").waitFor();
}

await new Promise((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok); });
try {
  const url = `http://127.0.0.1:${server.address().port}`;
  for (const engine of [chromium, webkit].filter(e => selected.includes(e.name()))) {
    const browser = await engine.launch(engine === chromium && process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {});
    try {
      for (const [width, height] of [[360, 640], [390, 844], [412, 915], [480, 854]]) {
        const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true });
        try {
          const page = await context.newPage();
          page.on("pageerror", e => report.errors.push(String(e)));
          page.on("console", m => { if (m.type() === "error") report.errors.push(m.text()); });
          const { raw, reviewedIds, copies } = fixture();
          await seed(page, url, raw);
          await page.getByRole("button", { name: /^Gear/ }).last().click();
          await page.locator('[data-slot="weapon"]').click();
          const sheet = page.getByRole("dialog", { name: "Equipment", exact: true });
          const rows = sheet.locator(".slot-inventory .list-item");
          const count = sheet.getByRole("status");
          const search = sheet.getByLabel("Search gear", { exact: true });
          const rarity = sheet.getByLabel("Rarity", { exact: true });
          const newOnly = sheet.getByLabel("Only NEW", { exact: true });
          const before = stableGear(await exported(page));
          await expect(rows).toHaveCount(5);
          await expect(count).toHaveText(`5 of 5 item types · ${copies.toLocaleString("en-US")} copies`);
          assert(await rows.first().getByText("Equipped", { exact: true }).isVisible());
          assert(await rows.filter({ hasText: "Stormcaller" }).getByText("Queued", { exact: true }).isVisible());
          // Search includes effect name/description and combines all terms case-insensitively.
          await search.fill("  BLEED   rend  "); await expect(rows).toHaveCount(1);
          await expect(rows.first()).toContainText("Bloodletter");
          await rarity.selectOption("epic"); await expect(rows).toHaveCount(0);
          await expect(sheet.getByText(/No gear matches/)).toBeVisible();
          await sheet.getByRole("button", { name: "Clear filters", exact: true }).click();
          await expect(rows).toHaveCount(5);
          await rarity.selectOption("rare"); await newOnly.check();
          await expect(rows).toHaveCount(1); await expect(count).toHaveText("1 of 5 item types · 3 copies");
          assert.deepEqual(stableGear(await exported(page)), before, "Filtering must not mutate items, NEW flags, gold or equipment");
          const controls = [search, rarity, sheet.locator(".gear-new-filter"), sheet.getByRole("button", { name: "Clear filters", exact: true })];
          for (const control of controls) {
            const box = await control.boundingBox(); assert(box && box.height >= 44 && box.width >= 44);
          }
          assert(await sheet.evaluate(e => e.scrollWidth <= e.clientWidth), "No horizontal overflow");
          await page.screenshot({ path: join(out, `${engine.name()}-${width}-filters.png`) });
          // A newly reviewed item exits the NEW list, but its open comparison must stay.
          await rows.first().click();
          const equip = sheet.getByRole("button", { name: "Equip Bloodletter", exact: true });
          await expect(equip).toBeVisible();
          await expect(search).toBeHidden();
          const reviewed = await exported(page);
          const ids = reviewed.inventory.groups.bloodletter;
          assert(reviewedIds.every(id => ids[0].includes(id) && !ids[1].includes(id)));
          await sheet.getByRole("button", { name: "Other weapon", exact: true }).click();
          await expect(equip).toHaveCount(0); await expect(rows).toHaveCount(0);
          await expect(rarity).toHaveValue("rare"); await expect(newOnly).toBeChecked();
          await sheet.getByRole("button", { name: "Clear filters", exact: true }).click();
          await search.fill("  bLoOdLeTtEr "); await expect(rows).toHaveCount(1);
          // Keyboard reaches the result through every visible filter control.
          await search.focus(); await page.keyboard.press("Tab"); await expect(rarity).toBeFocused();
          await page.keyboard.press("Tab"); await expect(newOnly).toBeFocused();
          await page.keyboard.press("Tab"); await expect(sheet.getByRole("button", { name: "Clear filters", exact: true })).toBeFocused();
          await page.keyboard.press("Tab"); await expect(rows.first()).toBeFocused();
          await page.keyboard.press("Enter"); await expect(equip).toBeVisible();
          await equip.click(); await expect(sheet).toHaveCount(0);
          const equippedId = (await exported(page)).equipment.weapon;
          assert(ids[0].includes(equippedId), "Equip one of the compared copies");
          // Wait for actual stored bytes before checking reload (not just UI success).
          await expect.poll(async () => page.evaluate(async () => {
            const db = await new Promise((ok, fail) => { const r = indexedDB.open("Disc", 1); r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error); });
            try { return await new Promise((ok, fail) => {
              const r = db.transaction("FileStorage", "readonly").objectStore("FileStorage").get("/DATA/saves/profile.json");
              r.onsuccess = () => ok(r.result?.content ? JSON.parse(JSON.parse(r.result.content).payload).equipment.weapon : null); r.onerror = () => fail(r.error);
            }); } finally { db.close(); }
          }), { timeout: 10000 }).toBe(equippedId);
          await page.reload(); await page.locator(".header").waitFor();
          assert.equal((await exported(page)).equipment.weapon, equippedId);
          await page.getByRole("button", { name: /^Gear/ }).last().click();
          await page.locator('[data-slot="weapon"]').click();
          await expect(search).toHaveValue(""); await expect(rarity).toHaveValue(""); await expect(newOnly).not.toBeChecked();
          await expect(rows).toHaveCount(5);
          await search.fill("no such item"); await sheet.getByRole("button", { name: "Close equipment", exact: true }).click();
          await page.locator('[data-slot="weapon"]').click(); await expect(rows).toHaveCount(5); await expect(search).toHaveValue("");
          await page.keyboard.press("Escape"); await expect(sheet).toHaveCount(0);
          await page.locator('[data-slot="head"]').click();
          await expect(sheet.getByText("No items for this slot yet.", { exact: true })).toBeVisible();
          assert.equal(await sheet.getByText(/No gear matches/).count(), 0);
          report.cases.push({ engine: engine.name(), width, height, copies, combinedFilters: true, noFilterMutation: true, newReviewRetainsComparison: true, keyboard: true, equipReadbackReload: true, closeResets: true, emptyOwnership: true, touchTargets: true, overflow: false });
        } finally { await context.close(); }
      }
    } finally { await browser.close(); }
  }
  assert.deepEqual(report.errors, []); report.pass = true;
  console.log("PASS built Gear filtering/review/equip/reload", report.cases);
} finally {
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
  await new Promise(ok => server.close(ok));
}
