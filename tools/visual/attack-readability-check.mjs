// node --import tsx tools/visual/attack-readability-check.mjs
// Disposable browser fixtures. Review all eight visual keys and the real Pixi renderer.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { CONTENT } from '@emberbound/game-content';
import { bareAppearance, gearSkin } from '../../apps/mobile/src/art/gearSkins.ts';

const out = resolve('tools/smoke/out/attack-readability'); mkdirSync(out, { recursive: true });
const looks = ['warrior', 'monk', 'mage', 'ranger'].map(cls => {
  const look = bareAppearance(cls);
  for (const slot of ['weapon', 'head', 'chest', 'gloves', 'boots', 'ring']) {
    const item = CONTENT.items.find(i => i.classId === cls && i.slot === slot && i.rarity === 'common');
    look.slots[slot] = gearSkin(item, cls);
  }
  return look;
});
const server = await createServer({ root: resolve('apps/mobile'), logLevel: 'error', server: { host: '127.0.0.1', port: 0 },
  plugins: [{ name: 'attack-review', configureServer(s) { s.middlewares.use('/attack-review', (_req, res) => {
    res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Attack animation review</title><body></body>');
  }); } }] });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1320, height: 1040 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/attack-review`);
  const frames = await page.evaluate(async ({ looks, items }) => {
    const { refinedAtlas, loadRefinedHero, refinedReleasePoint } = await import('/src/art/refinedPixelArt.ts');
    const { gearSkin } = await import('/src/art/gearSkins.ts');
    const { heroAnimationAsset } = await import('/src/art/heroAnimation.ts');
    const { asset } = await import('/src/art/manifest.ts');
    await Promise.all(looks.map(l => loadRefinedHero(l.classId)));
    document.body.style.cssText = 'margin:24px;background:#101d23;color:#e9e4d3;font:14px system-ui';
    const result = { clipped: [], faceOverlap: [], duplicateFrames: [], weapons: 0, releasePoints: [] };
    const headline = document.createElement('h1'); headline.textContent = 'Wyrdholt · attack animation keys'; document.body.append(headline);
    for (const look of looks) {
      const a = heroAnimationAsset(asset(`characters/${look.classId}/attack`));
      const title = document.createElement('h2'); title.textContent = look.classId; document.body.append(title);
      const strip = refinedAtlas(a, look); strip.style.cssText = 'display:block;image-rendering:pixelated;background:#20333a'; document.body.append(strip);
      const legend = document.createElement('p'); legend.textContent = 'Gather → wind-up → release → contact hold → follow-through → settle → return → ready'; document.body.append(legend);
      const hashes = new Set();
      for (const f of a.frames) {
        const data = strip.getContext('2d').getImageData(f.x * 2, 0, a.width * 2, a.height * 2).data;
        let hash = 2166136261; for (const value of data) hash = Math.imul(hash ^ value, 16777619);
        if (hashes.has(hash)) result.duplicateFrames.push(look.classId); hashes.add(hash);
      }
      for (const item of items.filter(i => i.classId === look.classId && i.slot === 'weapon')) {
        result.weapons++;
        const dressed = { ...look, slots: { ...look.slots, weapon: gearSkin(item, look.classId) } };
        const atlas = refinedAtlas(a, dressed), weapon = refinedAtlas(a, dressed, 'weapon');
        for (const [index, f] of a.frames.entries()) {
          const width = a.width * 2, height = a.height * 2;
          const data = atlas.getContext('2d').getImageData(f.x * 2, 0, width, height).data;
          for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            if (x !== 0 && x !== width - 1 && y !== 0 && y !== height - 1) continue;
            if (data[(y * width + x) * 4 + 3]) result.clipped.push(`${item.id}/${index}`);
          }
          if (look.classId === 'mage') {
            const wd = weapon.getContext('2d').getImageData(f.x * 2, 0, width, height).data;
            // Eye/cheek area, inside the illustrated face in either body pose.
            for (let y = -44; y < -39; y += .5) for (let x = 2; x < 6; x += .5) {
              const px = Math.round((a.anchor.x + x) * 2), py = Math.round((a.anchor.y + y) * 2);
              if (wd[(py * width + px) * 4 + 3]) result.faceOverlap.push(`${item.id}/${index}`);
            }
          }
        }
      }
      const release = refinedReleasePoint(look); if (release) result.releasePoints.push({ classId: look.classId, release });
    }
    return result;
  }, { looks, items: CONTENT.items });
  await page.screenshot({ path: resolve(out, 'attack-keys.png'), fullPage: true });
  writeFileSync(resolve(out, 'frames.json'), JSON.stringify(frames, null, 2));
  frames.clipped = [...new Set(frames.clipped)]; frames.faceOverlap = [...new Set(frames.faceOverlap)];
  assert.deepEqual(frames.clipped, [], 'clipped attack art');
  assert.deepEqual(frames.faceOverlap, [], 'mage staff covers face');
  assert.deepEqual(frames.duplicateFrames, [], 'attack keys must differ');

  const movie = await browser.newPage({ viewport: { width: 960, height: 720 },
    recordVideo: { dir: out, size: { width: 960, height: 720 } } });
  movie.on('pageerror', e => errors.push(e.message));
  await movie.goto(`http://127.0.0.1:${server.httpServer.address().port}/attack-review`);
  const playback = await movie.evaluate(async looks => {
    const { CombatRenderer } = await import('/src/render/CombatRenderer.ts');
    const { loadRefinedHero } = await import('/src/art/refinedPixelArt.ts');
    await Promise.all(looks.map(l => loadRefinedHero(l.classId)));
    document.body.replaceChildren(); document.body.style.display = 'grid'; document.body.style.gridTemplateColumns = 'repeat(2, 1fr)';
    const results = [];
    for (const look of looks) {
      const host = document.createElement('div'); host.style.cssText = 'width:448px;height:320px;position:relative'; document.body.append(host);
      const renderer = await CombatRenderer.create(host); renderer.setHeroAppearance(look);
      renderer.renderPreview({ hero: look.classId, enemies: ['wolf'], pose: 'idle', effect: 'none', timeMs: 0 });
      await new Promise(resolve => setTimeout(resolve, 200));
      const seen = new Set();
      for (let t = 0; t <= 1100; t += 10) {
        // A fresh preview samples impact once; step the same actor across its full clip instead.
        if (t === 0) renderer.renderPreview({ hero: look.classId, enemies: ['wolf'], pose: 'attack', effect: 'none', timeMs: 0 });
        renderer.animate(10000 + t);
        const hero = renderer.actors.get('hero');
        if (hero.motion.pose === 'attack') seen.add(hero.tex.frames.findIndex(f => f.normal === hero.body.texture));
      }
      renderer.renderPreview({ hero: look.classId, enemies: ['wolf'], pose: 'attack', effect: 'none', timeMs: 0 });
      const release = renderer.actors.get('hero').motion.windupMs;
      renderer.animate(10000); renderer.animate(10000 + release); renderer.animate(10000 + release + 40);
      renderer.app.renderer.render(renderer.app.stage);
      results.push({ classId: look.classId, frames: [...seen], decodedBytes: renderer.sprites.decodedBytes });
      (window.attackRenderers ??= []).push(renderer);
    }
    return results;
  }, looks);
  await movie.screenshot({ path: resolve(out, 'combat-release.png'), fullPage: true });
  for (const p of playback) {
    assert.equal(p.frames.length, 8, `${p.classId}: missing playback keys`);
    assert(p.decodedBytes < 32 * 1024 * 1024, `${p.classId}: texture memory budget`);
  }
  assert.deepEqual(errors, []);
  await movie.evaluate(() => {
    const renderers = window.attackRenderers;
    const start = performance.now(); let cycle = -1;
    function tick(now) {
      const elapsed = now - start, current = Math.floor(elapsed / 1400), local = elapsed % 1400;
      if (current !== cycle) {
        cycle = current;
        for (const r of renderers) {
          r.renderPreview({ hero: r.heroAppearance.classId, enemies: ['wolf'], pose: 'attack', effect: 'none', timeMs: 0 });
          r.previewImpact = false;
        }
      }
      for (const r of renderers) {
        r.animate(10000 + local);
        const hero = r.actors.get('hero'), target = r.actors.get('preview-0');
        if (['mage', 'ranger'].includes(hero.attackName) && !r.previewImpact && local >= hero.motion.windupMs + 240) {
          r.previewImpact = true; r.attackImpact(hero, target, 10000 + local, false, 'basic');
        }
        r.app.renderer.render(r.app.stage);
      }
      if (elapsed < 4200) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
  await movie.waitForTimeout(4300);
  const video = movie.video(); await movie.close(); await video.saveAs(resolve(out, 'attack-preview.webm'));
  writeFileSync(resolve(out, 'report.json'), JSON.stringify({ frames, playback }, null, 2));
  console.log(`PASS: eight attack keys per class; ${frames.weapons} weapons checked for clipping; mage faces clear; real Pixi playback within budget.`);
} finally { await browser?.close(); await server.close(); }
