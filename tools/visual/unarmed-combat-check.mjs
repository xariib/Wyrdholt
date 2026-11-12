// node --import tsx tools/visual/unarmed-combat-check.mjs
// Built-app fixtures: empty weapon -> queued equip -> weapon-specific attack -> reload.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { preview } from 'vite';
import { chromium } from 'playwright';
import { CONTENT } from '@emberbound/game-content';
import { ContentIndex, createInstance, createProfile, serializeSave, startRun } from '@emberbound/game-core';

const out = resolve('tools/smoke/out/unarmed-combat'); mkdirSync(out, { recursive: true });
const content = new ContentIndex(CONTENT), report = [];
const server = await preview({ root: resolve('apps/mobile'), configFile: false, preview: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const cls of ['monk', 'mage', 'warrior', 'ranger']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
    await page.locator('.class-option').first().waitFor();
    const p = createProfile(content, { name: 'Unarmed', activeClassId: cls,
      alternateClassId: cls === 'mage' ? 'monk' : 'mage', masterSeed: 71, nowWallMs: Date.now() });
    assert.deepEqual(p.equipment, {}); assert.deepEqual(p.inventory.instances, []);
    const weapon = CONTENT.items.find(i => i.classId === cls && i.slot === 'weapon' && i.rarity === 'common');
    // Earned loot stays in inventory until the player explicitly equips it.
    createInstance(p, weapon.id, { isNew: true, provenance: { source: 'test-reward' } });
    startRun(p, content, 'greenfields', 'trail', 0);
    await page.evaluate(async raw => {
      const db = await new Promise((ok, fail) => {
        const req = indexedDB.open('Disc', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('FileStorage', { keyPath: 'path' }).createIndex('by_folder', 'folder');
        req.onsuccess = () => ok(req.result); req.onerror = () => fail(req.error);
      });
      await new Promise((ok, fail) => {
        const tx = db.transaction('FileStorage', 'readwrite');
        tx.objectStore('FileStorage').put({ path: '/DATA/saves/profile.json', folder: '/DATA/saves', type: 'file', content: raw, size: raw.length, ctime: 1, mtime: 1 });
        tx.oncomplete = ok; tx.onerror = () => fail(tx.error);
      }); db.close();
    }, serializeSave(p, Date.now()));
    await page.reload();
    await page.waitForFunction(() => window.__emberRenderer?.actors.get('hero')?.attackName === 'unarmed');
    await page.evaluate(() => {
      const r = window.__emberRenderer;
      const probe = window.unarmedProbe = { hits: [], bursts: [], maxApproach: 0, hudMoved: false, clipped: false, samples: [] };
      let lastActor, generation = 0;
      const impact = r.attackImpact.bind(r);
      r.attackImpact = (src, target, now, crit, via) => {
        if (src.isHero && via === 'basic') probe.hits.push({ mode: src.attackName, now });
        return impact(src, target, now, crit, via);
      };
      const burst = r.artBurst.bind(r);
      r.artBurst = (name, ...args) => { probe.bursts.push({ mode: r.actors.get('hero')?.attackName, name }); return burst(name, ...args); };
      const animate = r.animate.bind(r);
      r.animate = now => {
        animate(now);
        const actor = r.actors.get('hero');
        if (actor?.attackName === 'unarmed') {
          if (actor !== lastActor) { generation++; lastActor = actor; }
          if (probe.samples.length < 2000) probe.samples.push({ now, generation, serial: actor.motion.attackSerial,
            pose: actor.motion.pose, frame: actor.tex.frames.findIndex(f => f.normal === actor.body.texture),
            x: actor.root.x - actor.baseX, timing: [...actor.motion.attackTiming] });
          probe.maxApproach = Math.max(probe.maxApproach, actor.root.x - actor.baseX);
          probe.hudMoved ||= actor.hud.x !== actor.baseX;
          const left = actor.root.x - actor.body.anchor.x * actor.body.texture.width;
          probe.clipped ||= left < 0 || left + actor.body.texture.width > r.W;
        }
      };
    });
    await page.waitForFunction(() => window.unarmedProbe.hits.filter(h => h.mode === 'unarmed').length >= 2);
    await page.locator('.combat-canvas').screenshot({ path: resolve(out, `${cls}-unarmed.png`) });
    await page.getByRole('navigation').getByRole('button', { name: 'Gear', exact: true }).click();
    await page.locator('[data-slot="weapon"]').click();
    await page.locator('.slot-inventory .list-item').first().click();
    await page.locator('.equip-cta').scrollIntoViewIfNeeded();
    // Click at a live fight boundary in the same JS task, then inspect the pending build.
    const queued = await page.evaluate(() => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No fresh fight for queued equip')), 30000);
      const check = () => {
        const r = window.__emberRenderer, frame = r.lastFrame;
        if (!frame.fight || frame.elapsedMs > 300) { requestAnimationFrame(check); return; }
        document.querySelector('.equip-cta').click(); clearTimeout(timer);
        const saved = JSON.parse(JSON.parse(window.__ember.exportSave()).payload);
        resolve({ pending: !!saved.pending?.equipment?.weapon, attack: r.actors.get('hero').attackName });
      }; check();
    }));
    assert.deepEqual(queued, { pending: true, attack: 'unarmed' });
    await page.getByRole('navigation').getByRole('button', { name: 'Adventure', exact: true }).click();
    await page.waitForFunction(cls => window.__emberRenderer.actors.get('hero')?.attackName === cls, cls);
    await page.waitForFunction(cls => window.unarmedProbe.hits.filter(h => h.mode === cls).length >= 2, cls);
    const probe = await page.evaluate(() => window.unarmedProbe);
    writeFileSync(resolve(out, `${cls}-probe.json`), JSON.stringify(probe, null, 2));
    assert(probe.maxApproach > 9, `${cls}: never approached melee range`);
    const attacks = Map.groupBy(probe.samples.filter(s => s.pose === 'attack'), s => `${s.generation}/${s.serial}`);
    const completed = [...attacks.values()].filter(samples => new Set(samples.map(s => s.frame)).size === 4);
    assert(completed.length > 0, `${cls}: never displayed all four unarmed poses`);
    assert(completed.some(samples => samples.at(-1).now - samples[0].now >= 650), `${cls}: unarmed animation still rushed`);
    assert(completed.some(samples => samples.at(-1).x < Math.max(...samples.map(s => s.x)) * 0.1), `${cls}: return did not finish smoothly`);
    for (const samples of completed) for (let n = 1; n < samples.length; n++) {
      const gap = samples[n].now - samples[n - 1].now;
      if (gap < 40) assert(Math.abs(samples[n].x - samples[n - 1].x) < 30, `${cls}: position snapped between poses`);
    }
    assert.equal(probe.hudMoved, false); assert.equal(probe.clipped, false);
    const weaponFx = /arrow|arcane_bolt|warrior_slash|warrior_impact|monk_impact/;
    assert.deepEqual(probe.bursts.filter(b => b.mode === 'unarmed' && weaponFx.test(b.name)), []);
    const expected = { mage: 'arcane_bolt', ranger: 'arrow', warrior: 'warrior_impact', monk: 'monk_impact' }[cls];
    assert(probe.bursts.some(b => b.mode === cls && b.name.startsWith(expected)), `${cls}: missing equipped weapon effects`);
    await page.locator('.combat-canvas').screenshot({ path: resolve(out, `${cls}-armed.png`) });
    // Two attacks have also crossed the normal delayed save window.
    await page.reload();
    await page.waitForFunction(cls => window.__emberRenderer?.actors.get('hero')?.attackName === cls, cls);
    assert.deepEqual(errors, []);
    report.push({ classId: cls, ...probe, queued, reload: true });
    console.log(`PASS ${cls}: unarmed melee, no weapon VFX, queued equip, weapon animation, reload.`);
    await context.close();
  }
} finally {
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close(); await server.close();
}
