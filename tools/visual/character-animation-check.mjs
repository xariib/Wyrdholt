// node --import tsx tools/visual/character-animation-check.mjs
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { preview } from 'vite';
import { chromium } from 'playwright';
import { parseSave } from '@emberbound/game-core';

const out = resolve('tools/smoke/out/character-animation');
mkdirSync(out, { recursive: true });
const server = await preview({ root: resolve('apps/mobile'), configFile: false, preview: { host: '127.0.0.1', port: 0 } });
const report = [];
const savedProfile = async page => parseSave(await page.evaluate(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('Disc');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('FileStorage', 'readonly').objectStore('FileStorage').get('/DATA/saves/profile.json');
      request.onsuccess = () => resolve(request.result.content); request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}));
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const name of ['Monk', 'Mage', 'Warrior', 'Ranger']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
    await page.locator('.class-option').filter({ hasText: name }).click();
    await page.getByText('Begin in Greenfields', { exact: true }).click();
    await page.waitForFunction(() => window.__emberRenderer?.actors.get('hero')?.tex.asset);
    const created = await savedProfile(page);
    assert(created.ok);
    assert.deepEqual(created.profile.equipment, {}, `${name}: starting equipment`);
    assert.deepEqual(created.profile.inventory.instances, [], `${name}: starting inventory`);
    assert.equal(await page.evaluate(() => window.__emberRenderer.actors.get('hero').attackName), 'unarmed');
    assert.deepEqual(await page.evaluate(() => window.__emberRenderer.heroAppearance.slots), {});
    const samples = await page.evaluate(() => new Promise(resolve => {
      const samples = [], start = performance.now();
      function sample() {
        const actor = window.__emberRenderer.actors.get('hero');
        if (actor) samples.push({ pose: actor.motion.pose, x: actor.root.x - actor.baseX,
          y: actor.root.y - actor.hud.y, hudX: actor.hud.x - actor.baseX });
        if (performance.now() - start < 2800) requestAnimationFrame(sample);
        else resolve(samples);
      }
      requestAnimationFrame(sample);
    }));
    assert(samples.some(s => s.pose === 'attack' && s.x !== 0), `${name}: no attack movement`);
    assert(samples.every(s => s.hudX === 0), `${name}: moving health label`);
    await page.locator('.combat-canvas').screenshot({ path: resolve(out, `${name}-combat.png`) });
    const saved = await savedProfile(page);
    assert(saved.ok);
    assert.deepEqual(saved.profile.equipment, {});
    await page.getByRole('button', { name: /^Gear/ }).click();
    assert.equal(await page.locator('.slot-card').count(), 6);
    assert.equal(await page.locator('.slot-card .item-icon-empty').count(), 6);
    assert.deepEqual(await page.locator('.slot-card .item-name').allTextContents(), Array(6).fill('Empty'));
    const portrait = page.locator('.loadout-hero .portrait-window img');
    await portrait.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector('.portrait-window img')?.getAnimations()[0]?.playState === 'running');
    const frames = await portrait.evaluate(async node => {
      const animation = node.getAnimations()[0];
      animation.pause();
      animation.currentTime = 0;
      const first = getComputedStyle(node).transform;
      animation.currentTime = animation.effect.getTiming().duration * 0.6;
      const later = getComputedStyle(node).transform;
      animation.play();
      return [first, later];
    });
    assert.notEqual(frames[0], frames[1], `${name}: static portrait`);
    await page.screenshot({ path: resolve(out, `${name}-gear.png`) });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => {
      const a = document.querySelector('.portrait-window img')?.getAnimations()[0];
      return a?.playState === 'paused' && a.currentTime === 0;
    });
    await page.reload();
    await page.waitForFunction(() => window.__emberRenderer?.actors.get('hero')?.attackName === 'unarmed');
    assert.deepEqual(await page.evaluate(() => window.__emberRenderer.heroAppearance.slots), {});
    const reloaded = await savedProfile(page); assert(reloaded.ok);
    assert.deepEqual(reloaded.profile.equipment, {});
    assert.deepEqual(errors, []);
    report.push({ name, startingItems: 0, attackMode: 'unarmed', attackOffsets: [...new Set(samples.filter(s => s.pose === 'attack').map(s => s.x))], emptySlots: 6, reducedMotion: true });
    await page.close();
  }
  console.log('PASS: all four classes start empty, use unarmed attacks, and show animated bare portraits with reduced-motion support.');
} finally {
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close(); await server.close();
}
