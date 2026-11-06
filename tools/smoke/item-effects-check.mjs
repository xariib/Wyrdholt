// Real built UI, old-content browser saves and 27 browser determinism vectors.
// node --import tsx tools/smoke/item-effects-check.mjs [dist] [outputDir]
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { resolve, join, extname, sep } from "node:path";
import { build } from "esbuild";
import { chromium, expect } from "playwright/test";
import { CONTENT } from "@emberbound/game-content";
import { ContentIndex, createInstance, createProfile, serializeSave, parseSave } from "@emberbound/game-core";

const dist = resolve(process.argv[2] ?? "apps/mobile/dist"), out = resolve(process.argv[3] ?? "tools/smoke/out/item-effects");
mkdirSync(out, { recursive: true });
const old = new ContentIndex(JSON.parse(readFileSync("packages/game-core/test/fixtures/c2-content.json")));
const added = CONTENT.items.filter(i => i.effect && !old.item(i.id).effect);
await build({ entryPoints: ["tools/parity/browser-entry.ts"], bundle: true, format: "iife", platform: "browser", outfile: join(out, "parity.js") });
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const server = createServer((req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  if (path === "/observer") { res.setHeader("content-type", "text/html"); res.end('<!doctype html><title>Storage observer</title><link rel="icon" href="/brand/I0_32_native.png">'); return; }
  if (path === "/parity") { res.setHeader("content-type", "text/html"); res.end('<!doctype html><head><title>Parity</title><link rel="icon" href="/brand/I0_32_native.png"></head><body><script src="/parity.js"></script></body>'); return; }
  if (path === "/parity.js") { res.setHeader("content-type", "text/javascript"); res.end(readFileSync(join(out, "parity.js"))); return; }
  const file = resolve(dist, "." + (path === "/" ? "/index.html" : path));
  try { assert(file.startsWith(dist + sep) && statSync(file).isFile()); res.setHeader("content-type", types[extname(file)] ?? "application/octet-stream"); res.end(readFileSync(file)); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok); });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH ?? "/usr/bin/chromium" });
const report = { pass: false, browser: browser.version(), scope: "Disposable real IndexedDB profiles; no actual user saves, native or human acceptance", cases: [], errors: [] };
const exported = page => page.evaluate(() => JSON.parse(JSON.parse(window.__ember.exportSave()).payload));
try {
  const base = `http://127.0.0.1:${server.address().port}`;
  const parityPage = await browser.newPage(); await parityPage.goto(base + "/parity");
  await expect.poll(() => parityPage.evaluate(() => window.__PARITY__?.pass ?? false), { timeout: 30000 }).toBe(true);
  report.parity = await parityPage.evaluate(() => window.__PARITY__); assert.equal(report.parity.results.length, 27);
  await parityPage.close();
  for (const [width, height] of [[360, 640], [390, 844], [412, 915], [480, 854]]) {
    const ctx = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true });
    try {
      const page = await ctx.newPage(); page.on("pageerror", e => report.errors.push(String(e)));
      page.on("console", m => { if (m.type() === "error") report.errors.push(m.text()); });
      const p = createProfile(old, { name: "Existing gear", activeClassId: "ranger", alternateClassId: "mage", masterSeed: 6006, nowWallMs: Date.now() });
      p.character.level = 18; p.character.xp = old.levelTotals[17];
      p.character.masteryXp.ranger = old.masteryTotals(old.classDef("ranger").masteryTrackId)[14];
      for (const item of CONTENT.items.filter(i => ["epic", "legendary"].includes(i.rarity))) {
        const copy = createInstance(p, item.id, { isNew: true });
        if (item.rarity === "legendary") p.equipment[item.slot] = copy.id;
      }
      const raw = serializeSave(p, Date.now()); assert(parseSave(raw).ok); assert(raw.includes("0.4.0-c2"));
      await page.goto(base + "/observer");
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
      await page.goto(base); await page.locator(".header").waitFor();
      assert.deepEqual((await exported(page)).equipment, p.equipment);
      await page.getByRole("button", { name: /^Gear/ }).last().click();
      await expect(page.getByRole("button", { name: "Forge", exact: true })).toBeVisible();
      for (const item of added) {
        await page.locator(`.slot-card[data-slot="${item.slot}"]`).click();
        const sheet = page.getByRole("dialog", { name: "Equipment", exact: true });
        await sheet.getByRole("searchbox", { name: "Search gear" }).fill(item.effect.name);
        const row = sheet.locator(".slot-inventory .list-item");
        await expect(row).toHaveCount(1); await expect(row).toContainText(item.name);
        await row.click();
        await expect(sheet.getByText(item.effect.description, { exact: true }).last()).toBeVisible();
        assert(await sheet.evaluate(e => e.scrollWidth <= e.clientWidth), item.id + " sheet overflow");
        if (item.id === "last_light_vest") await page.screenshot({ path: join(out, `${width}-last-light.png`) });
        await sheet.getByRole("button", { name: "Close equipment", exact: true }).click();
      }
      for (const item of CONTENT.items.filter(i => i.rarity === "legendary")) await expect(page.locator(".build-summary .chips").getByText(item.effect.name, { exact: true })).toBeVisible();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Page overflow");
      await page.reload(); await page.locator(".header").waitFor();
      const restored = await exported(page); assert.deepEqual(restored.equipment, p.equipment);
      assert.deepEqual(restored.inventory.groups.venomstring[0], [p.equipment.weapon]);
      report.cases.push({ width, height, oldContentSaveLoaded: true, tenEffectSearchAndDescriptions: true, sixActiveLegendaryEffects: true, identityAndReload: true });
    } finally { await ctx.close(); }
  }
  assert.deepEqual(report.errors, []); report.pass = true;
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify({ pass: true, browser: report.browser, cases: report.cases, parityVectors: 27 }));
} finally { await browser.close(); server.close(); }
