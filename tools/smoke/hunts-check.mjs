// Disposable browser storage only. node --import tsx tools/smoke/hunts-check.mjs
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { preview } from 'vite';
import { chromium } from 'playwright';
import { CONTENT } from '@emberbound/game-content';
import { ContentIndex, createProfile, createInstance, canUseItem, discoverHunts, serializeSave } from '@emberbound/game-core';

const out = resolve('tools/smoke/out/hunts'); mkdirSync(out, { recursive: true });
const content = new ContentIndex(CONTENT);
const web = await preview({ root: resolve('apps/mobile'), configFile: false, preview: { host: '127.0.0.1', port: 0 } });
const url = `http://127.0.0.1:${web.httpServer.address().port}`;
let browser; const report = [];
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const [width, height, route] of [[360, 640, 'raid'], [390, 844, 'weakness'], [320, 568, 'direct']]) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true });
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    try {
      await page.goto(url); await page.locator('.class-option').first().waitFor();
      const p = createProfile(content, { name: 'Hunt browser QA', masterSeed: 1042, activeClassId: 'warrior', alternateClassId: 'mage', nowWallMs: Date.now() });
      p.character.level = 30; p.character.xp = content.levelTotals[29]; p.character.masteryXp.warrior = content.masteryTotals(content.classDef('warrior').masteryTrackId)[19];
      for (const item of CONTENT.items.filter(i => i.rarity === 'legendary' && canUseItem(i, 'warrior'))) p.equipment[item.slot] = createInstance(p, item.id, { isNew: false }).id;
      Object.assign(p.adventure.zones.greenfields, { unlocked: true, cleared: true, bestStage: 10, completions: 1 });
      discoverHunts(p, content, 'greenfields', 1);
      await page.evaluate(async raw => {
        const db = await new Promise((ok, fail) => { const request = indexedDB.open('Disc', 1); request.onupgradeneeded = () => { const store = request.result.createObjectStore('FileStorage', { keyPath: 'path' }); store.createIndex('by_folder', 'folder'); }; request.onsuccess = () => ok(request.result); request.onerror = () => fail(request.error); });
        await new Promise((ok, fail) => { const tx = db.transaction('FileStorage', 'readwrite'); tx.objectStore('FileStorage').put({ path: '/DATA/saves/profile.json', folder: '/DATA/saves', type: 'file', content: raw, size: raw.length, ctime: 1, mtime: 1 }); tx.oncomplete = ok; tx.onerror = () => fail(tx.error); }); db.close();
      }, serializeSave(p, Date.now()));
      await page.reload();
      const nav = () => page.getByRole('navigation', { name: 'Game navigation' }).getByRole('button', { name: 'Challenges', exact: true }).click();
      await nav();
      const shot = async name => {
        await page.screenshot({ path: join(out, `${width}-${route}-${name}.png`), fullPage: true, animations: 'disabled' });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'horizontal overflow');
      };
      await page.getByLabel('Reward slot for The Rootbound Elder', { exact: true }).selectOption('ring'); await shot('board');
      await page.getByRole('button', { name: 'Follow the tracks', exact: true }).click();
      await page.getByLabel('Hunt combat', { exact: true }).waitFor(); await shot('combat');
      await page.getByLabel('Choose Hunt route', { exact: true }).waitFor({ timeout: 30_000 });
      await page.getByLabel('Choose Hunt route', { exact: true }).scrollIntoViewIfNeeded(); await shot('routes');
      const choice = route === 'raid' ? /^Raid the nest/ : route === 'weakness' ? /^Find its weakness/ : /^Follow the tracks ·/;
      await page.getByRole('button', { name: choice }).click();
      if (route !== 'direct') {
        await page.getByRole('button', { name: 'Challenge the boss', exact: true }).waitFor({ timeout: 30_000 });
        await page.getByRole('button', { name: 'Challenge the boss', exact: true }).click();
      }
      await page.getByText('The Rootbound Elder · Hunt complete!', { exact: true }).waitFor({ timeout: 30_000 });
      await page.getByLabel('Hunt result', { exact: true }).scrollIntoViewIfNeeded();
      await shot('reward');
      const reward = await page.getByLabel('Hunt result', { exact: true }).innerText(); assert.match(reward, /Earned/);
      await page.reload(); await nav();
      await page.getByText('Hunts completed: 1', { exact: true }).waitFor();
      assert.deepEqual(errors, []);
      report.push({ width, height, route, completed: 1, reward, errors });
      console.log(`PASS ${width}×${height} ${route}: entry, route, combat, targeted reward and reload`);
    } finally { await context.close(); }
  }
} finally { writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2)); await browser?.close(); await web.close(); }
