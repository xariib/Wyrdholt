// Built browser, disposable saves: compact menus, paging and retained gear actions.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { preview } from 'vite';
import { chromium, expect } from 'playwright/test';
import { CONTENT } from '@emberbound/game-content';
import { ContentIndex, createInstance, createProfile, serializeSave } from '@emberbound/game-core';

const out = resolve('tools/smoke/out/menu-navigation');
mkdirSync(out, { recursive: true });
const content = new ContentIndex(CONTENT);
const server = await preview({ root: resolve('apps/mobile'), configFile: false, preview: { host: '127.0.0.1', port: 0 } });
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
const report = { cases: [], errors: [] };
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const [width, height] of [[320, 568], [360, 640], [390, 844], [640, 360]]) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true });
    try {
      const page = await context.newPage();
      if (width === 390) {
        const now = Date.now();
        await page.clock.install({ time: now });
        await page.clock.pauseAt(now + 1000);
      }
      page.on('pageerror', error => report.errors.push(error.message));
      const profile = createProfile(content, { name: 'Menus', activeClassId: 'monk', alternateClassId: 'mage', masterSeed: 42, nowWallMs: Date.now() });
      profile.character.masteryXp.monk = content.masteryTotals(content.classDef('monk').masteryTrackId)[5];
      const items = CONTENT.items.filter(item => item.classId === 'monk');
      for (const item of items) {
        const copy = createInstance(profile, item.id, { isNew: true });
        if (item.rarity === 'legendary' && !profile.equipment[item.slot]) profile.equipment[item.slot] = copy.id;
      }
      const duplicate = items.find(item => item.slot === 'weapon' && item.rarity === 'common');
      for (let n = 0; n < 20; n++) createInstance(profile, duplicate.id, { isNew: false });
      await page.route('**/fixture', route => route.fulfill({ contentType: 'text/html', body: '<title>Disposable fixture</title>' }));
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
      }, serializeSave(profile, Date.now()));
      await page.goto(base);
      const nav = page.getByRole('navigation', { name: 'Game navigation', exact: true });
      await nav.getByRole('button', { name: 'Gear', exact: true }).click();
      await expect(page.locator('.slot-card')).toHaveCount(6);
      const scroll = await page.locator('.gear-screen').evaluate(el => el.scrollHeight - el.clientHeight);
      await page.screenshot({ path: resolve(out, `gear-${width}.png`) });
      if (height >= 568) assert(scroll <= 2, `${width}×${height}: gear overview requires ${scroll}px scrolling`);
      await page.getByRole('button', { name: 'Build summary', exact: true }).click();
      const summary = page.getByRole('dialog', { name: 'Build summary', exact: true });
      await expect(summary.locator('.stat')).toHaveCount(6);
      await expect(summary.locator('details[open]')).toHaveCount(0);
      await summary.getByText(/^Gear effects ·/).click();
      await expect(summary.getByRole('list', { name: 'Gear effects' }).locator('li')).toHaveCount(6);
      await summary.getByRole('button', { name: /^Inspect / }).first().click();
      await expect(page.getByRole('dialog')).toHaveCount(1);
      await page.getByRole('button', { name: 'Close equipment', exact: true }).click();
      await page.getByRole('button', { name: 'Appearance', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Appearance', exact: true }).locator('[data-appearance]')).toHaveCount(1);
      await page.getByRole('button', { name: 'Close appearance', exact: true }).click();

      await page.locator('.inventory-entry').click();
      const inventory = page.getByRole('dialog', { name: 'Gear inventory', exact: true });
      await expect(inventory.locator('.inventory-item')).toHaveCount(6);
      await expect(inventory.getByRole('button', { name: 'Next items', exact: true })).toBeInViewport();
      const firstPage = await inventory.locator('[data-base-id]').evaluateAll(nodes => nodes.map(n => n.dataset.baseId));
      await inventory.getByRole('button', { name: 'Next items', exact: true }).click();
      assert.notDeepEqual(await inventory.locator('[data-base-id]').evaluateAll(nodes => nodes.map(n => n.dataset.baseId)), firstPage);
      await inventory.getByRole('searchbox').fill(duplicate.name);
      await inventory.getByRole('button', { name: `Manage copies of ${duplicate.name}`, exact: true }).click();
      await expect(inventory.locator('.gear-copy')).toHaveCount(4);
      const firstChoice = inventory.getByRole('checkbox', { name: /^Select for salvage copy/ }).first();
      const selectedName = await firstChoice.getAttribute('aria-label');
      await firstChoice.check();
      await inventory.getByRole('button', { name: 'Next copies', exact: true }).click();
      await inventory.getByRole('checkbox', { name: /^Select for salvage copy/ }).first().check();
      await inventory.getByRole('button', { name: 'Previous copies', exact: true }).click();
      await expect(inventory.getByRole('checkbox', { name: selectedName, exact: true })).toBeChecked();
      await expect(inventory.getByRole('region', { name: 'Inventory salvage selection' })).toContainText('2 copies selected');
      await inventory.getByRole('button', { name: 'Clear selection', exact: true }).click();
      await inventory.getByRole('button', { name: 'Back to inventory list', exact: true }).click();
      await inventory.getByRole('button', { name: `Compare ${duplicate.name}`, exact: true }).click();
      const equipment = page.getByRole('dialog', { name: 'Equipment', exact: true });
      await expect(equipment.getByRole('button', { name: `Equip ${duplicate.name}`, exact: true })).toBeEnabled();
      await equipment.getByRole('button', { name: `Equip ${duplicate.name}`, exact: true }).click();
      await expect(inventory.getByRole('searchbox')).toHaveValue(duplicate.name);
      await inventory.getByRole('button', { name: 'Close inventory', exact: true }).click();
      await expect(page.locator('[data-slot="weapon"]')).toContainText(duplicate.name);

      await page.getByRole('button', { name: 'Forge', exact: true }).click();
      const forge = page.getByRole('dialog', { name: 'Forge', exact: true });
      if (height >= 568) await expect(forge.getByTestId('forge-review')).toBeInViewport();
      assert(await forge.evaluate(el => el.querySelector('[data-testid="forge-review"]').compareDocumentPosition(el.querySelector('.forge-items')) & Node.DOCUMENT_POSITION_FOLLOWING));
      await forge.getByRole('button', { name: 'Close Forge', exact: true }).click();
      await nav.getByRole('button', { name: 'Character', exact: true }).click();
      await expect(page.locator('.character-screen details[open]')).toHaveCount(0);
      await page.screenshot({ path: resolve(out, `character-${width}.png`) });
      if (height >= 568) await expect(page.getByRole('button', { name: 'Make Mage active', exact: true })).toBeInViewport();
      await page.getByRole('button', { name: 'Monk skill tree', exact: true }).click();
      const skills = page.getByRole('dialog', { name: 'Monk skill tree', exact: true });
      await page.keyboard.press('Shift+Tab');
      assert(await skills.evaluate(el => el.contains(document.activeElement)), 'Keyboard focus left the skill tree');
      await expect(skills).toContainText('2 of 2 points available');
      await skills.getByRole('button', { name: 'Centered Strike', exact: true }).click();
      await expect(skills.getByRole('button', { name: 'Spend 1 point' })).toBeDisabled();
      await skills.getByRole('button', { name: 'Quick Hands', exact: true }).click();
      await skills.getByRole('button', { name: 'Spend 1 point' }).click();
      await skills.getByRole('button', { name: 'Apply skills' }).click();
      await expect(skills.getByRole('status')).toHaveText('Skills applied.');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Monk skill tree', exact: true })).toBeFocused();
      await page.locator('.class-card').first().getByText('Techniques & combat effects', { exact: true }).click();
      await expect(page.locator('.class-card').first().locator('.technique').first()).toBeVisible();
      await nav.getByRole('button', { name: 'Challenges', exact: true }).click();
      await expect(page.getByRole('region', { name: 'Ashen King ladder', exact: true })).toBeVisible();
      await page.getByRole('group', { name: 'Challenge categories' }).getByRole('button', { name: 'Hunts', exact: true }).click();
      const hunts = page.getByRole('region', { name: 'Weekly Hunts', exact: true });
      await expect(hunts).toContainText('Brambleback Signet');
      await expect(hunts.getByRole('button', { name: 'Clear Greenfields', exact: true })).toBeDisabled();
      await page.getByRole('group', { name: 'Challenge categories' }).getByRole('button', { name: 'Trials', exact: true }).click();
      await expect(page.getByRole('region', { name: 'Promotion trials', exact: true })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Ashen King ladder', exact: true })).toHaveCount(0);
      await page.getByRole('group', { name: 'Challenge categories' }).getByRole('button', { name: 'Seasons', exact: true }).click();
      await expect(page.getByRole('region', { name: 'Seasons', exact: true })).toBeVisible();
      await nav.getByRole('button', { name: 'Menu', exact: true }).click();
      await page.getByRole('button', { name: 'Save management', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Save management', exact: true }).getByRole('button', { name: 'Back up save', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Close save management', exact: true }).click();
      await page.locator('.menu-encyclopedia').click();
      await page.getByRole('group', { name: 'Encyclopedia categories' }).getByRole('button', { name: 'Gear', exact: true }).click();
      await expect(page.locator('.encyclopedia-entry')).toHaveCount(8);
      await page.getByRole('button', { name: 'Next entries', exact: true }).click();
      await page.getByRole('searchbox').fill(duplicate.name);
      await expect(page.locator('.encyclopedia-entry')).toHaveCount(1);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Horizontal page overflow');
      assert(await page.locator('.encyclopedia-screen').evaluate(el => el.scrollWidth <= el.clientWidth), 'Horizontal menu overflow');
      if (width === 390) {
        await nav.getByRole('button', { name: 'Adventure', exact: true }).click();
        await page.getByRole('button', { name: /^Push Greenfields$/ }).click();
        await page.clock.runFor(content.snapshot.config.restMs + 32);
        await nav.getByRole('button', { name: 'Character', exact: true }).click();
        await page.getByRole('button', { name: 'Make Mage active', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Switch queued', exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Monk skill tree', exact: true }).click();
        await skills.getByRole('button', { name: 'Centered Strike', exact: true }).click();
        for (let seconds = 0; seconds < 60 && await page.locator('[data-role="Active"][data-class="monk"]').count(); seconds++)
          await page.clock.runFor(1000);
        await expect(page.locator('[data-role="Active"][data-class="mage"]')).toBeVisible();
        await expect(skills.getByRole('button', { name: 'Centered Strike', exact: true })).toHaveAttribute('aria-pressed', 'true');
      }
      report.cases.push({ width, height, gearScroll: scroll, gearActions: true, retainedSelectionAndFilters: true, classes: true, challengeCategories: true, saveMenu: true, encyclopedia: true });
      console.log(`PASS ${width}×${height}: gear ${scroll}px scroll, inventory/copy pages, equip, classes, challenges, save menu and encyclopedia.`);
    } finally { await context.close(); }
  }
  assert.deepEqual(report.errors, []);
} finally {
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close(); await server.httpServer.close();
}
