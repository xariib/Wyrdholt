// Built-browser check with disposable saves: node --import tsx tools/visual/active-effects-check.mjs
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { preview } from 'vite';
import { chromium, expect } from 'playwright/test';
import { CONTENT } from '@emberbound/game-content';
import { ContentIndex, createInstance, createProfile, parseSave, serializeSave } from '@emberbound/game-core';
import { buildSummary } from '../../apps/mobile/src/ui/gearModel.ts';

const content = new ContentIndex(CONTENT);
const out = resolve('tools/smoke/out/active-effects');
mkdirSync(out, { recursive: true });
const server = await preview({ root: resolve('apps/mobile'), configFile: false, preview: { host: '127.0.0.1', port: 0 } });
const report = { cases: [], errors: [] };
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const classId of ['warrior', 'monk', 'mage', 'ranger']) {
    for (const rank of [1, 20]) {
      const profile = createProfile(content, { name: 'Effects', activeClassId: classId, alternateClassId: classId === 'mage' ? 'monk' : 'mage', masterSeed: 42, nowWallMs: Date.now() });
      profile.character.masteryXp[classId] = content.masteryTotals(content.classDef(classId).masteryTrackId)[rank - 1];
      if (rank === 20) {
        profile.schema = 5;
        profile.character.level = 25;
        profile.character.xp = content.levelTotals[24];
        profile.longTerm = { version: 1, ladders: { [`trial_${classId}`]: {
          version: 1, highestClearedTier: 1, attemptCount: 1, active: null,
          lastResult: { tier: 1, outcome: 'victory', enemyHp100: 0, enemyMaxHp100: 2600000 },
        } } };
        for (const item of CONTENT.items.filter(i => i.classId === classId && i.rarity === 'legendary')) {
          profile.equipment[item.slot] = createInstance(profile, item.id, { isNew: false }).id;
        }
      }
      const raw = serializeSave(profile, Date.now());
      const parsed = parseSave(raw);
      assert(parsed.ok, `${classId}: invalid fixture ${parsed.reason}`);
      const summary = buildSummary(profile, content);
      const expected = summary.activeEffects;
      const classEffects = summary.classEffects;
      const context = await browser.newContext({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true });
      try {
        const page = await context.newPage();
        page.on('pageerror', e => report.errors.push(e.message));
        const base = `http://127.0.0.1:${server.httpServer.address().port}`;
        // Write only into this disposable browser context, before the game starts.
        await page.route('**/fixture', route => route.fulfill({ contentType: 'text/html', body: '<title>Fixture</title>' }));
        await page.goto(`${base}/fixture`);
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
          });
          db.close();
        }, raw);
        await page.goto(base);
        await page.getByRole('navigation').getByRole('button', { name: 'Gear', exact: true }).click();
        await expect(page.locator('.loadout-overview')).toContainText(`${rank === 20 ? 6 : 0} / 6 slots equipped`);
        await expect(page.locator('.slot-effect')).toHaveCount(expected.length);
        await page.screenshot({ path: resolve(out, `${classId}-m${rank}-loadout.png`) });
        await page.getByRole('button', { name: 'Build summary ↓', exact: true }).click();
        const buildRegion = page.getByRole('region', { name: 'Build summary', exact: true });
        await expect(buildRegion.getByRole('heading', { name: 'Build summary', exact: true })).toBeInViewport();
        await page.screenshot({ path: resolve(out, `${classId}-m${rank}-summary.png`) });
        const region = page.getByRole('region', { name: 'Active effects', exact: true });
        const classRows = region.getByRole('list', { name: 'Class effects', exact: true }).locator('li');
        const gearRows = region.getByRole('list', { name: 'Gear effects', exact: true }).locator('li');
        await expect(classRows).toHaveCount(classEffects.length);
        for (const [index, effect] of classEffects.entries()) {
          const row = classRows.nth(index);
          await expect(row.locator('strong')).toHaveText(effect.name);
          await expect(row.locator('p')).toHaveText(effect.description);
          await row.scrollIntoViewIfNeeded();
          await expect(row.locator('p')).toBeInViewport();
        }
        await classRows.first().scrollIntoViewIfNeeded();
        await page.screenshot({ path: resolve(out, `${classId}-m${rank}-class-effects.png`) });
        await expect(gearRows).toHaveCount(expected.length);
        if (!expected.length) await expect(region.getByText(/No gear effects equipped yet/)).toBeVisible();
        for (const [index, effect] of expected.entries()) {
          const row = gearRows.nth(index);
          await expect(row.locator('strong')).toHaveText(effect.name);
          await expect(row.locator('p')).toHaveText(effect.description);
          await expect(row).toContainText(effect.sourceLabel);
        }
        if (expected.length) {
          const first = expected[0];
          await region.getByRole('button', { name: `Inspect ${first.sourceLabel}`, exact: true }).click();
          const sheet = page.getByRole('dialog', { name: 'Equipment', exact: true });
          await expect(sheet.getByRole('region', { name: 'Equipped item effect', exact: true })).toContainText(first.description);
          await sheet.getByRole('button', { name: 'Close equipment', exact: true }).click();
        }
        for (const [width, height] of [[320, 568], [360, 640], [640, 360]]) {
          await page.setViewportSize({ width, height });
          await region.scrollIntoViewIfNeeded();
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${classId}: page overflow at ${width}`);
          assert(await region.evaluate(el => el.scrollWidth <= el.clientWidth), `${classId}: effect overflow at ${width}`);
          const cards = await page.locator('.slot-card').evaluateAll(nodes => nodes.map(node => {
            const r = node.getBoundingClientRect();
            return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
          }));
          for (const [index, card] of cards.entries()) for (const other of cards.slice(index + 1)) {
            const overlaps = card.left < other.right && card.right > other.left && card.top < other.bottom && card.bottom > other.top;
            assert(!overlaps, `${classId}: equipment slots overlap at ${width}`);
          }
        }
        await page.setViewportSize({ width: 360, height: 640 });
        if (expected.length) await gearRows.first().scrollIntoViewIfNeeded();
        await page.screenshot({ path: resolve(out, `${classId}-m${rank}.png`) });
        if (expected.length) {
          await gearRows.last().scrollIntoViewIfNeeded();
          await expect(gearRows.last()).toBeInViewport();
        }
        await page.reload();
        await page.getByRole('navigation').getByRole('button', { name: 'Gear', exact: true }).click();
        await expect(gearRows).toHaveCount(expected.length);
        await expect(classRows.locator('strong')).toHaveText(classEffects.map(e => e.name));
        await expect(classRows.locator('p')).toHaveText(classEffects.map(e => e.description));
        await page.getByRole('navigation').getByRole('button', { name: 'Character', exact: true }).click();
        const masteryCard = page.locator(`.class-card[data-class="${classId}"][data-role="Active"]`);
        const techniques = content.track(content.classDef(classId).masteryTrackId).techniques;
        await expect(masteryCard.locator('.technique')).toHaveCount(techniques.length);
        await expect(masteryCard.locator('.technique.unlocked')).toHaveCount(techniques.filter(t => t.unlockRank <= rank).length);
        await expect(masteryCard.locator('.technique .small.muted')).toHaveText(techniques.map(t => t.description));
        report.cases.push({ classId, rank, classEffects: classEffects.length, effects: expected.length, layouts: 3, reload: true, characterMasteryPreserved: true });
      } finally { await context.close(); }
    }
  }
  assert.deepEqual(report.errors, []);
  console.log(`PASS: ${report.cases.length} cases, class and gear descriptions, effect inspection, unchanged Character mastery, three viewport sizes, scrolling and reload.`);
} finally {
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close(); await server.httpServer.close();
}
