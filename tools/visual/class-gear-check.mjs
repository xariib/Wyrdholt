// Disposable browser characters: mixed-class ownership, real gear views and class switches.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { CONTENT } from '@emberbound/game-content';

const out = resolve('tools/smoke/out/class-gear'); mkdirSync(out, { recursive: true });
const classes = ['warrior', 'mage', 'ranger', 'monk'], slots = ['weapon', 'head', 'chest', 'gloves', 'boots', 'ring'];
const requested = process.argv.slice(2);
assert(requested.every(cls => classes.includes(cls)), 'Unknown class argument');
const items = classes.flatMap(cls => slots.map(slot => CONTENT.items.find(i => i.classId === cls && i.slot === slot && i.rarity === 'common')));
const server = await createServer({ root: resolve('apps/mobile'), logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const report = [];
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const cls of requested.length ? requested : classes) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
    await page.locator('.class-option').filter({ hasText: new RegExp(cls, 'i') }).click();
    await page.getByText('Begin in Greenfields', { exact: true }).click();
    await page.waitForFunction(() => window.__emberRenderer?.heroAppearance);
    const granted = await page.evaluate(async baseIds => {
      const { session } = await import('/src/game/session.ts');
      const result = session.dispatch({ type: 'devGrant', baseIds });
      if (!result.ok) throw new Error(result.error);
      const p = session.getSnapshot().profile;
      return { ids: p.inventory.instances.map(i => i.id), alternate: p.character.alternateClassId };
    }, items.flatMap(i => [i.id, i.id]));

    const checkVisibleSkins = async (locator, active) => {
      const ids = await locator.locator('[data-gear-skin]').evaluateAll(nodes => nodes.map(n => n.dataset.gearSkin));
      assert(ids.length > 0, `${active}: expected visible gear`);
      assert(ids.every(id => CONTENT.items.find(i => i.id === id)?.classId === active), `${active}: foreign gear ${ids}`);
      return ids;
    };
    const checkGear = async active => {
      await page.getByRole('navigation').getByRole('button', { name: 'Gear', exact: true }).click();
      const expectedCount = await page.evaluate(async () => {
        const { session } = await import('/src/game/session.ts');
        const p = session.getSnapshot().profile;
        return p.inventory.instances.filter(i => session.content.item(i.baseId).classId === p.character.activeClassId).length;
      });
      assert((await page.locator('.inventory-entry').innerText()).includes(`${expectedCount} copies`));
      await page.locator('.inventory-entry').click();
      const ids = await checkVisibleSkins(page.getByRole('dialog'), active);
      await page.screenshot({ path: resolve(out, `${cls}-${active}-inventory.png`), animations: 'disabled' });
      await page.getByRole('button', { name: 'Close inventory', exact: true }).click();
      for (const slot of slots) {
        await page.locator(`[data-slot="${slot}"]`).click();
        await checkVisibleSkins(page.locator('.slot-inventory'), active);
        await page.getByRole('button', { name: 'Close equipment', exact: true }).click();
      }
      await page.getByRole('button', { name: 'Forge', exact: true }).click();
      for (const slot of slots) {
        await page.getByLabel('Forge slot', { exact: true }).selectOption(slot);
        await checkVisibleSkins(page.locator('.forge-items'), active);
      }
      await page.getByRole('button', { name: 'Close Forge', exact: true }).click();
      await page.getByRole('navigation').getByRole('button', { name: 'Menu', exact: true }).click();
      await page.locator('.menu-encyclopedia').click();
      await page.getByRole('group', { name: 'Encyclopedia categories' }).getByRole('button', { name: 'Gear', exact: true }).click();
      await checkVisibleSkins(page.locator('.encyclopedia-screen'), active);
      return ids.length;
    };
    const before = await checkGear(cls);
    await page.getByRole('navigation').getByRole('button', { name: 'Character', exact: true }).click();
    await page.getByRole('button', { name: /^Make .* active$/ }).click();
    await page.waitForFunction(async active => {
      const { session } = await import('/src/game/session.ts');
      return session.getSnapshot().profile.character.activeClassId === active;
    }, granted.alternate);
    await page.waitForFunction(active => document.querySelector('.header [data-appearance]')?.dataset.appearance.startsWith(`${active}:`), granted.alternate);
    const after = await checkGear(granted.alternate);
    const saved = await page.evaluate(async ids => {
      const { session } = await import('/src/game/session.ts');
      const p = session.getSnapshot().profile;
      if (!ids.every(id => p.inventory.instances.some(i => i.id === id))) throw new Error('Class filtering lost owned gear');
      return (await session.saveNow()).status;
    }, granted.ids);
    assert.equal(saved, 'saved');
    await page.reload();
    await page.waitForFunction(active => window.__emberRenderer?.heroAppearance?.classId === active, granted.alternate);
    await checkGear(granted.alternate);
    assert.deepEqual(errors, []);
    report.push({ classId: cls, switchedTo: granted.alternate, before, after, preservedCopies: granted.ids.length, reload: true });
    console.log(`PASS ${cls}: class-only inventory, six slots, Forge, counts, switch to ${granted.alternate}, preserved ownership and reload.`);
    await context.close();
  }
} finally {
  writeFileSync(resolve(out, requested.length ? `report-${requested.join('-')}.json` : 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close(); await server.close();
}
