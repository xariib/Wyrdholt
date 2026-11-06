/** Forge's Compare result must equip its exact output when older copies exist.
 * node --import tsx tools/smoke/forge-result-check.mjs webDir output.json
 * Controlled valid saves, real IndexedDB and built React UI in both browsers.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { chromium, webkit } from 'playwright';
import { CONTENT } from '@emberbound/game-content';
import { ContentIndex, createProfile, createInstance, serializeSave, parseSave } from '@emberbound/game-core';

const [web, output] = process.argv.slice(2).map(p => resolve(p));
const content = new ContentIndex(CONTENT);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/observer') { res.end('<!doctype html><title>Fixture observer</title>'); return; }
  const file = resolve(web, '.' + (path === '/' ? '/index.html' : path));
  try { assert(file.startsWith(web + sep) && statSync(file).isFile()); res.setHeader('content-type', types[extname(file)] ?? 'application/octet-stream'); res.end(readFileSync(file)); }
  catch { res.writeHead(404); res.end(); }
});
const profile = page => page.evaluate(() => JSON.parse(JSON.parse(window.__ember.exportSave()).payload));
const checks = [], errors = [];
const selected = (process.env.FORGE_RESULT_ENGINES ?? "chromium,webkit").split(",");
assert(selected.length && selected.every(e => ["chromium", "webkit"].includes(e)));
await new Promise(r => server.listen(0, '127.0.0.1', r));
try {
  for (const engine of [chromium, webkit].filter(e => selected.includes(e.name()))) {
    const browser = await engine.launch(engine === chromium && process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {});
    try {
      for (const olderState of ['inventory', 'equipped', 'queued']) {
        const p = createProfile(content, { name: 'Exact result', activeClassId: 'monk', alternateClassId: 'mage', masterSeed: 1042, nowWallMs: Date.now() });
        const base = CONTENT.items.find(i => i.slot === 'weapon' && i.rarity === 'uncommon').id;
        const older = createInstance(p, base, { isNew: false }).id;
        createInstance(p, base, { isNew: true }); // Another new copy must not cause a review loop.
        for (let i = 0; i < 5; i++) createInstance(p, 'wayfarer_blade', { isNew: true });
        p.gold = 500; p.adventure.zones.greenfields.cleared = true;
        if (olderState === 'equipped') p.equipment.weapon = older;
        if (olderState === 'queued') p.pending = { equipment: { weapon: older } };
        const seed = serializeSave(p, Date.now()); assert(parseSave(seed).ok);
        const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
        try {
          const page = await context.newPage(); page.on('pageerror', e => errors.push(String(e)));
          const url = `http://127.0.0.1:${server.address().port}`;
          await page.goto(url + '/observer');
          await page.evaluate(async raw => {
            const db = await new Promise((ok, fail) => {
              const r = indexedDB.open('Disc', 1);
              r.onupgradeneeded = () => { const s = r.result.createObjectStore('FileStorage', { keyPath: 'path' }); s.createIndex('by_folder', 'folder'); };
              r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error);
            });
            try { await new Promise((ok, fail) => {
              const tx = db.transaction('FileStorage', 'readwrite');
              tx.objectStore('FileStorage').put({ path: '/DATA/saves/profile.json', folder: '/DATA/saves', type: 'file', content: raw, size: raw.length, ctime: 1, mtime: 1 });
              tx.oncomplete = ok; tx.onerror = () => fail(tx.error);
            }); } finally { db.close(); }
          }, seed);
          await page.goto(url); await page.locator('.header').waitFor();
          await page.getByRole('button', { name: /^Gear/ }).last().click();
          await page.getByRole('button', { name: 'Forge', exact: true }).click();
          const sheet = page.getByRole('dialog', { name: 'Forge', exact: true });
          await sheet.locator('.forge-dev summary').click();
          await sheet.getByLabel('Forge DEV outcome').selectOption('normal');
          await sheet.getByRole('button', { name: 'Select up to 5', exact: true }).click();
          await sheet.getByTestId('forge-review').click(); await sheet.getByTestId('forge-submit').click();
          await sheet.getByTestId('forge-result').waitFor();
          const fused = await profile(page), receipt = fused.forge.lastReceipt;
          assert.equal(receipt.outputBaseId, base);
          if (olderState === 'equipped') assert.equal(fused.equipment.weapon, older);
          if (olderState === 'queued') assert.equal(fused.pending.equipment.weapon, older);
          await sheet.getByRole('button', { name: 'Compare result' }).click();
          await page.getByRole('button', { name: `Equip ${content.item(base).name}`, exact: true }).click();
          assert.equal((await profile(page)).equipment.weapon, receipt.outputInstanceId, `${engine.name()}/${olderState}: equip the forged copy`);
          // Equip uses the existing delayed save; poll real stored bytes in Node.
          const deadline = Date.now() + 10_000;
          let savedWeapon;
          do {
            savedWeapon = await page.evaluate(async () => {
              const db = await new Promise((ok, fail) => { const r = indexedDB.open('Disc', 1); r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error); });
              try { return await new Promise((ok, fail) => {
                const r = db.transaction('FileStorage', 'readonly').objectStore('FileStorage').get('/DATA/saves/profile.json');
                r.onsuccess = () => ok(r.result?.content ? JSON.parse(JSON.parse(r.result.content).payload).equipment.weapon : null); r.onerror = () => fail(r.error);
              }); } finally { db.close(); }
            });
            if (savedWeapon !== receipt.outputInstanceId) await new Promise(r => setTimeout(r, 100));
          } while (savedWeapon !== receipt.outputInstanceId && Date.now() < deadline);
          assert.equal(savedWeapon, receipt.outputInstanceId);
          await page.reload(); await page.locator('.header').waitFor();
          const restored = await profile(page);
          assert.equal(restored.equipment.weapon, receipt.outputInstanceId);
          checks.push({ engine: engine.name(), olderState, olderId: older, outputId: receipt.outputInstanceId, exactEquipAndReload: true });
        } finally { await context.close(); }
      }
    } finally { await browser.close(); }
  }
  assert.deepEqual(errors, []);
  writeFileSync(output, JSON.stringify({ pass: true, web, checks, errors, notRun: ["chromium", "webkit"].filter(e => !selected.includes(e)) }, null, 2) + '\n');
  console.log('PASS exact Forge result comparison/equip/reload', checks);
} finally { server.close(); }
