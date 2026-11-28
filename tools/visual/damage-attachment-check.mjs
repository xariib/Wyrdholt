// Built-app presentation regression: incoming damage while a bare-handed hero is away from home.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { preview } from 'vite';
import { chromium } from 'playwright';

const out = resolve('tools/smoke/out/damage-attachment');
mkdirSync(out, { recursive: true });
const server = await preview({ root: resolve('apps/mobile'), configFile: false,
  preview: { host: '127.0.0.1', port: 0 } });
let browser;
const report = [];
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const cls of ['monk', 'mage', 'warrior', 'ranger']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
    await page.locator('.class-option').filter({ hasText: new RegExp(cls, 'i') }).click();
    await page.getByText('Begin in Greenfields', { exact: true }).click();
    await page.waitForFunction(() => window.__emberRenderer?.actors.get('hero')?.tex.asset);
    await page.evaluate(cls => {
      const r = window.__emberRenderer;
      r.visible = false;
      r.renderPreview({ hero: cls, enemies: ['wolf'], pose: 'attack', effect: '', timeMs: 330 });
    }, cls);
    await page.waitForFunction(cls => {
      const bank = window.__emberRenderer.sprites;
      return bank.optional(`characters/${cls}/attack`)?.frames.length === 8
        && bank.optional('enemies/wolf/hit')?.asset;
    }, cls);
    const result = await page.evaluate(() => {
      const r = window.__emberRenderer, hero = r.actors.get('hero'), enemy = r.actors.get('preview-0');
      const start = 20000;
      hero.motion.scheduledAttack(start, 350);
      r.animate(start + 330);
      const hp = hero.hp100 - 100;
      r.apply({ type: 'hit', src: enemy.id, tgt: hero.id, hp, amt: 100, eff: 100, via: 'basic' }, start + 340, false);
      r.animate(start + 350);
      const result = { awayFromHome: hero.root.x - hero.baseX, pose: hero.motion.pose,
        cycleMs: hero.motion.attackTiming.reduce((sum, ms) => sum + ms, 0),
        hpApplied: hero.hp100 === hp, flashMatches: hero.flash.texture === hero.body.texture,
        flashAlpha: hero.flash.alpha, anchorMatches: hero.flash.anchor.equals(hero.body.anchor),
        scaleMatches: hero.flash.scale.equals(hero.body.scale) };
      // The procedural impact must be at the moving torso, far from the home slot.
      const effect = r.effects.at(-1), bounds = effect.node.getLocalBounds();
      result.impactCenter = bounds.x + bounds.width / 2;
      result.heroX = hero.root.x;
      r.floatDamage(hero, 1800, 500, '#f06055', start + 350, true);
      r.animate(start + 350);
      const labels = r.floaters.filter(f => f.actor === hero).map(f => f.node.getBounds());
      result.labelsSeparated = labels.length >= 3 && labels.every((bounds, index) =>
        index === 0 || labels[index - 1].maxY < bounds.minY);
      r.app.renderer.render(r.app.stage);
      // Leave the real WebGL frame on screen for the screenshot.
      return result;
    });
    assert(result.awayFromHome > 15, `${cls}: fixture never left home`);
    assert.equal(result.pose, 'attack');
    assert.equal(result.cycleMs, 960);
    assert(result.hpApplied && result.flashMatches && result.anchorMatches && result.scaleMatches);
    assert(result.flashAlpha > 0, `${cls}: no immediate damage flash`);
    assert(result.labelsSeparated, `${cls}: stacked ward and critical damage labels overlap`);
    assert(Math.abs(result.impactCenter - result.heroX) < 15, `${cls}: detached damage effect`);
    await page.locator('.combat-canvas').screenshot({ path: resolve(out, `${cls}-moving-hit.png`) });
    assert.deepEqual(errors, []);
    report.push({ classId: cls, ...result });
    console.log(`PASS ${cls}: readable fast-hit cycle, immediate pose-matched flash and attached incoming impact.`);
    await page.close();
  }
} finally {
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close(); await server.close();
}
