/** Same-origin previous web artifact → Forge → previous reader refusal.
 * Uses a controlled schema 1 character, not authentic c1hotfix/native provenance.
 * node --import tsx tools/smoke/forge-upgrade-check.mjs oldWeb newWeb output.json
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';
import { CONTENT } from '@emberbound/game-content';
import { ContentIndex, createProfile, createInstance, serializeSave, parseSave } from '@emberbound/game-core';
const [oldWeb, newWeb, output] = process.argv.slice(2).map(p => resolve(p));
let active = oldWeb;
const content = new ContentIndex(CONTENT);
const p = createProfile(content, { name: 'Forge upgrade', activeClassId: 'monk', alternateClassId: 'mage', masterSeed: 1042, nowWallMs: Date.now() });
p.gold = 500; p.adventure.zones.greenfields.cleared = true;
const inputIds = Array.from({ length: 5 }, () => createInstance(p, 'wayfarer_blade', { isNew: true }).id);
const baseline = serializeSave(p, Date.now()); assert.equal(JSON.parse(baseline).schema, 1);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2' };
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/observer') { res.end('<!doctype html><title>Storage observer</title>'); return; }
  const file = resolve(active, '.' + (path === '/' ? '/index.html' : path));
  try { assert(file.startsWith(active + sep) && statSync(file).isFile()); res.setHeader('content-type', types[extname(file)] ?? 'application/octet-stream'); res.end(readFileSync(file)); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
let browser;
const slots = { main: '/DATA/saves/profile.json', temp: '/DATA/saves/profile.tmp.json', backup: '/DATA/saves/profile.bak.json' };
async function storage(page, seed) {
  return page.evaluate(async ({ slots, seed }) => {
    const db = await new Promise((ok, fail) => {
      const r = indexedDB.open('Disc', 1);
      r.onupgradeneeded = () => { const s = r.result.createObjectStore('FileStorage', { keyPath: 'path' }); s.createIndex('by_folder', 'folder'); };
      r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error);
    });
    try {
      if (seed) await new Promise((ok, fail) => {
        const tx = db.transaction('FileStorage', 'readwrite');
        tx.objectStore('FileStorage').put({ path: slots.main, folder: '/DATA/saves', type: 'file', content: seed, size: seed.length, ctime: 1, mtime: 1 });
        tx.oncomplete = ok; tx.onerror = () => fail(tx.error);
      });
      return await new Promise((ok, fail) => {
        const tx = db.transaction('FileStorage', 'readonly'), result = {};
        for (const [slot, path] of Object.entries(slots)) { const r = tx.objectStore('FileStorage').get(path); r.onsuccess = () => { result[slot] = r.result?.content ?? null; }; }
        tx.oncomplete = () => ok(result); tx.onerror = () => fail(tx.error);
      });
    } finally { db.close(); }
  }, { slots, seed });
}
const profile = page => page.evaluate(() => JSON.parse(JSON.parse(window.__ember.exportSave()).payload));
try {
  browser = await chromium.launch(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {});
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.goto(base + '/observer'); await storage(page, baseline);
  await page.goto(base); await page.locator('.header').waitFor();
  assert.equal((await profile(page)).gold, 500);
  active = newWeb; await page.reload(); await page.locator('.header').waitFor();
  assert.equal((await profile(page)).schema, 1);
  await page.getByRole('button', { name: /^Gear/ }).last().click(); await page.getByRole('button', { name: 'Forge', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Forge', exact: true });
  await sheet.getByRole('button', { name: 'Select up to 5', exact: true }).click();
  await sheet.getByTestId('forge-review').click(); await sheet.getByTestId('forge-submit').click();
  await sheet.getByTestId('forge-result').waitFor();
  const upgraded = await profile(page);
  assert.equal(upgraded.schema, 2); assert.equal(upgraded.gold, 400);
  assert.deepEqual(upgraded.forge.lastReceipt.consumedIds, inputIds);
  assert.equal(upgraded.forge.nextTransactionId, 2);
  await page.reload(); await page.locator('.header').waitFor();
  assert.deepEqual((await profile(page)).forge, upgraded.forge);
  const saved = await storage(page); assert(parseSave(saved.main).ok);
  active = oldWeb; await page.reload(); await page.getByRole('heading', { name: 'Adventure paused', exact: true }).waitFor();
  await page.waitForTimeout(300); assert.deepEqual(await storage(page), saved);
  active = newWeb; await page.reload(); await page.locator('.header').waitFor();
  assert.deepEqual((await profile(page)).forge, upgraded.forge); assert.equal((await profile(page)).gold, 400);
  assert.deepEqual(errors, []);
  const result = { pass: true, oldWeb, newWeb, browser: browser.version(), schema1Upgrade: true, exactMaterialsAndSingleCharge: true, schema2Reload: true, previousReaderRefusalPreservesAllSlots: true, returnToNewReader: true, errors, scope: 'Published web artifacts at one origin; controlled fixture, real IndexedDB; no native/authentic c1 upgrade claim' };
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result));
} finally { await browser?.close(); server.close(); }
