// Actual built UI/storage, exact copies and previous-preview refusal; disposable saves only.
// node --import tsx tools/smoke/item-locks-check.mjs [newDist] [oldDist] [outputDir]
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { resolve, join, extname, sep } from "node:path";
import { chromium, expect } from "playwright/test";
import { build } from "esbuild";
import { CONTENT } from "@emberbound/game-content";
import { ContentIndex, applyCommand, createInstance, createProfile, parseSave, serializeSave, setItemLock } from "@emberbound/game-core";

const dist = resolve(process.argv[2] ?? "apps/mobile/dist");
const oldDist = resolve(process.argv[3]);
const out = resolve(process.argv[4] ?? "tools/smoke/out/item-locks"); mkdirSync(out, { recursive: true });
const content = new ContentIndex(CONTENT);
const report = { pass: false, scope: "Disposable real IndexedDB saves, not user saves/native/human acceptance", cases: [], errors: [] };
let currentDist = dist;
await build({ entryPoints: ["tools/parity/forge-browser.ts"], bundle: true, format: "iife", platform: "browser", outfile: join(out, "forge-parity.js") });
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const server = createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname === "/observer") { res.setHeader("content-type", "text/html"); res.end('<!doctype html><title>Storage observer</title><link rel="icon" href="/brand/I0_32_native.png">'); return; }
  if (pathname === "/forge-parity") { res.setHeader("content-type", "text/html"); res.end('<!doctype html><title>Forge parity</title><link rel="icon" href="/brand/I0_32_native.png"><script src="/forge-parity.js"></script>'); return; }
  if (pathname === "/forge-parity.js") { res.setHeader("content-type", "text/javascript"); res.end(readFileSync(join(out, "forge-parity.js"))); return; }
  const file = resolve(currentDist, "." + (pathname === "/" ? "/index.html" : pathname));
  try { assert(file.startsWith(currentDist + sep) && statSync(file).isFile()); res.setHeader("content-type", mime[extname(file)] ?? "application/octet-stream"); res.end(readFileSync(file)); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok); });
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH ?? "/usr/bin/chromium" });
report.browser = browser.version();
const exported = page => page.evaluate(() => window.__ember.exportSave());
const profile = async page => {
  const parsed = parseSave(await exported(page)); assert(parsed.ok); return parsed.profile;
};
async function slots(page) {
  return page.evaluate(async () => {
    const db = await new Promise((ok, fail) => { const r = indexedDB.open("Disc", 1); r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error); });
    try { return await new Promise((ok, fail) => {
      const r = db.transaction("FileStorage", "readonly").objectStore("FileStorage").getAll();
      r.onsuccess = () => ok(r.result.filter(x => x.path.startsWith("/DATA/saves/")).map(x => [x.path, x.content]).sort()); r.onerror = () => fail(r.error);
    }); } finally { db.close(); }
  });
}
async function seed(page, raw) {
  await page.goto(url + "/observer");
  await page.evaluate(async raw => {
    const db = await new Promise((ok, fail) => {
      const r = indexedDB.open("Disc", 1);
      r.onupgradeneeded = () => { const s = r.result.createObjectStore("FileStorage", { keyPath: "path" }); s.createIndex("by_folder", "folder"); };
      r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error);
    });
    try { await new Promise((ok, fail) => {
      const tx = db.transaction("FileStorage", "readwrite");
      tx.objectStore("FileStorage").clear();
      tx.objectStore("FileStorage").put({ path: "/DATA/saves/profile.json", folder: "/DATA/saves", type: "file", content: raw, size: raw.length, ctime: 1, mtime: 1 });
      tx.oncomplete = ok; tx.onerror = () => fail(tx.error);
    }); } finally { db.close(); }
  }, raw);
  await page.goto(url); await page.locator(".header").waitFor();
}
function fixture(copies = 7) {
  const p = createProfile(content, { name: "Exact locks", activeClassId: "monk", alternateClassId: "mage", masterSeed: 1042, nowWallMs: Date.now() });
  p.gold = 500; p.adventure.zones.greenfields.cleared = true;
  const ids = Array.from({ length: copies }, () => createInstance(p, "wayfarer_blade", { isNew: true }).id);
  p.pending = { equipment: { weapon: ids[1] } };
  return { p, ids, equipped: p.equipment.weapon, raw: serializeSave(p, Date.now()) };
}
async function gear(page) {
  await page.getByRole("button", { name: /^Gear/ }).last().click();
  await page.locator('[data-slot="weapon"]').click();
  const sheet = page.getByRole("dialog", { name: "Equipment", exact: true });
  await sheet.locator(".gear-copies summary").click();
  return sheet;
}
async function lock(sheet, id, locked) {
  await sheet.getByRole("button", { name: `${locked ? "Lock" : "Unlock"} copy #${id}`, exact: true }).click();
  await expect(sheet.getByRole("status").filter({ hasText: `Copy #${id} ${locked ? "locked" : "unlocked"} and saved.` })).toBeVisible();
}
try {
  const parityPage = await browser.newPage(); await parityPage.goto(url + "/forge-parity");
  await parityPage.waitForFunction(() => window.__forgeParity);
  const vector = await parityPage.evaluate(() => window.__forgeParity);
  // The historical Forge golden includes the C2 content label in serialized saves.
  // Compare against a captured exact PR22 run; never overwrite that old golden.
  const golden = JSON.parse(readFileSync("docs/project/tasks/evidence/ITEM-LOCKS-007/forge-pr22-baseline.json", "utf8"));
  assert.equal(vector.count, golden.count); assert.equal(vector.hash, golden.hash);
  report.forgeChromiumParity = vector; await parityPage.close();
  for (const [width, height] of [[360, 640], [390, 844], [412, 915], [480, 854]]) {
    const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true });
    try {
      const page = await ctx.newPage(); page.on("pageerror", e => report.errors.push(String(e)));
      page.on("console", m => { if (m.type() === "error") report.errors.push(m.text()); });
      const f = fixture(); await seed(page, f.raw); const before = await profile(page);
      const sheet = await gear(page);
      await expect(sheet.locator(`[data-instance-id="${f.equipped}"]`).getByText("Equipped", { exact: true })).toBeVisible();
      await expect(sheet.locator(`[data-instance-id="${f.ids[1]}"]`).getByText("Queued", { exact: true })).toBeVisible();
      await lock(sheet, f.ids[0], true);
      const locked = await profile(page); assert.deepEqual(locked.itemLocks.lockedInstanceIds, [f.ids[0]]);
      assert.deepEqual(locked.inventory, before.inventory, "Locking must not review NEW or change another copy");
      assert.deepEqual(locked.equipment, before.equipment); assert.deepEqual(locked.pending, before.pending);
      await expect(sheet.locator(`[data-instance-id="${f.ids[0]}"]`).getByText("Protected from Forge. Can still be equipped.", { exact: true })).toBeVisible();
      await lock(sheet, f.ids[1], true); await lock(sheet, f.ids[1], false);
      await expect(sheet.locator(`[data-instance-id="${f.ids[1]}"]`).getByText("Queued", { exact: true })).toBeVisible();
      for (const control of await sheet.locator(".gear-copy-actions button").all()) {
        const box = await control.boundingBox(); assert(box && box.width >= 44 && box.height >= 44);
      }
      assert(await sheet.evaluate(e => e.scrollWidth <= e.clientWidth), "No sheet overflow");
      const unlock = sheet.getByRole("button", { name: `Unlock copy #${f.ids[0]}`, exact: true });
      await unlock.focus(); await expect(unlock).toBeFocused();
      await page.keyboard.press("Enter"); await expect(sheet.getByRole("button", { name: `Lock copy #${f.ids[0]}`, exact: true })).toBeVisible();
      await lock(sheet, f.ids[0], true);
      await page.screenshot({ path: join(out, `${width}-copies.png`) });
      await sheet.getByRole("button", { name: "Close equipment", exact: true }).click();
      await page.getByRole("button", { name: "Forge", exact: true }).click();
      const forge = page.getByRole("dialog", { name: "Forge", exact: true });
      await expect(forge.getByTestId("forge-locked-count")).toHaveText("1 locked copy excluded for this slot and rarity.");
      await expect(forge.locator(".forge-item").getByText("5 available · 0 selected", { exact: true })).toBeVisible();
      await forge.getByRole("button", { name: "Select up to 5", exact: true }).click();
      await forge.getByTestId("forge-review").click();
      for (const id of [f.equipped, f.ids[0], f.ids[1]]) assert(!(await forge.locator(".forge-materials").innerText()).includes(`#${id}\n`), "Protected material is excluded");
      const materialIds = await forge.locator(".forge-materials .faint").allTextContents();
      assert.deepEqual(materialIds.map(x => Number(x.slice(1))), f.ids.slice(2));
      await forge.getByTestId("forge-submit").click(); await expect(forge.getByTestId("forge-result")).toBeVisible();
      const fused = await profile(page), receipt = fused.forge.lastReceipt;
      assert.deepEqual(receipt.consumedIds, f.ids.slice(2)); assert.equal(fused.gold, 400);
      assert.deepEqual(fused.itemLocks.lockedInstanceIds, [f.ids[0]]);
      assert(fused.inventory.instances.some(i => i.id === f.ids[0]));
      await forge.getByRole("button", { name: "Compare result", exact: true }).click();
      await sheet.locator(".gear-copies summary").click(); await lock(sheet, receipt.outputInstanceId, true);
      await page.screenshot({ path: join(out, `${width}-result-lock.png`) });
      await sheet.getByRole("button", { name: `Equip ${content.item(receipt.outputBaseId).name}`, exact: true }).click();
      await expect.poll(async () => {
        const raw = (await slots(page)).find(([p]) => p.endsWith("/profile.json"))?.[1];
        const parsed = raw && parseSave(raw); return parsed?.ok ? parsed.profile.equipment.weapon : null;
      }).toBe(receipt.outputInstanceId);
      await page.reload(); await page.locator(".header").waitFor();
      const reloaded = await profile(page); assert.equal(reloaded.equipment.weapon, receipt.outputInstanceId);
      assert.deepEqual(reloaded.forge.lastReceipt, receipt);
      assert.deepEqual(reloaded.itemLocks.lockedInstanceIds, [f.ids[0], receipt.outputInstanceId]);
      assert.equal(JSON.parse(await exported(page)).schema, 3);
      report.cases.push({ width, height, exactCopyLocks: true, equippedQueued: true, newPreservedByLock: true, touch44: true, keyboard: true,
        forgeProtectedCopiesExcluded: true, exactReceiptOutputLockEquipReload: true, schema3: true });
    } finally { await ctx.close(); }
  }
  // Use the exact previously deployed static build on the same isolated origin.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const page = await ctx.newPage(), f = fixture(); currentDist = oldDist; await seed(page, f.raw);
    assert.equal(JSON.parse(await exported(page)).schema, 1);
    await page.goto(url + "/observer"); currentDist = dist; await page.goto(url); await page.locator(".header").waitFor();
    const sheet = await gear(page); await lock(sheet, f.ids[0], true);
    await sheet.getByRole("button", { name: "Close equipment", exact: true }).click();
    await page.goto(url + "/observer"); const rawSlots = await slots(page); currentDist = oldDist;
    await page.goto(url); await expect(page.getByText("Adventure paused", { exact: true })).toBeVisible();
    await expect(page.getByText("A saved adventure uses a version this build cannot open.", { exact: true })).toBeVisible();
    await page.waitForTimeout(1600); assert.deepEqual(await slots(page), rawSlots, "Old reader must preserve all raw slots");
    await page.goto(url + "/observer"); currentDist = dist; await page.goto(url); await page.locator(".header").waitFor();
    const restored = await profile(page); assert.deepEqual(restored.itemLocks.lockedInstanceIds, [f.ids[0]]);
    assert.deepEqual(restored.inventory.instances.map(i => i.id), f.p.inventory.instances.map(i => i.id));
    report.previousPreviewUpgradeRefusalReturn = { pass: true, sameOrigin: true, rawSlotsPreserved: true, idsAndLockPreserved: true };
  } finally { await ctx.close(); currentDist = dist; }
  const large = await browser.newContext({ viewport: { width: 360, height: 640 }, hasTouch: true, isMobile: true });
  try {
    const page = await large.newPage(), f = fixture(6000); await seed(page, f.raw);
    const sheet = await gear(page); await expect(sheet.locator(".gear-copy")).toHaveCount(20);
    await sheet.getByRole("button", { name: "Next copies", exact: true }).click();
    await expect(sheet.locator(`[data-instance-id="${f.ids[19]}"]`)).toBeVisible();
    await lock(sheet, f.ids[19], true); assert.deepEqual((await profile(page)).itemLocks.lockedInstanceIds, [f.ids[19]]);
    assert(await sheet.evaluate(e => e.scrollWidth <= e.clientWidth));
    report.largeInventory = { copies: 6000, renderedPerPage: 20, secondPageExactLock: true, overflow: false };
  } finally { await large.close(); }
  const offline = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const page = await offline.newPage(), f = fixture();
    setItemLock(f.p, f.ids[0], true); setItemLock(f.p, f.ids[1], true);
    applyCommand(f.p, content, { type: "startFarm", zoneId: "greenfields" }, { contentTimeMs: Date.now() });
    f.p.clock.lastSettledWallMs = Date.now() - 3600000;
    const workers = []; page.on("worker", w => workers.push(w.url()));
    await seed(page, serializeSave(f.p, Date.now()));
    await expect.poll(() => page.evaluate(() => window.__ember.perf().lastCatchUp?.mode)).toBe("worker");
    const restored = await profile(page);
    assert.deepEqual(restored.itemLocks.lockedInstanceIds, [f.ids[0], f.ids[1]]);
    assert(f.p.inventory.instances.every(i => restored.inventory.instances.some(x => x.id === i.id)));
    assert(workers.some(w => w.includes("offline.worker")));
    const main = (await slots(page)).find(([p]) => p.endsWith("/profile.json"))[1], saved = parseSave(main);
    assert(saved.ok); assert.deepEqual(saved.profile.itemLocks, restored.itemLocks);
    report.offlineWorker = { elapsedMs: 3600000, mode: "worker", exactLocksAndIdsSaved: true };
  } finally { await offline.close(); }
  const fault = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    await fault.addInitScript(() => {
      const original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(value, ...args) {
        if (window.__lockWriteFault && value?.path?.endsWith("/profile.tmp.json")) throw new Error("Injected lock temp write failure");
        return original.call(this, value, ...args);
      };
    });
    const page = await fault.newPage(), f = fixture(); await seed(page, f.raw);
    const sheet = await gear(page), before = await slots(page);
    await page.evaluate(() => { window.__lockWriteFault = true; });
    await sheet.getByRole("button", { name: `Lock copy #${f.ids[0]}`, exact: true }).click();
    await expect(page.getByText("Adventure paused", { exact: true })).toBeVisible();
    assert.deepEqual(await slots(page), before);
    assert.equal(await page.getByText(`Copy #${f.ids[0]} locked and saved.`, { exact: true }).count(), 0);
    await page.evaluate(() => { window.__lockWriteFault = false; });
    await page.getByRole("button", { name: "Check again (read only)", exact: true }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click(); await page.locator(".header").waitFor();
    const recovered = await profile(page); assert.equal(recovered.itemLocks, undefined);
    report.lockSaveFailure = { fault: "Injected IndexedDB temp put exception", noFalseSuccess: true, slotsPreserved: true, recoveryWithoutReset: true };
  } finally { await fault.close(); }
  assert.deepEqual(report.errors, []); report.pass = true;
  console.log(JSON.stringify({ pass: true, cases: report.cases.length, upgrade: report.previousPreviewUpgradeRefusalReturn, largeInventory: report.largeInventory }));
} finally {
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
  await browser.close(); server.close();
}
