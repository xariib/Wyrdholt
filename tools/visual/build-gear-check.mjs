// Built browser, disposable characters: node --import tsx tools/visual/build-gear-check.mjs
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { preview } from 'vite';
import { chromium, expect } from 'playwright/test';
import { CONTENT } from '@emberbound/game-content';
import { ContentIndex, createInstance, createProfile, serializeSave } from '@emberbound/game-core';

const content = new ContentIndex(CONTENT);
const out = resolve('tools/smoke/out/build-gear'); mkdirSync(out, { recursive: true });
const server = await preview({ root: resolve('apps/mobile'), configFile: false, preview: { host: '127.0.0.1', port: 0 } });
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
const report = { cases: [], errors: [] };
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const classId of ['monk', 'mage', 'warrior', 'ranger']) {
    const profile = createProfile(content, { name: 'Builds', activeClassId: classId,
      alternateClassId: classId === 'mage' ? 'monk' : 'mage', masterSeed: 42, nowWallMs: Date.now() });
    const items = CONTENT.items.filter(item => item.classId === classId && /^(precision|tempo|bulwark)_/.test(item.id));
    for (const item of items) createInstance(profile, item.id, { isNew: true });
    const context = await browser.newContext({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true });
    try {
      const page = await context.newPage();
      page.on('pageerror', error => report.errors.push(error.message));
      await page.route('**/fixture', route => route.fulfill({ contentType: 'text/html', body: '<title>Fixture</title>' }));
      await page.goto(`${base}/fixture`);
      await page.evaluate(async raw => {
        const db = await new Promise((ok, fail) => {
          const request = indexedDB.open('Disc', 1);
          request.onupgradeneeded = () => request.result.createObjectStore('FileStorage', { keyPath: 'path' }).createIndex('by_folder', 'folder');
          request.onsuccess = () => ok(request.result); request.onerror = () => fail(request.error);
        });
        await new Promise((ok, fail) => {
          const tx = db.transaction('FileStorage', 'readwrite');
          tx.objectStore('FileStorage').put({ path: '/DATA/saves/profile.json', folder: '/DATA/saves', type: 'file', content: raw, size: raw.length, ctime: 1, mtime: 1 });
          tx.oncomplete = ok; tx.onerror = () => fail(tx.error);
        });
        db.close();
      }, serializeSave(profile, Date.now()));
      await page.goto(base);
      await page.getByRole('navigation').getByRole('button', { name: 'Gear', exact: true }).click();
      const icons = new Map();
      for (const style of ['precision', 'tempo', 'bulwark']) {
        await page.locator('.inventory-entry').click();
        const inventory = page.getByRole('dialog', { name: 'Gear inventory', exact: true });
        await inventory.getByRole('searchbox').fill(style);
        for (const rarity of ['rare', 'epic', 'legendary']) {
          await inventory.getByRole('combobox', { name: 'Rarity', exact: true }).selectOption(rarity);
          await expect(inventory.locator('.gear-result-count')).toContainText('6 of 54 item types');
          await expect(inventory.locator('[data-gear-skin]')).toHaveCount(6);
          for (const item of items.filter(item => item.rarity === rarity && item.id.startsWith(`${style}_`))) {
            const image = inventory.locator(`[data-gear-skin="${item.id}"] img`);
            await expect(image).toBeVisible();
            icons.set(item.id, await image.getAttribute('src'));
          }
        }
        await inventory.getByRole('button', { name: 'Close inventory', exact: true }).click();
        for (const item of items.filter(item => item.rarity === 'rare' && item.id.startsWith(`${style}_`))) {
          await page.locator(`[data-slot="${item.slot}"]`).click();
          const sheet = page.getByRole('dialog', { name: 'Equipment', exact: true });
          await sheet.getByRole('searchbox').fill(style);
          await sheet.getByRole('combobox', { name: 'Rarity', exact: true }).selectOption('rare');
          await sheet.locator('.slot-inventory .list-item').filter({ hasText: item.name }).click();
          await expect(sheet.locator('.comparison-stats')).toBeVisible();
          await sheet.getByRole('button', { name: `Equip ${item.name}`, exact: true }).click();
          await expect(page.locator(`[data-slot="${item.slot}"]`)).toContainText(item.name);
        }
        await page.screenshot({ path: resolve(out, `${classId}-${style}.png`) });
        for (const [width, height] of [[320, 568], [640, 360]]) {
          await page.setViewportSize({ width, height });
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${classId}/${style}: overflow at ${width}`);
        }
        await page.setViewportSize({ width: 360, height: 640 });
        const expectedEquipment = Object.fromEntries(items.filter(item => item.rarity === 'rare' && item.id.startsWith(`${style}_`))
          .map(item => [item.slot, profile.inventory.instances.find(copy => copy.baseId === item.id).id]));
        // Flush via the real lifecycle handler before testing persisted equipment.
        await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
        await expect.poll(() => page.evaluate(() => new Promise(resolve => {
          const request = indexedDB.open('Disc', 1);
          request.onerror = () => resolve(false);
          request.onsuccess = () => {
            const db = request.result, tx = db.transaction('FileStorage', 'readonly');
            const get = tx.objectStore('FileStorage').get('/DATA/saves/profile.json');
            get.onsuccess = () => {
              try {
                const saved = JSON.parse(JSON.parse(get.result.content).payload);
                resolve(saved.equipment);
              } catch { resolve(false); }
            };
            get.onerror = () => resolve(false);
            tx.oncomplete = () => db.close();
          };
        })), { timeout: 10_000 }).toEqual(expectedEquipment);
        // The main file can be visible before guarded readback/postflight finishes.
        await page.evaluate(() => navigator.locks.request('wyrdholt-save/Directory.Data/saves', () => {}));
        await page.reload();
        await page.getByRole('navigation').getByRole('button', { name: 'Gear', exact: true }).click();
        for (const item of items.filter(item => item.rarity === 'rare' && item.id.startsWith(`${style}_`))) {
          await expect(page.locator(`[data-slot="${item.slot}"]`)).toContainText(item.name);
        }
        report.cases.push({ classId, style, rarityIcons: 18, equippedSlots: 6, reload: true });
      }
      for (const item of items.filter(item => item.id.startsWith('precision_'))) {
        const source = item.id.slice('precision_'.length);
        assert.equal(new Set(['precision', 'tempo', 'bulwark'].map(style => icons.get(`${style}_${source}`))).size, 3, `${source}: indistinguishable style icons`);
      }
    } catch (error) {
      const page = context.pages()[0];
      if (page) {
        await page.screenshot({ path: resolve(out, `${classId}-failure.png`) });
        console.error(await page.locator('.slot-card').allTextContents());
        console.error(await page.evaluate(() => new Promise(resolve => {
          const open = indexedDB.open('Disc', 1);
          open.onsuccess = () => {
            const db = open.result, get = db.transaction('FileStorage', 'readonly').objectStore('FileStorage').getAll();
            get.onsuccess = () => {
              resolve(get.result.filter(record => record.path.includes('profile')).map(record => {
                try { const envelope = JSON.parse(record.content); return { path: record.path, savedAt: envelope.savedAtWallMs, equipment: JSON.parse(envelope.payload).equipment }; }
                catch { return { path: record.path }; }
              })); db.close();
            };
          };
        })));
      }
      throw error;
    } finally { await context.close(); }
  }
  assert.deepEqual(report.errors, []);
  console.log('PASS: 216 icons, 72 UI equips, 12 reloads, distinct style materials and three mobile sizes across all four classes.');
} finally {
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close(); await server.httpServer.close();
}
