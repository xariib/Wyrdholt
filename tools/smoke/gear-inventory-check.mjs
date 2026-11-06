// GEAR-INVENTORY-010: built UI, real IndexedDB, disposable saves. No hosted user storage.
// node --import tsx tools/smoke/gear-inventory-check.mjs [newDist] [previousPreviewDist] [out]
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { resolve, join, extname, sep } from "node:path";
import { chromium, expect } from "playwright/test";
import { build } from "esbuild";
import { SLOT_ORDER } from "@emberbound/shared-types";
import { CONTENT, FORGE_V1 } from "@emberbound/game-content";
import { ContentIndex, createInstance, createProfile, fuse, parseSave, serializeSave, setItemLock, applyCommand } from "@emberbound/game-core";

const dist = resolve(process.argv[2] ?? "apps/mobile/dist"), oldDist = resolve(process.argv[3]);
const out = resolve(process.argv[4] ?? "tools/smoke/out/gear-inventory"); mkdirSync(out, { recursive: true });
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
function fixture(copies = 4, schema = 3) {
  const p = createProfile(content, { name: "Inventory", activeClassId: "monk", alternateClassId: "mage", masterSeed: 1042, nowWallMs: Date.now() });
  p.gold = 500; p.adventure.zones.greenfields.cleared = true;
  const groups = content.snapshot.items.map(item => ({ item, ids: Array.from({ length: copies }, (_, n) => createInstance(p, item.id, { isNew: n !== 1 }).id) }));
  const weapon = groups.find(g => g.item.slot === 'weapon' && g.item.rarity === 'common');
  if (schema === 2) { p.forge = { version: 1, nextTransactionId: 1 }; p.schema = 2; }
  if (schema === 3) setItemLock(p, weapon.ids[0], true);
  p.pending = { equipment: { weapon: weapon.ids[1] } };
  const rarities = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'common'];
  const selected = SLOT_ORDER.map((slot, n) => {
    const g = groups.find(g => g.item.slot === slot && g.item.rarity === rarities[n]); return { ...g, id: g.ids[2] };
  });
  return { p, groups, selected, weapon };
}
function observe(page) { page.on('pageerror', e => report.errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); }); }
async function inventory(page) {
  await page.getByRole('button', { name: /^Gear/ }).last().click();
  await page.getByRole('button', { name: /^Inventory ·/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Gear inventory', exact: true });
  await sheet.evaluate(async e => { await Promise.all([...e.getAnimations(), ...e.parentElement.getAnimations()].map(a => a.finished.catch(() => {}))); });
  return sheet;
}
async function manage(sheet, g) {
  await sheet.getByLabel('Slot', { exact: true }).selectOption(g.item.slot);
  await sheet.getByLabel('Rarity', { exact: true }).selectOption(g.item.rarity);
  const back = sheet.getByRole('button', { name: 'Back to inventory list', exact: true });
  if (await back.count()) await back.click();
  await sheet.getByRole('button', { name: `Manage copies of ${g.item.name}`, exact: true }).click();
}
const choose = (sheet, id) => sheet.getByRole('checkbox', { name: `Select for salvage copy #${id}`, exact: true }).check();
const reviewBatch = sheet => sheet.getByRole('button', { name: 'Review selected salvage', exact: true }).click();
const confirmBatch = (sheet, count, gold) => sheet.getByRole('button', { name: `Confirm salvage ${count.toLocaleString()} copies for ${gold.toLocaleString()} Gold`, exact: true });
const savedBatch = (sheet, count, gold) => expect(sheet.getByRole('status').filter({ hasText: `${count.toLocaleString()} selected copies salvaged for ${gold.toLocaleString()} Gold and saved.` })).toBeVisible();
const selectionStatus = sheet => sheet.getByRole('region', { name: 'Inventory salvage selection', exact: true }).getByRole('status');
async function selectMixed(sheet, f) {
  for (const [n, g] of f.selected.entries()) {
    await manage(sheet, g);
    const checkbox = sheet.getByRole('checkbox', { name: `Select for salvage copy #${g.id}`, exact: true });
    if (n === 0) { await checkbox.focus(); await checkbox.press('Space'); await expect(checkbox).toBeChecked(); }
    else await checkbox.check();
    await expect(selectionStatus(sheet)).toContainText(`${n + 1} copies selected for salvage · ${n} outside current filters`);
  }
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
      const page = await ctx.newPage(); observe(page); const f = fixture(); await seed(page, f.p); const sheet = await inventory(page);
      const beforeBrowse = await profile(page), browseBytes = await storage(page);
      await expect(sheet.locator('.inventory-item')).toHaveCount(20);
      await page.screenshot({ path: join(out, `overview-${width}.png`) });
      await sheet.getByRole('button', { name: 'Next items', exact: true }).click(); await expect(sheet.locator('.inventory-item')).toHaveCount(10);
      await sheet.getByRole('button', { name: 'Previous items', exact: true }).click(); await expect(sheet.locator('.inventory-item')).toHaveCount(20);
      for (const slot of SLOT_ORDER) {
        await sheet.getByLabel('Slot', { exact: true }).selectOption(slot); await expect(sheet.locator('.inventory-item')).toHaveCount(5);
        for (const g of f.groups.filter(g => g.item.slot === slot)) await expect(sheet.locator(`[data-base-id="${g.item.id}"]`)).toContainText(g.item.name);
      }
      const effect = f.groups.find(g => g.item.effect?.description?.toLowerCase().includes('speed'));
      await sheet.getByLabel('Slot', { exact: true }).selectOption(effect.item.slot);
      await sheet.getByLabel('Rarity', { exact: true }).selectOption(effect.item.rarity);
      await sheet.getByLabel('Search inventory', { exact: true }).fill(`${effect.item.name.toUpperCase()} speed`);
      await sheet.getByLabel('Only NEW', { exact: true }).check();
      await sheet.getByLabel('Salvage eligibility', { exact: true }).selectOption('eligible');
      await expect(sheet.locator('.inventory-item')).toHaveCount(1);
      await expect(sheet.locator('.gear-result-count')).toContainText('3 matching copies');
      await sheet.getByLabel('Search inventory', { exact: true }).fill('no such gear'); await expect(sheet.locator('.inventory-item')).toHaveCount(0);
      await expect(sheet.locator('.gear-empty')).toContainText('No gear matches these filters');
      await sheet.getByRole('button', { name: 'Clear filters', exact: true }).click();
      assert.deepEqual((await profile(page)).inventory, beforeBrowse.inventory); assert.deepEqual(await storage(page), browseBytes);
      await manage(sheet, f.weapon);
      for (const id of [f.p.equipment.weapon, f.weapon.ids[0], f.weapon.ids[1]]) await expect(sheet.getByRole('checkbox', { name: `Select for salvage copy #${id}`, exact: true })).toBeDisabled();
      await selectMixed(sheet, f);
      const before = await profile(page), bytes = await storage(page), selectedIds = f.selected.map(g => g.id);
      assert.deepEqual(before.inventory, beforeBrowse.inventory);
      const box = await sheet.locator('.bulk-salvage-choice').first().boundingBox(); assert(box.height >= 44 && box.width >= 44);
      await page.screenshot({ path: join(out, `inventory-${width}.png`) }); assert(await sheet.evaluate(e => e.scrollWidth <= e.clientWidth));
      await reviewBatch(sheet); const region = sheet.getByRole('region', { name: 'Confirm bulk salvage', exact: true });
      for (const id of selectedIds) await expect(region).toContainText(`Copy #${id}`);
      await expect(region).toContainText('Total: 375 Gold'); await expect(sheet.getByRole('button', { name: 'Cancel bulk salvage', exact: true })).toBeFocused();
      await page.keyboard.press('Enter'); assert.deepEqual((await profile(page)).inventory, before.inventory); assert.equal((await profile(page)).gold, before.gold); assert.deepEqual(await storage(page), bytes);
      await sheet.getByRole('button', { name: 'Clear selection', exact: true }).click(); await expect(selectionStatus(sheet)).toContainText('0 copies selected'); assert.deepEqual(await storage(page), bytes);
      await selectMixed(sheet, f);
      // Comparing exactly one copy marks only that ID reviewed, keeps selected IDs,
      // and hides it from a NEW filter without silently removing it from the batch.
      const target = f.selected.at(-1); await sheet.getByLabel('Only NEW', { exact: true }).check();
      await sheet.getByRole('button', { name: `Select copy #${target.id}`, exact: true }).click();
      const compare = page.getByRole('dialog', { name: 'Equipment', exact: true }); await expect(compare.locator('.comparison-effects')).toBeVisible();
      await expect.poll(async () => (await profile(page)).inventory.instances.find(i => i.id === target.id).isNew).toBe(false);
      const reviewed = await profile(page);
      assert.deepEqual(reviewed.inventory.instances, before.inventory.instances.map(i => i.id === target.id ? { ...i, isNew: false } : i));
      await compare.getByRole('button', { name: 'Close equipment', exact: true }).click();
      await expect(selectionStatus(sheet)).toContainText('6 copies selected for salvage · 6 outside current filters');
      await reviewBatch(sheet); await page.screenshot({ path: join(out, `confirmation-${width}.png`) });
      const confirm = confirmBatch(sheet, 6, 375); await confirm.focus(); const actionBox = await confirm.boundingBox(); assert(actionBox.width >= 44 && actionBox.height >= 44);
      await page.keyboard.press('Enter'); await savedBatch(sheet, 6, 375); exactAfter(reviewed, await profile(page), selectedIds, 375);
      await expect(selectionStatus(sheet)).toContainText('0 copies selected');
      await page.reload(); await page.locator('.header').waitFor(); exactAfter(reviewed, await profile(page), selectedIds, 375);
      report.cases.push({ width, height, allSlots: true, combinedFilters: true, typePagination: true, selectedIds, hiddenConfirmed: true, gold: 375, cancelAndClearNoWrite: true, exactComparisonNEW: true, touch44: true, keyboard: true, noOverflow: true, reload: true });
    } finally { await ctx.close(); }
  }
  // Upgrade/return uses the exact previous private preview bytes at the same origin.
  for (const schema of [1, 2, 3]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const page = await ctx.newPage(); observe(page); const f = fixture(4, schema); currentDist = oldDist; await seed(page, f.p);
      await page.goto(url + '/observer'); currentDist = dist; await page.goto(url); await page.locator('.header').waitFor();
      const sheet = await inventory(page); const chosen = [f.selected[0], f.selected[4]], ids = chosen.map(g => g.id);
      for (const g of chosen) { await manage(sheet, g); await choose(sheet, g.id); }
      const before = await profile(page); await reviewBatch(sheet); await confirmBatch(sheet, 2, 205).click(); await savedBatch(sheet, 2, 205);
      assert.equal(JSON.parse(await raw(page)).schema, schema); exactAfter(before, await profile(page), ids, 205);
      await page.goto(url + '/observer'); currentDist = oldDist; await page.goto(url); await page.locator('.header').waitFor(); exactAfter(before, await profile(page), ids, 205);
      await page.goto(url + '/observer'); currentDist = dist; await page.goto(url); await page.locator('.header').waitFor(); exactAfter(before, await profile(page), ids, 205);
      report.cases.push({ schema, previousPreviewUpgradeReturn: true, crossSlotIds: ids, rewardOnce: true });
    } finally { currentDist = dist; await ctx.close(); }
  }
  const large = await browser.newContext({ viewport: { width: 360, height: 640 }, hasTouch: true, isMobile: true });
  try {
    const page = await large.newPage(); observe(page); const f = fixture(200); assert.equal(f.p.inventory.instances.length, 6000 + 6);
    await seed(page, f.p); const sheet = await inventory(page); await expect(sheet.locator('.inventory-item')).toHaveCount(20);
    await manage(sheet, f.weapon); await expect(sheet.locator('.gear-copy')).toHaveCount(20); const ids = [];
    for (let n = 0; n < 25; n++) {
      const id = f.weapon.ids[n + 2];
      if (!await sheet.getByRole('checkbox', { name: `Select for salvage copy #${id}`, exact: true }).count()) await sheet.getByRole('button', { name: 'Next copies', exact: true }).click();
      await choose(sheet, id); ids.push(id);
    }
    await sheet.getByRole('button', { name: 'Previous copies', exact: true }).click(); await expect(sheet.getByRole('checkbox', { name: `Select for salvage copy #${ids[0]}`, exact: true })).toBeChecked();
    await sheet.getByLabel('Slot', { exact: true }).selectOption('ring'); await expect(selectionStatus(sheet)).toContainText('25 copies selected for salvage · 25 outside current filters');
    await sheet.getByRole('button', { name: 'Next items', exact: true }).count().then(n => assert.equal(n, 0));
    await sheet.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await sheet.getByRole('button', { name: 'Back to inventory list', exact: true }).click();
    await sheet.getByRole('button', { name: 'Next items', exact: true }).click(); await expect(sheet.locator('.inventory-item')).toHaveCount(10);
    await expect(selectionStatus(sheet)).toContainText('25 copies selected for salvage · 0 outside current filters');
    const ring = f.groups.find(g => g.item.slot === 'ring' && g.item.rarity === 'rare'); await manage(sheet, ring); await choose(sheet, ring.ids[2]); ids.push(ring.ids[2]);
    const before = await profile(page); await reviewBatch(sheet); await expect(sheet.getByRole('list', { name: 'Selected copy IDs' }).locator('li')).toHaveCount(20);
    await sheet.getByRole('button', { name: 'Next selected copies', exact: true }).click(); await expect(sheet.getByRole('list', { name: 'Selected copy IDs' })).toContainText(`Copy #${ids.at(-1)}`);
    await confirmBatch(sheet, 26, 175).click(); await savedBatch(sheet, 26, 175); exactAfter(before, await profile(page), ids, 175);
    await page.reload(); await page.locator('.header').waitFor(); exactAfter(before, await profile(page), ids, 175);
    report.largeInventory = { copies: 6006, manualSelected: 26, differentSlots: true, maxTypeRows: 20, maxCopyRows: 20, previewPagination: true, hiddenFilter: true, reload: true };
  } finally { await large.close(); }
  const stale = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const page = await stale.newPage(); observe(page); const f = fixture(); await seed(page, f.p); const sheet = await inventory(page);
    for (const g of [f.selected[0], f.selected[1]]) { await manage(sheet, g); await choose(sheet, g.id); }
    const id = f.selected[1].id; await sheet.getByRole('button', { name: `Lock copy #${id}`, exact: true }).click();
    await expect(sheet.getByRole('status').filter({ hasText: `Copy #${id} locked and saved.` })).toBeVisible();
    await sheet.getByLabel('Salvage eligibility', { exact: true }).selectOption('eligible');
    await expect(selectionStatus(sheet)).toContainText('2 copies selected for salvage · 2 outside current filters');
    const before = await profile(page), bytes = await storage(page); await reviewBatch(sheet); await expect(sheet.getByRole('alert')).toContainText('Locked copies');
    await expect(sheet.getByRole('region', { name: 'Confirm bulk salvage', exact: true })).toHaveCount(0); assert.deepEqual(await storage(page), bytes);
    assert.deepEqual((await profile(page)).inventory, before.inventory); assert.equal((await profile(page)).gold, before.gold);
    await sheet.getByLabel('Salvage eligibility', { exact: true }).selectOption('protected');
    await expect(sheet.getByRole('checkbox', { name: `Select for salvage copy #${id}`, exact: true })).toBeChecked();
    await sheet.getByRole('checkbox', { name: `Select for salvage copy #${id}`, exact: true }).uncheck(); await expect(selectionStatus(sheet)).toContainText('1 copies selected');
    await sheet.getByRole('button', { name: 'Clear selection', exact: true }).click();
    // A selected ID consumed through preserved single-copy salvage must remain stale.
    await sheet.getByLabel('Salvage eligibility', { exact: true }).selectOption(''); await manage(sheet, f.selected[0]); await choose(sheet, f.selected[0].id);
    await sheet.getByRole('button', { name: `Review salvage copy #${f.selected[0].id}`, exact: true }).click();
    await sheet.getByRole('button', { name: `Confirm salvage copy #${f.selected[0].id} for 5 Gold`, exact: true }).click();
    await expect(sheet.getByRole('status').filter({ hasText: `Copy #${f.selected[0].id} salvaged for 5 Gold and saved.` })).toBeVisible();
    const afterSingle = await profile(page), singleBytes = await storage(page); await reviewBatch(sheet); await expect(sheet.getByRole('alert')).toContainText('no longer owned');
    await expect(selectionStatus(sheet)).toContainText('1 copies selected for salvage · 1 outside current filters'); assert.deepEqual(await storage(page), singleBytes); assert.equal((await profile(page)).gold, afterSingle.gold);
    report.staleSelection = { lockedHiddenBatchRefused: true, noWrite: true, manualRemovalOnly: true, consumedSelectedIdKept: true, noReplacement: true };
  } finally { await stale.close(); }
  for (const faultKind of ['temp-write', 'main-readback']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      await ctx.addInitScript(() => {
        const put = IDBObjectStore.prototype.put, get = IDBObjectStore.prototype.get;
        IDBObjectStore.prototype.put = function(value, ...args) {
          if (window.__salvageFault === 'temp-write' && value?.path?.endsWith('/profile.tmp.json')) throw new Error('Injected inventory batch temp failure');
          const r = put.call(this, value, ...args); if (window.__salvageFault === 'main-readback' && value?.path?.endsWith('/profile.json')) window.__salvageCommitted = true; return r;
        };
        IDBObjectStore.prototype.get = function(key, ...args) {
          if (window.__salvageFault === 'main-readback' && window.__salvageCommitted && key === '/DATA/saves/profile.json') throw new Error('Injected inventory batch readback failure'); return get.call(this, key, ...args);
        };
      });
      const page = await ctx.newPage(); observe(page); const f = fixture(); await seed(page, f.p); const sheet = await inventory(page), chosen = [f.selected[0], f.selected[1]], ids = chosen.map(g => g.id);
      for (const g of chosen) { await manage(sheet, g); await choose(sheet, g.id); }
      const before = await profile(page), bytes = await storage(page); await reviewBatch(sheet);
      await page.evaluate(kind => { window.__salvageFault = kind; }, faultKind); await confirmBatch(sheet, 2, 20).click(); await expect(page.getByText('Adventure paused', { exact: true })).toBeVisible();
      assert.equal(await page.getByText('2 selected copies salvaged for 20 Gold and saved.', { exact: true }).count(), 0);
      if (faultKind === 'temp-write') assert.deepEqual(await storage(page), bytes);
      await page.evaluate(() => { window.__salvageFault = null; }); await page.getByRole('button', { name: 'Check again (read only)', exact: true }).click(); await page.getByRole('button', { name: 'Continue', exact: true }).click(); await page.locator('.header').waitFor();
      const recovered = await profile(page);
      if (faultKind === 'main-readback') exactAfter(before, recovered, ids, 20);
      else {
        assert.deepEqual(recovered.inventory, before.inventory); assert.equal(recovered.gold, before.gold);
        const retry = await inventory(page); for (const g of chosen) { await manage(retry, g); await choose(retry, g.id); }
        await reviewBatch(retry); await confirmBatch(retry, 2, 20).click(); await savedBatch(retry, 2, 20);
      }
      await page.reload(); await page.locator('.header').waitFor(); exactAfter(before, await profile(page), ids, 20);
      report.cases.push({ faultKind, noFalseSuccess: true, crossSlotAtomicRecovery: true, rewardOnceReload: true });
    } finally { await ctx.close(); }
  }
  assert.deepEqual(report.errors, []); report.pass = true; console.log(JSON.stringify({ pass: true, cases: report.cases.length, large: report.largeInventory, stale: report.staleSelection }));
} finally { writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n'); await browser.close(); server.close(); }
