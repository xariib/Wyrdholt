// node --import tsx tools/visual/gear-skins-check.mjs
// Real browser canvas checks and a review sheet; uses disposable fixtures only.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { CONTENT } from '@emberbound/game-content';
import { ContentIndex, createProfile, createInstance } from '@emberbound/game-core';
import { equippedAppearance, bareAppearance, HERO_CLASSES, GEAR_SLOTS } from '../../apps/mobile/src/art/gearSkins.ts';

const out = resolve('tools/smoke/out/gear-skins'); mkdirSync(out, { recursive: true });
const content = new ContentIndex(CONTENT), looks = [];
for (const cls of HERO_CLASSES) {
  looks.push({ label: `${cls} · unequipped`, look: bareAppearance(cls) });
  for (const rarity of ['common', 'uncommon', 'rare', 'epic', 'legendary']) {
    const p = createProfile(content, { name: 'Skins', activeClassId: cls, alternateClassId: cls === 'mage' ? 'monk' : 'mage', masterSeed: 17, nowWallMs: 0 });
    for (const slot of GEAR_SLOTS) {
      const item = CONTENT.items.find(i => i.classId === cls && i.slot === slot && i.rarity === rarity);
      assert(item); p.equipment[slot] = createInstance(p, item.id, { isNew: false }).id;
    }
    looks.push({ label: `${cls} · ${rarity}`, look: equippedAppearance(p, content) });
  }
}
const server = await createServer({ root: resolve('apps/mobile'), logLevel: 'error', server: { host: '127.0.0.1', port: 0 },
  plugins: [{ name: 'gear-review-fixture', configureServer(s) { s.middlewares.use('/gear-review', (_req, res) => {
    res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Gear skin review</title><body></body>');
  }); } }] });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 1040 }, deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/gear-review`);
  const report = await page.evaluate(async ({ looks, items, slots }) => {
    const { gearAtlas, portraitAtlas, gearIcon } = await import('/src/art/gearArt.ts');
    const { gearSkin } = await import('/src/art/gearSkins.ts');
    const { asset } = await import('/src/art/manifest.ts');
    document.body.style.cssText = 'margin:20px;background:#101d23;color:#dfddc7;font:14px system-ui;display:grid;grid-template-columns:repeat(6,1fr);gap:12px';
    const hash = canvas => {
      let h = 2166136261;
      for (const b of canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data) h = Math.imul(h ^ b, 16777619);
      return h >>> 0;
    };
    const clipping = [], unchangedSlots = [], duplicates = [], iconDuplicates = [];
    let frames = 0;
    for (const { label, look } of looks) {
      const id = `characters/${look.classId}`;
      const idle = gearAtlas(asset(id), look);
      if (hash(idle) !== hash(portraitAtlas(look.classId, look))) throw new Error(`Portrait differs from combat: ${label}`);
      const first = document.createElement('canvas'); first.width = asset(id).width; first.height = asset(id).height;
      first.getContext('2d').drawImage(idle, 0, 0);
      first.style.cssText = 'width:100%;image-rendering:pixelated;background:#182a30';
      const figure = document.createElement('div'); figure.textContent = label; figure.append(first); document.body.append(figure);
      for (const pose of ['idle', 'attack', 'hit', 'death', 'flash']) {
        const a = asset(pose === 'idle' ? id : `${id}/${pose}`), atlas = gearAtlas(a, look);
        const data = atlas.getContext('2d').getImageData(0, 0, atlas.width, atlas.height).data;
        for (const f of a.frames) {
          frames++;
          let edge = false;
          for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
            if (x > 0 && x < a.width - 1 && y > 0 && y < a.height - 1) continue;
            if (data[((f.y + y) * atlas.width + f.x + x) * 4 + 3]) edge = true;
          }
          if (edge) clipping.push(`${label}/${pose}/${a.frames.indexOf(f)}`);
        }
        for (const slot of slots) {
          if (!look.slots[slot]) continue;
          const removed = { ...look, slots: { ...look.slots } }; delete removed.slots[slot];
          if (pose !== 'flash' && hash(atlas) === hash(gearAtlas(a, removed))) unchangedSlots.push(`${label}/${pose}/${slot}`);
        }
      }
    }
    // Each named item must change actual pixels, not only a data attribute or rarity border.
    for (const cls of ['monk', 'mage', 'warrior', 'ranger']) for (const slot of slots) {
      const seen = new Map(), icons = new Map();
      const starter = looks.find(l => l.label === `${cls} · common`).look;
      for (const item of items.filter(i => i.classId === cls && i.slot === slot)) {
        const skin = gearSkin(item, cls);
        const look = { ...starter, slots: { ...starter.slots, [slot]: skin } };
        const h = hash(gearAtlas(asset(`characters/${cls}`), look));
        const ih = hash(gearIcon(skin));
        if (seen.has(h)) duplicates.push([item.id, seen.get(h)]); seen.set(h, item.id);
        if (icons.has(ih)) iconDuplicates.push([item.id, icons.get(ih)]); icons.set(ih, item.id);
      }
    }
    return { frames, clipping, unchangedSlots, duplicates, iconDuplicates, looks: looks.length };
  }, { looks, items: CONTENT.items, slots: GEAR_SLOTS });
  await page.screenshot({ path: resolve(out, 'equipment-progression.png'), fullPage: true });
  writeFileSync(resolve(out, 'report.json'), JSON.stringify({ ...report, errors }, null, 2));
  assert.deepEqual(errors, []); assert.deepEqual(report.clipping, []);
  assert.deepEqual(report.unchangedSlots, []); assert.deepEqual(report.duplicates, []); assert.deepEqual(report.iconDuplicates, []);
  const equips = [];
  for (const cls of HERO_CLASSES) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const app = await context.newPage(), appErrors = []; app.on('pageerror', e => appErrors.push(e.message));
    await app.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
    await app.locator('.class-option').filter({ hasText: new RegExp(cls, 'i') }).click();
    await app.getByText('Begin in Greenfields', { exact: true }).click();
    await app.waitForFunction(() => window.__emberRenderer?.heroAppearance);
    const before = await app.evaluate(() => window.__emberRenderer.heroAppearance);
    const baseId = `cinder_crown_${cls}`;
    await app.evaluate(async baseId => {
      const { session } = await import('/src/game/session.ts');
      const granted = session.dispatch({ type: 'devGrant', baseIds: [baseId] });
      if (!granted.ok) throw new Error(granted.error);
    }, baseId);
    await app.getByRole('navigation').getByRole('button', { name: 'Gear', exact: true }).click();
    await app.locator('[data-slot="head"]').click();
    await app.locator('.slot-inventory .list-item').filter({ hasText: 'Cinder Crown' }).click();
    await app.getByRole('button', { name: /^Equip .*Cinder Crown$/ }).scrollIntoViewIfNeeded();
    await app.evaluate(async () => {
      const { session } = await import('/src/game/session.ts');
      window.skinSamples = [];
      window.skinSampleTimer = setInterval(() => {
        const p = session.getSnapshot().profile;
        window.skinSamples.push({ queued: !!p.pending?.equipment?.head,
          head: window.__emberRenderer.heroAppearance.slots.head.id });
      }, 10);
    });
    // Observe a fight boundary and activate the real UI in the same browser task,
    // so CPU contention cannot settle a short fight between observation and click.
    await app.evaluate(async () => {
      const { session } = await import('/src/game/session.ts');
      await new Promise((resolve, reject) => {
        const check = () => {
          const p = session.getSnapshot().profile, run = p.adventure.run;
          if (p.adventure.activity === 'idle' || run?.phase !== 'fight' || run.elapsedMs >= 400) { requestAnimationFrame(check); return; }
          document.querySelector('.equip-cta').click();
          const queued = !!session.getSnapshot().profile.pending?.equipment?.head;
          window.skinSamples.push({ queued, head: window.__emberRenderer.heroAppearance.slots.head.id });
          if (!queued) reject(new Error(`UI equip did not queue at ${run.phase}/${run.elapsedMs}`));
          else resolve();
        }; check();
      });
    });
    await app.waitForFunction(id => document.querySelector('.loadout-hero [data-appearance]')?.dataset.appearance.includes(id), baseId);
    await app.getByRole('navigation').getByRole('button', { name: 'Adventure', exact: true }).click();
    await app.waitForFunction(id => window.__emberRenderer.heroAppearance.slots.head?.id.endsWith(id), baseId);
    const after = await app.evaluate(() => {
      clearInterval(window.skinSampleTimer);
      return { look: window.__emberRenderer.heroAppearance, samples: window.skinSamples,
        header: document.querySelector('.header [data-appearance]').dataset.appearance };
    });
    assert.equal(after.header, after.look.key);
    for (const slot of GEAR_SLOTS.filter(s => s !== 'head')) assert.deepEqual(after.look.slots[slot], before.slots[slot]);
    const queued = after.samples.filter(s => s.queued);
    assert(queued.length > 0, `${cls}: did not exercise queued equipment`);
    assert(queued.every(s => s.head === before.slots.head.id), `${cls}: queued head appeared early`);
    await app.locator('.combat-canvas').screenshot({ path: resolve(out, `${cls}-equipped-combat.png`) });
    await app.getByRole('navigation').getByRole('button', { name: 'Gear', exact: true }).click();
    await app.screenshot({ path: resolve(out, `${cls}-mixed-gear.png`), animations: 'disabled' });
    await app.evaluate(async () => {
      const { session } = await import('/src/game/session.ts');
      const saved = await session.saveNow();
      if (saved.status !== 'saved') throw new Error(`Fixture save failed: ${saved.status}`);
    });
    await app.reload();
    await app.waitForFunction(key => window.__emberRenderer?.heroAppearance?.key === key, after.look.key);
    assert.deepEqual(appErrors, []);
    equips.push({ classId: cls, queuedSamples: queued.length, skinAfterReload: after.look.key });
    await context.close();
  }
  writeFileSync(resolve(out, 'equip-report.json'), JSON.stringify(equips, null, 2));
  console.log(`PASS: ${report.looks} outfits, ${report.frames} frames; every slot changes pixels, unique item skins/icons, portraits match combat, no clipping.`);
  console.log('PASS: four-class equip UI, queued skins wait for settlement, mixed outfits, matching header/combat/portraits, reload persistence.');
} finally { await browser?.close(); await server.close(); }
