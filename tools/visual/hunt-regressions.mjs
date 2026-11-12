// node --import tsx tools/visual/hunt-regressions.mjs
// Disposable saves only. Reproductions for restore isolation and post-defeat visuals.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { preview } from 'vite';
import { chromium } from 'playwright';
import { CONTENT } from '@emberbound/game-content';
import { ContentIndex, FightCache, createProfile, heroStatsFor, prepareFight, serializeSave, startRun } from '@emberbound/game-core';
import { equippedAppearance } from '../../apps/mobile/src/art/gearSkins.ts';
import { equipCommonGear } from '../fixtures/equipment.mjs';

const out = resolve('tools/smoke/out/hunt-regressions'); mkdirSync(out, { recursive: true });
const content = new ContentIndex(CONTENT), report = { restores: [], errors: [] };
const fixture = name => createProfile(content, { name, activeClassId: 'warrior', alternateClassId: 'mage', masterSeed: 17, nowWallMs: Date.now() });
const strong = fixture('Strong'), weak = fixture('Weak');
equipCommonGear(strong, content); equipCommonGear(weak, content);
strong.inventory.instances.find(i => i.id === strong.equipment.weapon).baseId = 'kingsfall';
strong.inventory.instances.find(i => i.id === strong.equipment.chest).baseId = 'last_light_vest_warrior';
const server = await preview({ root: resolve('apps/mobile'), configFile: false, preview: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', e => report.errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await page.locator('.class-option').first().waitFor();
  await page.evaluate(async raw => {
    const db = await new Promise((ok, fail) => {
      const r = indexedDB.open('Disc', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('FileStorage', { keyPath: 'path' }).createIndex('by_folder', 'folder');
      r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error);
    });
    await new Promise((ok, fail) => {
      const tx = db.transaction('FileStorage', 'readwrite');
      tx.objectStore('FileStorage').put({ path: '/DATA/saves/profile.json', folder: '/DATA/saves', type: 'file', content: raw, size: raw.length, ctime: 1, mtime: 1 });
      tx.oncomplete = ok; tx.onerror = () => fail(tx.error);
    }); db.close();
  }, serializeSave(strong, Date.now()));
  await page.reload();
  await page.waitForFunction(() => window.__emberRenderer?.heroAppearance);
  for (const next of [weak, strong, weak]) {
    const beforeFrame = await page.evaluate(() => window.__emberRenderer.lastFrame.frameId);
    await page.getByRole('navigation').getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByText('Restore backup', { exact: true }).click();
    next.clock.lastSettledWallMs = Date.now();
    await page.getByLabel('Or paste backup text').fill(serializeSave(next, Date.now()));
    await page.getByRole('button', { name: 'Review backup text', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm restore', exact: true }).click();
    await page.getByRole('navigation').getByRole('button', { name: 'Adventure', exact: true }).and(page.locator('[aria-current="page"]')).waitFor();
    await page.waitForFunction(before => window.__emberRenderer.lastFrame.frameId > before + 2, beforeFrame);
    const observed = await page.evaluate(() => ({ maxHp100: window.__emberRenderer.lastFrame.heroMaxHp100, vitals: window.__emberRenderer.heroVitals(),
      skin: window.__emberRenderer.heroAppearance.key, header: document.querySelector('.header [data-appearance]').dataset.appearance }));
    const expected = { maxHp100: heroStatsFor(next, content).maxHp100, skin: equippedAppearance(next, content).key };
    report.restores.push({ name: next.character.name, observed, expected });
  }
  const fallen = fixture('Fallen'), run = startRun(fallen, content, 'greenfields', 'trail', 0);
  run.hp100 = 1;
  const fight = prepareFight(fallen, content, run, { contentTimeMs: 0, recordEvents: true, cache: new FightCache() });
  assert.equal(fight.summary.outcome, 'defeat');
  report.recovery = await page.evaluate(({ fight, run }) => {
    const r = window.__emberRenderer, frame = { activity: 'farm', run, fight, lastFight: null,
      elapsedMs: fight.summary.durationMs, heroMaxHp100: fight.hero.maxHp100, carriedHp100: 1, frameId: 10000 };
    const draw = r.onFrame.bind(r); r.onFrame = () => {}; // Freeze only this disposable renderer.
    draw(frame);
    const dead = r.actors.get('hero').alive;
    draw({ ...frame, run: { ...run, phase: 'rest', hp100: null }, fight: null, lastFight: fight, carriedHp100: null, elapsedMs: 0 });
    const hero = r.actors.get('hero');
    return { wasAlive: dead, alive: hero.alive, hp100: hero.hp100, expectedHp100: fight.hero.maxHp100, pose: hero.motion.pose };
  }, { fight, run });
  await page.locator('.combat-canvas').screenshot({ path: resolve(out, 'recovered-hero.png') });
  for (const r of report.restores) {
    assert.equal(r.observed.maxHp100, r.expected.maxHp100, `${r.name}: previous save's health leaked`);
    assert.equal(r.observed.vitals.max100, r.expected.maxHp100, `${r.name}: displayed maximum health is stale`);
    assert.equal(r.observed.vitals.hp100, r.expected.maxHp100, `${r.name}: idle character should display full health`);
    assert.equal(r.observed.skin, r.expected.skin, `${r.name}: previous save's skin remained`);
    assert.equal(r.observed.header, r.observed.skin, `${r.name}: portrait disagrees with combat`);
  }
  assert.equal(report.recovery.wasAlive, false);
  assert.equal(report.recovery.alive, true);
  assert.equal(report.recovery.hp100, report.recovery.expectedHp100);
  assert.equal(report.recovery.pose, 'idle');
  assert.deepEqual(report.errors, []);
  console.log('PASS: repeated real-UI restores isolate stats and skins; post-defeat rest shows a living, healed character.');
} finally {
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close(); await server.close();
}
