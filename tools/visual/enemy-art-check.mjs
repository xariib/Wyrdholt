// node --import tsx tools/visual/enemy-art-check.mjs
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const out = resolve('tools/smoke/out/enemy-art'); mkdirSync(out, { recursive: true });
const web = await createServer({ root: resolve('apps/mobile'), logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
await web.listen(); let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${web.httpServer.address().port}`);
  const pixels = await page.evaluate(async () => {
    const { ENEMY_DESIGNS, refinedEnemyAssets } = await import('/src/art/refinedEnemies.ts');
    const { TextureBank } = await import('/src/render/textures.ts');
    const { ART_BUDGET } = await import('/src/art/types.ts');
    const seen = new Set(), cases = [];
    for (const design of ENEMY_DESIGNS) {
      const assets = refinedEnemyAssets.filter(a => a.id === `enemies/${design.name}` || a.id.startsWith(`enemies/${design.name}/`));
      const image = new Image(); image.src = `/${assets[0].file}`; await image.decode();
      const c = document.createElement('canvas'); c.width = image.width; c.height = image.height;
      const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0);
      const hashes = {};
      for (const a of assets) for (const [i, f] of a.frames.entries()) {
        const d = ctx.getImageData(f.x, f.y, a.width, a.height).data;
        let count = 0, hash = 2166136261;
        for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
          const at = (y * a.width + x) * 4, alpha = d[at + 3];
          if (alpha !== 0 && alpha !== 255) throw Error(`Nonpixel alpha: ${a.id}/${i}`);
          if (alpha) {
            count++;
            if (x < 2 || y < 2 || x >= a.width - 2 || y >= a.height - 2) throw Error(`Clipped art: ${a.id}/${i}`);
          }
          for (let k = 0; k < 4; k++) hash = Math.imul(hash ^ d[at + k], 16777619);
        }
        if (count < 100) throw Error(`Empty art: ${a.id}/${i}`);
        hashes[`${a.id}/${i}`] = hash >>> 0; cases.push(`${a.id}/${i}`);
      }
      const idle = hashes[`enemies/${design.name}/0`], strike = hashes[`enemies/${design.name}/attack/1`];
      if (idle === strike || seen.has(idle)) throw Error(`Duplicate art: ${design.name}`); seen.add(idle);
      const bank = new TextureBank(() => {});
      for (const a of assets) bank.optional(a.id);
      const deadline = performance.now() + 10000;
      while (!assets.every(a => bank.optional(a.id)?.asset)) {
        if (performance.now() > deadline) throw Error(`Texture timeout: ${design.name}`);
        await new Promise(r => setTimeout(r, 10));
      }
      const loaded = assets.map(a => bank.optional(a.id));
      if (new Set(loaded.flatMap(t => t.frames.map(f => f.normal.source))).size !== 1) throw Error('Pose atlases not shared');
      if (loaded[0].normal.source.resolution !== 2 || loaded[0].width !== assets[0].width / 2) throw Error('Enemy grid differs from heroes');
      if (bank.decodedBytes > ART_BUDGET.maxDecodedBytes) throw Error('Texture budget exceeded');
      bank.dispose(); if (bank.decodedBytes !== 0) throw Error('Disposed bank retains bytes');
    }
    return { frames: cases.length, distinctEnemies: seen.size };
  });
  await page.getByText('Begin in Greenfields', { exact: true }).click();
  await page.waitForFunction(() => window.__emberRenderer?.actors.get('hero')?.tex.asset);
  await page.evaluate(() => { window.__emberRenderer.onFrame = () => {}; });
  const names = await page.evaluate(async () => (await import('/src/art/refinedEnemies.ts')).ENEMY_DESIGNS.map(d => d.name));
  const compositions = [];
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    for (const count of [1, 2, 3]) {
    for (let index = 0; index < names.length; index++) {
      const hero = ['monk', 'warrior', 'mage', 'ranger'][index % 4];
      const enemies = [names[index], names[(index + 1) % names.length], names[(index + 2) % names.length]].slice(0, count);
      const scene = { hero, enemies, pose: 'idle', effect: 'none', timeMs: 200 };
      await page.evaluate(scene => window.__emberRenderer.renderPreview(scene), scene);
      await page.waitForFunction(() => [...window.__emberRenderer.actors.values()].every(a => a.tex.asset));
      await page.waitForFunction(() => [...window.__emberRenderer.actors.values()].every(a => ['attack', 'hit', 'death', 'flash'].every(p => window.__emberRenderer.sprites.optional(`${a.isHero ? 'characters' : 'enemies'}/${a.spriteName}/${p}`)?.asset)));
      for (const pose of ['idle', 'attack', 'hit', 'death']) {
        const state = await page.evaluate(({ scene, pose }) => {
          const r = window.__emberRenderer; r.renderPreview(scene);
          const now = 10200;
          for (const a of r.actors.values()) if (!a.isHero) {
            if (pose === 'attack') { a.motion.scheduledAttack(now - 180, 1000); a.targetId = 'hero'; }
            if (pose === 'hit') a.motion.hit(now - 60, false);
            if (pose === 'death') { a.motion.death(now - 300); a.alive = false; }
          }
          r.animate(now); r.app.renderer.render(r.app.stage);
          return { ...r.presentationSnapshot(), memory: r.info().artDecodedBytes };
        }, { scene, pose });
        for (const a of state.actors) {
          assert(a.production, `${a.name}: legacy art`); assert.deepEqual(a.scale, [1, 1]);
          assert(a.left >= 0 && a.right <= state.width, `${width}/${a.name}/${pose}: horizontal clipping`);
          assert(a.top >= 0 && a.top + a.frame[1] <= state.height, `${width}/${a.name}/${pose}: vertical clipping`);
          assert.equal(a.barY, state.ground + 8, `${width}/${a.name}/${pose}: health bar left its footer`);
          assert(a.barY + 6 <= state.height, `${width}/${a.name}: clipped HUD`);
          assert(a.barX - a.barWidth / 2 >= 0 && a.barX + a.barWidth / 2 <= state.width, `${width}/${a.name}: clipped health bar`);
          if (a.id !== 'hero') assert.equal(a.world[1], state.ground, `${width}/${a.name}/${pose}: floating enemy`);
        }
        for (const [i, a] of state.actors.entries()) for (const b of state.actors.slice(i + 1)) {
          assert(Math.abs(a.barX - b.barX) >= (a.barWidth + b.barWidth) / 2 + 2, `${width}/${count}/${a.name}/${b.name}: overlapping health bars`);
        }
        assert(state.memory <= 32 * 1024 * 1024);
        compositions.push({ width, hero, enemies, pose, decodedBytes: state.memory });
      }
      if (width === 390 && count === 3 && [0, 6, 11, 14].includes(index)) {
        await page.evaluate(scene => window.__emberRenderer.renderPreview(scene), scene);
        await page.locator('.combat-canvas').screenshot({ path: resolve(out, `combat-${index}.png`) });
      }
    }
    }
  }
  assert.deepEqual(errors, []);
  writeFileSync(resolve(out, 'report.json'), JSON.stringify({ pixels, compositions }, null, 2));
  console.log(`PASS: ${pixels.distinctEnemies} distinct enemies, ${pixels.frames} pixel frames, ${compositions.length} native-scale combat compositions; shared atlases and disposal verified.`);
} finally { await browser?.close(); await web.close(); }
