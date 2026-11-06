// SALVAGE-008: built UI, real IndexedDB, disposable saves. No hosted user storage.
// node --import tsx tools/smoke/salvage-check.mjs [newDist] [previousPreviewDist] [out]
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { resolve, join, extname, sep } from "node:path";
import { chromium, expect } from "playwright/test";
import { build } from "esbuild";
import { CONTENT, FORGE_V1 } from "@emberbound/game-content";
import { ContentIndex, createInstance, createProfile, fuse, parseSave, serializeSave, setItemLock, applyCommand } from "@emberbound/game-core";

const dist = resolve(process.argv[2] ?? "apps/mobile/dist"), oldDist = resolve(process.argv[3]);
const out = resolve(process.argv[4] ?? "tools/smoke/out/salvage"); mkdirSync(out, { recursive: true });
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

try {
  const parityPage = await browser.newPage(); await parityPage.goto(url + "/parity"); await parityPage.waitForFunction(() => window.__PARITY__ && window.__forgeParity);
  const parity = await parityPage.evaluate(() => ({ combat: window.__PARITY__, forge: window.__forgeParity }));
  report.parity = parity; assert(parity.combat.pass); assert.equal(parity.combat.results.length, 27);
  const golden = JSON.parse(readFileSync("docs/project/tasks/evidence/ITEM-LOCKS-007/forge-pr22-baseline.json", "utf8"));
  assert.equal(parity.forge.count, golden.count); assert.equal(parity.forge.hash, golden.hash);
  report.parity = parity; await parityPage.close();
  for (const [width, height] of [[360, 640], [390, 844], [412, 915], [480, 854]]) {
    const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true });
    try {
      const page = await ctx.newPage(); observe(page); const f = fixture(); await seed(page, f.p); let sheet = await gear(page);
      for (const id of [f.p.equipment.weapon, f.ids[0], f.ids[1]]) await expect(sheet.getByRole("button", { name: `Review salvage copy #${id}`, exact: true })).toBeDisabled();
      const chosen = f.ids[4], before = await profile(page), bytes = await storage(page);
      await review(sheet, chosen);
      await expect(sheet.getByRole("region", { name: "Confirm salvage" })).toContainText(f.item.name);
      await expect(sheet.getByRole("region", { name: "Confirm salvage" })).toContainText(`Copy #${chosen}`);
      await expect(sheet.getByRole("region", { name: "Confirm salvage" })).toContainText("5 Gold");
      assert(await sheet.evaluate(e => e.scrollWidth <= e.clientWidth));
      await page.screenshot({ path: join(out, `confirmation-${width}.png`) });
      await sheet.getByRole("button", { name: "Cancel salvage", exact: true }).click();
      assert.deepEqual((await profile(page)).inventory, before.inventory); assert.equal((await profile(page)).gold, before.gold);
      assert.deepEqual(await storage(page), bytes, "Review/cancel must not write saves");
      await sheet.locator(".gear-copies summary").click();
      for (const b of await sheet.locator(".gear-copy-actions button").all()) { const box = await b.boundingBox(); assert(box && box.width >= 44 && box.height >= 44); }
      await review(sheet, chosen); const button = confirm(sheet, chosen, 5); await button.focus(); await page.keyboard.press("Enter"); await saved(sheet, chosen, 5);
      let after = await profile(page);
      assert.equal(after.gold, before.gold + 5); assert.deepEqual(after.inventory.instances, before.inventory.instances.filter(i => i.id !== chosen));
      assert.equal(after.inventory.nextInstanceId, before.inventory.nextInstanceId); assert.deepEqual(after.itemLocks, before.itemLocks); assert.deepEqual(after.pending, before.pending);
      await expect(sheet.getByRole("region", { name: "Confirm salvage" })).toHaveCount(0);
      await page.reload(); await page.locator(".header").waitFor(); after = await profile(page); assert.equal(after.gold, before.gold + 5); assert(!after.inventory.instances.some(i => i.id === chosen));
      sheet = await gear(page); await expect(sheet.getByRole("button", { name: `Review salvage copy #${chosen}`, exact: true })).toHaveCount(0);
      assert(await sheet.evaluate(e => e.scrollWidth <= e.clientWidth));
      report.cases.push({ width, height, exactChosenId: chosen, protection: true, cancellationNoWrite: true, rewardOnceReload: true, touch44: true, keyboard: true, noOverflow: true });
    } finally { await ctx.close(); }
  }
  for (const [rarity, gold] of Object.entries(rewards)) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const page = await ctx.newPage(); observe(page); const f = fixture(rarity); await seed(page, f.p); const sheet = await gear(page, f.item), before = await profile(page);
      await review(sheet, f.ids[2]); await confirm(sheet, f.ids[2], gold).click(); await saved(sheet, f.ids[2], gold);
      await page.reload(); await page.locator(".header").waitFor(); const after = await profile(page);
      assert.equal(after.gold, before.gold + gold); assert.deepEqual(after.inventory.instances, before.inventory.instances.filter(i => i.id !== f.ids[2]));
      report.cases.push({ rarity, gold, rewardAndExactCopyReload: true });
    } finally { await ctx.close(); }
  }
  for (const schema of [1, 2, 3]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const page = await ctx.newPage(); observe(page); const f = fixture("common", 7, schema); currentDist = oldDist; await seed(page, f.p);
      const before = await profile(page); assert.equal(JSON.parse(await raw(page)).schema, schema);
      await page.goto(url + "/observer"); currentDist = dist; await page.goto(url); await page.locator(".header").waitFor();
      const sheet = await gear(page); await review(sheet, f.ids[4]); await confirm(sheet, f.ids[4], 5).click(); await saved(sheet, f.ids[4], 5);
      const after = await profile(page); assert.equal(JSON.parse(await raw(page)).schema, schema);
      await page.goto(url + "/observer"); currentDist = oldDist; await page.goto(url); await page.locator(".header").waitFor();
      assert.equal((await profile(page)).gold, before.gold + 5); assert.deepEqual((await profile(page)).inventory, after.inventory);
      await page.goto(url + "/observer"); currentDist = dist; await page.goto(url); await page.locator(".header").waitFor();
      assert.equal((await profile(page)).gold, after.gold); assert.deepEqual((await profile(page)).inventory, after.inventory);
      report.cases.push({ schema, previousPreviewUpgradeReturn: true, noSchemaMigration: true });
    } finally { await ctx.close(); currentDist = dist; }
  }
  const special = await browser.newContext({ viewport: { width: 360, height: 640 }, hasTouch: true, isMobile: true });
  try {
    const page = await special.newPage(); observe(page); const f = fixture("common", 6000); await seed(page, f.p); let sheet = await gear(page);
    await expect(sheet.locator(".gear-copy")).toHaveCount(20); await sheet.getByRole("button", { name: "Next copies", exact: true }).click();
    await review(sheet, f.ids[19]); await confirm(sheet, f.ids[19], 5).click(); await saved(sheet, f.ids[19], 5);
    assert.equal((await profile(page)).inventory.instances.length, f.p.inventory.instances.length - 1);
    assert(!(await profile(page)).inventory.instances.some(i => i.id === f.ids[19])); report.largeInventory = { copies: 6000, maxRows: 20, secondPageExactSalvage: true };
    const forge = fixture("common", 7, 2); delete forge.p.pending;
    const result = fuse(forge.p, content, FORGE_V1, { transactionId: 1, configVersion: FORGE_V1.version, slot: "weapon", rarity: "common", instanceIds: forge.ids.slice(0, 5), mode: "normal" }, true); assert(result.ok);
    const output = result.forge.outputInstanceId; await seed(page, forge.p);
    sheet = await gear(page, content.item(result.forge.outputBaseId)); await review(sheet, output); await confirm(sheet, output, 15).click(); await saved(sheet, output, 15);
    await page.reload(); await page.locator(".header").waitFor(); const after = await profile(page);
    assert.deepEqual(after.forge.lastReceipt, result.forge); assert(!after.inventory.instances.some(i => i.id === output));
    assert.equal(after.gold, forge.p.gold + 15); report.forgeOutputAndLastCopy = { exactOutputId: output, receiptPreserved: true, lastCopyRemoved: true, reload: true };
  } finally { await special.close(); }
  for (const faultKind of ["temp-write", "main-readback"]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      await ctx.addInitScript(() => {
        const put = IDBObjectStore.prototype.put, get = IDBObjectStore.prototype.get;
        IDBObjectStore.prototype.put = function(value, ...args) {
          if (window.__salvageFault === "temp-write" && value?.path?.endsWith("/profile.tmp.json")) throw new Error("Injected salvage temp write failure");
          const r = put.call(this, value, ...args);
          if (window.__salvageFault === "main-readback" && value?.path?.endsWith("/profile.json")) window.__salvageCommitted = true;
          return r;
        };
        IDBObjectStore.prototype.get = function(key, ...args) {
          if (window.__salvageFault === "main-readback" && window.__salvageCommitted && key === "/DATA/saves/profile.json") throw new Error("Injected salvage main readback failure");
          return get.call(this, key, ...args);
        };
      });
      const page = await ctx.newPage(); observe(page); const f = fixture(); await seed(page, f.p); const sheet = await gear(page), before = await storage(page);
      await review(sheet, f.ids[4]); await page.evaluate(kind => { window.__salvageFault = kind; }, faultKind); await confirm(sheet, f.ids[4], 5).click();
      await expect(page.getByText("Adventure paused", { exact: true })).toBeVisible();
      assert.equal(await page.getByText(`Copy #${f.ids[4]} salvaged for 5 Gold and saved.`, { exact: true }).count(), 0);
      if (faultKind === "temp-write") assert.deepEqual(await storage(page), before);
      await page.evaluate(() => { window.__salvageFault = null; });
      await page.getByRole("button", { name: "Check again (read only)", exact: true }).click(); await page.getByRole("button", { name: "Continue", exact: true }).click(); await page.locator(".header").waitFor();
      const recovered = await profile(page); assert.equal(recovered.gold, f.p.gold + (faultKind === "main-readback" ? 5 : 0));
      assert.equal(recovered.inventory.instances.some(i => i.id === f.ids[4]), faultKind === "temp-write");
      if (faultKind === "temp-write") { const retry = await gear(page); await review(retry, f.ids[4]); await confirm(retry, f.ids[4], 5).click(); await saved(retry, f.ids[4], 5); }
      await page.reload(); await page.locator(".header").waitFor(); assert.equal((await profile(page)).gold, f.p.gold + 5);
      assert(!(await profile(page)).inventory.instances.some(i => i.id === f.ids[4]));
      report.cases.push({ faultKind, noFalseSuccess: true, completeRecovery: true, rewardOnceReload: true });
    } finally { await ctx.close(); }
  }
  const offline = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const page = await offline.newPage(); observe(page); const f = fixture(); await seed(page, f.p); const sheet = await gear(page);
    await review(sheet, f.ids[4]); await confirm(sheet, f.ids[4], 5).click(); await saved(sheet, f.ids[4], 5);
    const committed = await profile(page); applyCommand(committed, content, { type: "startFarm", zoneId: "greenfields" }, { contentTimeMs: Date.now() }); committed.clock.lastSettledWallMs = Date.now() - 3600000;
    const workers = []; page.on("worker", w => workers.push(w.url())); await seed(page, committed);
    await expect.poll(() => page.evaluate(() => window.__ember.perf().lastCatchUp?.mode)).toBe("worker");
    const restored = await profile(page); assert(!restored.inventory.instances.some(i => i.id === f.ids[4])); assert(restored.gold >= committed.gold);
    assert.deepEqual(restored.itemLocks, committed.itemLocks); assert(workers.some(w => w.includes("offline.worker")));
    report.offlineWorker = { elapsedMs: 3600000, mode: "worker", salvagedIdAbsent: true, goldAndLocksPreserved: true };
  } finally { await offline.close(); }
  assert.deepEqual(report.errors, []); report.pass = true;
  console.log(JSON.stringify({ pass: true, cases: report.cases.length, large: report.largeInventory, forge: report.forgeOutputAndLastCopy, offline: report.offlineWorker }));
} finally { writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2) + "\n"); await browser.close(); server.close(); }
