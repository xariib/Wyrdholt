// BULK-SALVAGE-009: built UI, real IndexedDB, disposable saves. No hosted user storage.
// node --import tsx tools/smoke/bulk-salvage-check.mjs [newDist] [previousPreviewDist] [out]
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { resolve, join, extname, sep } from "node:path";
import { chromium, expect } from "playwright/test";
import { build } from "esbuild";
import { CONTENT, FORGE_V1 } from "@emberbound/game-content";
import { ContentIndex, createInstance, createProfile, fuse, parseSave, serializeSave, setItemLock, applyCommand } from "@emberbound/game-core";

const dist = resolve(process.argv[2] ?? "apps/mobile/dist"), oldDist = resolve(process.argv[3]);
const out = resolve(process.argv[4] ?? "tools/smoke/out/bulk-salvage"); mkdirSync(out, { recursive: true });
const content = new ContentIndex(CONTENT), rewards = { common: 5, uncommon: 15, rare: 50, epic: 100, legendary: 200 };
const report = { pass: false, scope: "Real built UI/storage with disposable fixtures; no native/human/hosted user-save claim", cases: [], errors: [] };
let currentDist = dist;
await Promise.all([
  build({ entryPoints: ["tools/parity/browser-entry.ts"], bundle: true, format: "iife", platform: "browser", outfile: join(out, "combat.js") }),
  build({ entryPoints: ["tools/parity/forge-browser.ts"], bundle: true, format: "iife", platform: "browser", outfile: join(out, "forge.js") }),
]);
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const server = createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname === "/observer") { res.setHeader("content-type", "text/html"); res.end('<!doctype html><title>Disposable observer</title><link rel="icon" href="/brand/I0_32_native.png">'); return; }
  if (pathname === "/parity") { res.setHeader("content-type", "text/html"); res.end('<!doctype html><title>Parity</title><link rel="icon" href="/brand/I0_32_native.png"><body><script src="/combat.js"></script><script src="/forge.js"></script>'); return; }
  const file = ["/combat.js", "/forge.js"].includes(pathname) ? join(out, pathname.slice(1)) : resolve(currentDist, "." + (pathname === "/" ? "/index.html" : pathname));
  try { assert((file.startsWith(currentDist + sep) || file.startsWith(out + sep)) && statSync(file).isFile()); res.setHeader("content-type", mime[extname(file)] ?? "application/octet-stream"); res.end(readFileSync(file)); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok); });
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH ?? "/usr/bin/chromium" });
report.browser = browser.version();
const raw = page => page.evaluate(() => window.__ember.exportSave());
async function profile(page) { const parsed = parseSave(await raw(page)); assert(parsed.ok); return parsed.profile; }
async function storage(page, seedRaw) {
  return page.evaluate(async seedRaw => {
    const db = await new Promise((ok, fail) => {
      const r = indexedDB.open("Disc", 1);
      r.onupgradeneeded = () => { const s = r.result.createObjectStore("FileStorage", { keyPath: "path" }); s.createIndex("by_folder", "folder"); };
      r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error);
    });
    try {
      if (seedRaw) await new Promise((ok, fail) => {
        const tx = db.transaction("FileStorage", "readwrite"), s = tx.objectStore("FileStorage"); s.clear();
        s.put({ path: "/DATA/saves/profile.json", folder: "/DATA/saves", type: "file", content: seedRaw, size: seedRaw.length, ctime: 1, mtime: 1 });
        tx.oncomplete = ok; tx.onerror = () => fail(tx.error);
      });
      return await new Promise((ok, fail) => {
        const r = db.transaction("FileStorage", "readonly").objectStore("FileStorage").getAll();
        r.onsuccess = () => ok(r.result.filter(x => x.path.startsWith("/DATA/saves/")).map(x => [x.path, x.content]).sort()); r.onerror = () => fail(r.error);
      });
    } finally { db.close(); }
  }, seedRaw);
}
async function seed(page, p) { await page.goto(url + "/observer"); await storage(page, serializeSave(p, Date.now())); await page.goto(url); await page.locator(".header").waitFor(); }
function fixture(rarity = "common", copies = 7, schema = 3) {
  const p = createProfile(content, { name: "Exact salvage", activeClassId: "monk", alternateClassId: "mage", masterSeed: 1042, nowWallMs: Date.now() });
  p.gold = 500; p.adventure.zones.greenfields.cleared = true;
  const item = content.snapshot.items.find(i => i.slot === "weapon" && i.rarity === rarity);
  const ids = Array.from({ length: copies }, () => createInstance(p, item.id, { isNew: true }).id);
  if (schema === 2) { p.forge = { version: 1, nextTransactionId: 1 }; p.schema = 2; }
  if (schema === 3) setItemLock(p, ids[0], true);
  p.pending = { equipment: { weapon: ids[1] } };
  return { p, ids, item };
}
async function gear(page, item = null) {
  await page.getByRole("button", { name: /^Gear/ }).last().click(); await page.locator('[data-slot="weapon"]').click();
  const sheet = page.getByRole("dialog", { name: "Equipment", exact: true });
  if (item && item.id !== "wayfarer_blade") await sheet.locator(".list-item").filter({ hasText: item.name }).click();
  await sheet.locator(".gear-copies summary").click(); return sheet;
}
async function review(sheet, id) { await sheet.getByRole("button", { name: `Review salvage copy #${id}`, exact: true }).click(); }
const confirm = (sheet, id, gold) => sheet.getByRole("button", { name: `Confirm salvage copy #${id} for ${gold} Gold`, exact: true });
async function saved(sheet, id, gold) { await expect(sheet.getByRole("status").filter({ hasText: `Copy #${id} salvaged for ${gold} Gold and saved.` })).toBeVisible(); }
function observe(page) { page.on("pageerror", e => report.errors.push(String(e))); page.on("console", m => { if (m.type() === "error") report.errors.push(m.text()); }); }
const choose = (sheet, id) => sheet.getByRole('checkbox', { name: `Select for salvage copy #${id}`, exact: true }).check();
const reviewBatch = sheet => sheet.getByRole('button', { name: 'Review selected salvage', exact: true }).click();
const confirmBatch = (sheet, count, gold) => sheet.getByRole('button', { name: `Confirm salvage ${count.toLocaleString()} copies for ${gold.toLocaleString()} Gold`, exact: true });
const savedBatch = (sheet, count, gold) => expect(sheet.getByRole('status').filter({ hasText: `${count.toLocaleString()} selected copies salvaged for ${gold.toLocaleString()} Gold and saved.` })).toBeVisible();
async function group(sheet, item) {
  const other = sheet.getByRole('button', { name: 'Other weapon', exact: true });
  if (await other.count()) await other.click();
  await sheet.locator('.list-item').filter({ hasText: item.name }).click();
  await sheet.locator('.gear-copies summary').click();
}
function mixed() {
  const f = fixture(); f.selected = [f.ids[4], f.ids[5]];
  f.extra = ['uncommon', 'rare', 'epic', 'legendary'].map(rarity => {
    const item = content.snapshot.items.find(i => i.slot === 'weapon' && i.rarity === rarity);
    const id = createInstance(f.p, item.id, { isNew: true }).id; f.selected.push(id); return { item, id };
  }); return f;
}
async function selectMixed(sheet, f) {
  const first = sheet.getByRole("checkbox", { name: `Select for salvage copy #${f.ids[4]}`, exact: true });
  await first.focus(); await first.press("Space"); await expect(first).toBeChecked(); await choose(sheet, f.ids[5]);
  for (const x of f.extra) { await group(sheet, x.item); await choose(sheet, x.id); }
}
function exactAfter(before, after, ids, gold) {
  assert.equal(after.gold, before.gold + gold);
  assert.deepEqual(after.inventory.instances, before.inventory.instances.filter(i => !ids.includes(i.id)));
  assert.equal(after.inventory.nextInstanceId, before.inventory.nextInstanceId);
  for (const key of ['itemLocks', 'equipment', 'pending', 'forge']) assert.deepEqual(after[key], before[key]);
}
try {
  const parityPage = await browser.newPage(); await parityPage.goto(url + '/parity'); await parityPage.waitForFunction(() => window.__PARITY__ && window.__forgeParity);
  report.parity = await parityPage.evaluate(() => ({ combat: window.__PARITY__, forge: window.__forgeParity }));
  assert(report.parity.combat.pass); assert.equal(report.parity.combat.results.length, 27);
  const golden = JSON.parse(readFileSync('docs/project/tasks/evidence/ITEM-LOCKS-007/forge-pr22-baseline.json', 'utf8'));
  assert.equal(report.parity.forge.count, golden.count); assert.equal(report.parity.forge.hash, golden.hash); await parityPage.close();
  for (const [width, height] of [[360, 640], [390, 844], [412, 915], [480, 854]]) {
    const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true });
    try {
      const page = await ctx.newPage(); observe(page); const f = mixed(); await seed(page, f.p); const sheet = await gear(page);
      for (const id of [f.p.equipment.weapon, f.ids[0], f.ids[1]]) await expect(sheet.getByRole('checkbox', { name: `Select for salvage copy #${id}`, exact: true })).toBeDisabled();
      assert.equal(await sheet.getByRole('checkbox', { checked: true }).count(), 0);
      const box = await sheet.locator('.bulk-salvage-choice').first().boundingBox(); assert(box.height >= 44 && box.width >= 44);
      await selectMixed(sheet, f); const before = await profile(page), bytes = await storage(page); await reviewBatch(sheet);
      const region = sheet.getByRole('region', { name: 'Confirm bulk salvage', exact: true });
      for (const id of f.selected) await expect(region).toContainText(`Copy #${id}`);
      for (const [rarity, gold] of Object.entries(rewards)) await expect(region).toContainText(`${content.rarity(rarity).name}: ${rarity === 'common' ? 2 : 1} × ${gold} Gold`);
      await expect(region).toContainText('Total: 375 Gold'); assert(await sheet.evaluate(e => e.scrollWidth <= e.clientWidth));
      await expect(sheet.getByRole('button', { name: 'Cancel bulk salvage', exact: true })).toBeFocused();
      await page.screenshot({ path: join(out, `confirmation-${width}.png`) });
      await page.keyboard.press('Enter'); assert.deepEqual((await profile(page)).inventory, before.inventory); assert.equal((await profile(page)).gold, before.gold); assert.deepEqual(await storage(page), bytes);
      await reviewBatch(sheet); const confirm = confirmBatch(sheet, 6, 375); await confirm.focus();
      const actionBox = await confirm.boundingBox(); assert(actionBox.width >= 44 && actionBox.height >= 44);
      await page.screenshot({ path: join(out, `confirmation-actions-${width}.png`) });
      await page.keyboard.press('Enter'); await savedBatch(sheet, 6, 375);
      exactAfter(before, await profile(page), f.selected, 375); await expect(region).toHaveCount(0);
      await expect(sheet.getByRole('button', { name: 'Review selected salvage', exact: true })).toBeDisabled();
      await page.reload(); await page.locator('.header').waitFor(); exactAfter(before, await profile(page), f.selected, 375);
      report.cases.push({ width, height, selectedIds: f.selected, mixedGold: 375, protectedDisabled: true, cancelNoWrite: true, keyboard: true, touch44: true, noOverflow: true, rewardOnceReload: true });
    } finally { await ctx.close(); }
  }
  for (const schema of [1, 2, 3]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const page = await ctx.newPage(); observe(page); const f = fixture('common', 7, schema); currentDist = oldDist; await seed(page, f.p);
      await page.goto(url + '/observer'); currentDist = dist; await page.goto(url); await page.locator('.header').waitFor();
      const sheet = await gear(page); await choose(sheet, f.ids[3]); await choose(sheet, f.ids[5]); const before = await profile(page); await reviewBatch(sheet);
      await confirmBatch(sheet, 2, 10).click(); await savedBatch(sheet, 2, 10); assert.equal(JSON.parse(await raw(page)).schema, schema);
      const after = await profile(page); exactAfter(before, after, [f.ids[3], f.ids[5]], 10);
      await page.goto(url + '/observer'); currentDist = oldDist; await page.goto(url); await page.locator('.header').waitFor(); exactAfter(before, await profile(page), [f.ids[3], f.ids[5]], 10);
      await page.goto(url + '/observer'); currentDist = dist; await page.goto(url); await page.locator('.header').waitFor(); assert.deepEqual((await profile(page)).inventory, after.inventory);
      report.cases.push({ schema, exactPreviousPreviewUpgradeReturn: true, rewardOnce: true, schemaUnchanged: true });
    } finally { currentDist = dist; await ctx.close(); }
  }
  const large = await browser.newContext({ viewport: { width: 360, height: 640 }, hasTouch: true, isMobile: true });
  try {
    const page = await large.newPage(); observe(page); const f = fixture('common', 6000); await seed(page, f.p); const sheet = await gear(page);
    await expect(sheet.locator('.gear-copy')).toHaveCount(20); const ids = [];
    for (let n = 0; n < 25; n++) {
      const id = f.ids[n + 2];
      if (!await sheet.getByRole('checkbox', { name: `Select for salvage copy #${id}`, exact: true }).count()) await sheet.getByRole('button', { name: 'Next copies', exact: true }).click();
      ids.push(id); await choose(sheet, id);
    }
    await sheet.getByRole('button', { name: 'Previous copies', exact: true }).click(); await expect(sheet.getByRole('checkbox', { name: `Select for salvage copy #${ids[0]}`, exact: true })).toBeChecked();
    const before = await profile(page); await reviewBatch(sheet); await expect(sheet.getByRole('list', { name: 'Selected copy IDs' }).locator('li')).toHaveCount(20);
    await sheet.getByRole('button', { name: 'Next selected copies', exact: true }).click(); await expect(sheet.getByRole('list', { name: 'Selected copy IDs' })).toContainText(`Copy #${ids.at(-1)}`);
    await confirmBatch(sheet, 25, 125).click(); await savedBatch(sheet, 25, 125); exactAfter(before, await profile(page), ids, 125);
    await page.reload(); await page.locator('.header').waitFor(); exactAfter(before, await profile(page), ids, 125);
    report.largeInventory = { copies: 6000, selectedAcrossPages: 25, maxRows: 20, previewPagination: true, reload: true };
  } finally { await large.close(); }
  // Selecting a copy does not remove it from the batch when its protection changes.
  const stale = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const page = await stale.newPage(); observe(page); const f = fixture(); await seed(page, f.p); const sheet = await gear(page);
    await choose(sheet, f.ids[3]); await choose(sheet, f.ids[4]); await sheet.getByRole('button', { name: `Lock copy #${f.ids[4]}`, exact: true }).click();
    await expect(sheet.getByRole('status').filter({ hasText: `Copy #${f.ids[4]} locked and saved.` })).toBeVisible();
    const before = await profile(page), bytes = await storage(page); await reviewBatch(sheet);
    await expect(sheet.getByRole('alert')).toContainText('Locked copies'); await expect(sheet.getByRole('region', { name: 'Confirm bulk salvage', exact: true })).toHaveCount(0);
    assert.deepEqual((await profile(page)).inventory, before.inventory); assert.equal((await profile(page)).gold, before.gold); assert.deepEqual(await storage(page), bytes);
    await expect(sheet.getByRole('checkbox', { name: `Select for salvage copy #${f.ids[4]}`, exact: true })).toBeChecked();
    report.staleSelection = { entireBatchRefused: true, noWrite: true, noAutomaticReplacement: true };
  } finally { await stale.close(); }
  for (const faultKind of ['temp-write', 'main-readback']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      await ctx.addInitScript(() => {
        const put = IDBObjectStore.prototype.put, get = IDBObjectStore.prototype.get;
        IDBObjectStore.prototype.put = function(value, ...args) {
          if (window.__salvageFault === 'temp-write' && value?.path?.endsWith('/profile.tmp.json')) throw new Error('Injected batch temp failure');
          const r = put.call(this, value, ...args); if (window.__salvageFault === 'main-readback' && value?.path?.endsWith('/profile.json')) window.__salvageCommitted = true; return r;
        };
        IDBObjectStore.prototype.get = function(key, ...args) {
          if (window.__salvageFault === 'main-readback' && window.__salvageCommitted && key === '/DATA/saves/profile.json') throw new Error('Injected batch readback failure'); return get.call(this, key, ...args);
        };
      });
      const page = await ctx.newPage(); observe(page); const f = fixture(); await seed(page, f.p); const sheet = await gear(page), ids = [f.ids[3], f.ids[5]];
      for (const id of ids) await choose(sheet, id); const before = await profile(page), bytes = await storage(page); await reviewBatch(sheet);
      await page.evaluate(kind => { window.__salvageFault = kind; }, faultKind); await confirmBatch(sheet, 2, 10).click(); await expect(page.getByText('Adventure paused', { exact: true })).toBeVisible();
      assert.equal(await page.getByText('2 selected copies salvaged for 10 Gold and saved.', { exact: true }).count(), 0);
      if (faultKind === 'temp-write') assert.deepEqual(await storage(page), bytes);
      await page.evaluate(() => { window.__salvageFault = null; }); await page.getByRole('button', { name: 'Check again (read only)', exact: true }).click(); await page.getByRole('button', { name: 'Continue', exact: true }).click(); await page.locator('.header').waitFor();
      const recovered = await profile(page);
      if (faultKind === 'main-readback') exactAfter(before, recovered, ids, 10);
      else {
        assert.deepEqual(recovered.inventory, before.inventory); assert.equal(recovered.gold, before.gold);
        const retry = await gear(page); for (const id of ids) await choose(retry, id); await reviewBatch(retry); await confirmBatch(retry, 2, 10).click(); await savedBatch(retry, 2, 10);
      }
      await page.reload(); await page.locator('.header').waitFor(); exactAfter(before, await profile(page), ids, 10);
      report.cases.push({ faultKind, noFalseSuccess: true, wholeRecovery: true, rewardOnceReload: true });
    } finally { await ctx.close(); }
  }
  assert.deepEqual(report.errors, []); report.pass = true; console.log(JSON.stringify({ pass: true, cases: report.cases.length, large: report.largeInventory, stale: report.staleSelection }));
} finally { writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n'); await browser.close(); server.close(); }
