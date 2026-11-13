// node --import tsx tools/visual/gear-skins-check.mjs
// Real browser canvas checks and a review sheet; uses disposable fixtures only.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { CONTENT } from '@emberbound/game-content';
import { ContentIndex, createProfile, createInstance } from '@emberbound/game-core';
import { equippedAppearance, bareAppearance, gearSkin, HERO_CLASSES, GEAR_SLOTS } from '../../apps/mobile/src/art/gearSkins.ts';

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
  for (let mix = 0; mix < 8; mix++) {
    const look = bareAppearance(cls);
    for (const [offset, slot] of GEAR_SLOTS.entries()) {
      const choices = CONTENT.items.filter(i => i.classId === cls && i.slot === slot);
      look.slots[slot] = gearSkin(choices[(mix + offset * 2) % choices.length], cls);
    }
    looks.push({ label: `${cls} · mixed ${mix + 1}`, look });
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
    const { asset: sourceAsset } = await import('/src/art/manifest.ts');
    const { heroAnimationAsset } = await import('/src/art/heroAnimation.ts');
    const asset = id => heroAnimationAsset(sourceAsset(id));
    const { loadRefinedHero, REFINED_PIXEL_SCALE: R } = await import('/src/art/refinedPixelArt.ts');
    await Promise.all(['monk', 'warrior', 'mage', 'ranger'].map(loadRefinedHero));
    document.body.style.cssText = 'margin:20px;background:#101d23;color:#dfddc7;font:14px system-ui;display:grid;grid-template-columns:repeat(6,1fr);gap:12px';
    const hash = canvas => {
      let h = 2166136261;
      for (const b of canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data) h = Math.imul(h ^ b, 16777619);
      return h >>> 0;
    };
    const clipping = [], unchangedSlots = [], duplicates = [], iconDuplicates = [];
    const detached = [], neutralDuplicates = [], classDuplicates = [], nonPixelAlpha = [];
    let frames = 0, attachmentFrames = 0;
    for (const { label, look } of looks) {
      const id = `characters/${look.classId}`;
      const idle = gearAtlas(asset(id), look);
      if (hash(idle) !== hash(portraitAtlas(look.classId, look))) throw new Error(`Portrait differs from combat: ${label}`);
      const first = document.createElement('canvas'); first.width = asset(id).width * R; first.height = asset(id).height * R;
      first.getContext('2d').drawImage(idle, 0, 0);
      first.style.cssText = 'width:100%;image-rendering:pixelated;background:#182a30';
      const figure = document.createElement('div'); figure.textContent = label; figure.append(first); document.body.append(figure);
      for (const pose of ['idle', 'attack', 'hit', 'death', 'flash']) {
        const a = asset(pose === 'idle' ? id : `${id}/${pose}`), atlas = gearAtlas(a, look);
        const data = atlas.getContext('2d').getImageData(0, 0, atlas.width, atlas.height).data;
        for (const f of a.frames) {
          frames++;
          let edge = false;
          for (let y = 0; y < a.height * R; y++) for (let x = 0; x < a.width * R; x++) {
            if (x > 0 && x < a.width * R - 1 && y > 0 && y < a.height * R - 1) continue;
            if (data[((f.y * R + y) * atlas.width + f.x * R + x) * 4 + 3]) edge = true;
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
    const classIcons = new Map(), bodyAtlases = new Map();
    for (const cls of ['monk', 'mage', 'warrior', 'ranger']) for (const slot of slots) {
      const seen = new Map(), icons = new Map(), neutralIcons = new Map();
      const starter = looks.find(l => l.label === `${cls} · common`).look;
      for (const item of items.filter(i => i.classId === cls && i.slot === slot)) {
        const skin = gearSkin(item, cls);
        const look = { ...starter, slots: { ...starter.slots, [slot]: skin } };
        const h = hash(gearAtlas(asset(`characters/${cls}`), look));
        const ih = hash(gearIcon(skin));
        if (seen.has(h)) duplicates.push([item.id, seen.get(h)]); seen.set(h, item.id);
        if (icons.has(ih)) iconDuplicates.push([item.id, icons.get(ih)]); icons.set(ih, item.id);
        // Remove hue differences: named items must retain distinctive contours and shading details.
        const neutral = gearIcon(skin), nc = neutral.getContext('2d'), nd = nc.getImageData(0, 0, neutral.width, neutral.height);
        for (let n=0;n<nd.data.length;n+=4) {const value=Math.round(nd.data[n]*.299+nd.data[n+1]*.587+nd.data[n+2]*.114);nd.data[n]=nd.data[n+1]=nd.data[n+2]=value;}
        nc.putImageData(nd,0,0);const nh = hash(neutral);
        if (neutralIcons.has(nh)) neutralDuplicates.push([item.id, neutralIcons.get(nh)]);
        neutralIcons.set(nh, item.id);
        const familyKey = `${skin.family}/${nh}`;
        if (classIcons.has(familyKey)) classDuplicates.push([item.id, classIcons.get(familyKey)]);
        classIcons.set(familyKey, item.id);
        const icon = gearIcon(skin), rgba = icon.getContext('2d').getImageData(0, 0, icon.width, icon.height).data;
        if (rgba.some((n, i) => i % 4 === 3 && n !== 0 && n !== 255)) nonPixelAlpha.push(`${item.id}/icon`);
        // Inspect each connected equipment component against the posed anatomy.
        // Both layers are produced by the real renderer using identical joints.
        for (const pose of ['idle', 'attack', 'hit', 'death']) {
          const a = asset(`characters/${cls}${pose === 'idle' ? '' : '/' + pose}`);
          const gear = gearAtlas(a, look, slot), bodyKey=cls+'/'+pose;
          if(!bodyAtlases.has(bodyKey))bodyAtlases.set(bodyKey,gearAtlas(a,look,'body'));
          const body=bodyAtlases.get(bodyKey);
          const gd = gear.getContext('2d').getImageData(0, 0, gear.width, gear.height).data;
          const bd = body.getContext('2d').getImageData(0, 0, body.width, body.height).data;
          for (const [frameIndex, f] of a.frames.entries()) {
            attachmentFrames++;
            const fw=a.width*R,fh=a.height*R;
            const visited = new Set(), alpha = (data, x, y) => data[((f.y*R + y) * gear.width + f.x*R + x) * 4 + 3];
            for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
              if (!alpha(gd, x, y) || visited.has(y * fw + x)) continue;
              const queue = [[x, y]]; visited.add(y * fw + x);
              let touches = false;
              for (let n = 0; n < queue.length; n++) {
                const [px, py] = queue[n];
                if (alpha(gd, px, py) !== 255) nonPixelAlpha.push(`${item.id}/${pose}/${frameIndex}`);
                if (!px || !py || px === fw - 1 || py === fh - 1) clipping.push(`${item.id}/${pose}/${frameIndex}`);
                for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
                  const nx = px + dx, ny = py + dy, key = ny * fw + nx;
                  if (nx < 0 || ny < 0 || nx >= fw || ny >= fh) continue;
                  if (alpha(bd, nx, ny)) touches = true;
                  if (alpha(gd, nx, ny) && !visited.has(key)) { visited.add(key); queue.push([nx, ny]); }
                }
              }
              if (!touches) detached.push(`${item.id}/${pose}/${frameIndex}: ${queue.length}px at ${x},${y}`);
            }
          }
        }
      }
    }
    return { frames, attachmentFrames, clipping, unchangedSlots, duplicates, iconDuplicates, neutralDuplicates, classDuplicates, detached, nonPixelAlpha, looks: looks.length };
  }, { looks, items: CONTENT.items, slots: GEAR_SLOTS });
  await page.screenshot({ path: resolve(out, 'equipment-progression.png'), fullPage: true });
  const identity = await page.evaluate(async looks => {
    const { gearAtlas } = await import('/src/art/gearArt.ts');
    const { asset: sourceAsset } = await import('/src/art/manifest.ts');
    const { heroAnimationAsset } = await import('/src/art/heroAnimation.ts');
    const asset = id => heroAnimationAsset(sourceAsset(id));
    const { loadRefinedHero, REFINED_PIXEL_SCALE: R } = await import('/src/art/refinedPixelArt.ts');
    await Promise.all(['monk', 'warrior', 'mage', 'ranger'].map(loadRefinedHero));
    document.body.replaceChildren();
    document.body.style.gridTemplateColumns = 'repeat(4, 1fr)';
    const result = [];
    for (const row of ['Bare · idle', 'Silhouette', 'Bare · punch', 'Equipped · attack']) {
      for (const cls of ['monk', 'warrior', 'mage', 'ranger']) {
        const attack = row.includes('punch') || row.includes('attack');
        const look = looks.find(l => l.label === `${cls} · ${row.startsWith('Equipped') ? 'rare' : 'unequipped'}`).look;
        const a = asset(`characters/${cls}${attack ? '/attack' : ''}`), atlas = gearAtlas(a, look);
        const canvas = document.createElement('canvas'); canvas.width = 72; canvas.height = 64;
        const ctx = canvas.getContext('2d');
        const f = a.frames[attack ? 2 : 0];
        ctx.drawImage(atlas, f.x * R, f.y * R, a.width * R, a.height * R, 36 - a.anchor.x, 60 - a.anchor.y, a.width, a.height);
        if (row === 'Silhouette') {
          ctx.globalCompositeOperation = 'source-in'; ctx.fillStyle = '#ddd8c5'; ctx.fillRect(0, 0, 72, 64);
          const data = ctx.getImageData(0, 0, 72, 64).data;
          let signature = '', area = 0, top = 64, left = 72, right = 0;
          for (let y = 0; y < 64; y++) for (let x = 0; x < 72; x++) {
            const opaque = !!data[(y * 72 + x) * 4 + 3]; signature += opaque ? '1' : '0';
            if (opaque) { area++; top = Math.min(top, y); left = Math.min(left, x); right = Math.max(right, x); }
          }
          result.push({ classId: cls, signature, area, height: 60 - top, width: right - left + 1 });
        }
        canvas.style.cssText = 'display:block;width:100%;image-rendering:pixelated;background:#182a30';
        const figure = document.createElement('div'); figure.textContent = `${cls} · ${row}`;
        figure.append(canvas); document.body.append(figure);
      }
    }
    return result;
  }, looks);
  await page.screenshot({ path: resolve(out, 'class-identity.png'), fullPage: true });
  assert.equal(new Set(identity.map(i => i.signature)).size, 4, 'Classes must differ in silhouette, not just palette');
  assert.equal(identity.find(i => i.classId === 'mage').height, Math.max(...identity.map(i => i.height)), 'Mage should remain the tallest base body');
  report.bodies = identity.map(({ signature, ...body }) => body);
  writeFileSync(resolve(out, 'report.json'), JSON.stringify({ ...report, errors }, null, 2));
  assert.deepEqual(errors, []); assert.deepEqual(report.clipping, []);
  assert.deepEqual(report.unchangedSlots, []); assert.deepEqual(report.duplicates, []); assert.deepEqual(report.iconDuplicates, []);
  assert.deepEqual(report.neutralDuplicates, []); assert.deepEqual(report.classDuplicates, []);
  assert.deepEqual(report.detached, []); assert.deepEqual(report.nonPixelAlpha, []);
  const equips = [];
  for (const cls of HERO_CLASSES) {
    console.log(`Checking ${cls}: empty start, queued crown, reload`);
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
      // Keep the fixture in continuous combat while navigating the equipment UI;
      // a completed Push can otherwise cover the navigation with its result modal.
      session.dispatch({ type: 'startFarm', zoneId: 'greenfields' });
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
          head: window.__emberRenderer.heroAppearance.slots.head?.id ?? null });
      }, 10);
    });
    // Observe a fight boundary and activate the real UI in the same browser task,
    // so CPU contention cannot settle a short fight between observation and click.
    await app.evaluate(async () => {
      const { session } = await import('/src/game/session.ts');
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`No fresh fight: ${JSON.stringify(session.getSnapshot().profile.adventure)}`)), 45000);
        const check = () => {
          const p = session.getSnapshot().profile, run = p.adventure.run;
          if (p.adventure.activity === 'idle' || run?.phase !== 'fight' || run.elapsedMs >= 400) { requestAnimationFrame(check); return; }
          clearTimeout(timer);
          document.querySelector('.equip-cta').click();
          const queued = !!session.getSnapshot().profile.pending?.equipment?.head;
          window.skinSamples.push({ queued, head: window.__emberRenderer.heroAppearance.slots.head?.id ?? null });
          if (!queued) reject(new Error(`UI equip did not queue at ${run.phase}/${run.elapsedMs}`));
          else resolve();
        }; check();
      });
    });
    await app.waitForFunction(id => document.querySelector('.loadout-hero [data-appearance]')?.dataset.appearance.includes(id), baseId);
    await app.getByRole('navigation').getByRole('button', { name: 'Adventure', exact: true }).click();
    await app.waitForFunction(id => window.__emberRenderer.heroAppearance.slots.head?.id.endsWith(id), baseId);
    await app.waitForFunction(() => window.__emberRenderer.actors.get('hero')?.tex.normal.source.resolution === 2);
    const after = await app.evaluate(() => {
      clearInterval(window.skinSampleTimer);
      return { look: window.__emberRenderer.heroAppearance, samples: window.skinSamples,
        header: document.querySelector('.header [data-appearance]').dataset.appearance };
    });
    assert.equal(after.header, after.look.key);
    for (const slot of GEAR_SLOTS.filter(s => s !== 'head')) assert.deepEqual(after.look.slots[slot], before.slots[slot]);
    const queued = after.samples.filter(s => s.queued);
    assert(queued.length > 0, `${cls}: did not exercise queued equipment`);
    assert(queued.every(s => s.head === (before.slots.head?.id ?? null)), `${cls}: queued head appeared early`);
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
