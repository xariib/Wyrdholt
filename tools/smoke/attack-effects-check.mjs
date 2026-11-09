// Browser regression for presentation-only attack accents.
// Usage: node tools/smoke/attack-effects-check.mjs [dev-or-preview-url]
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://127.0.0.1:5173/";
const out = "artifacts/attack-effects";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  for (const hero of ["Warrior", "Monk", "Mage", "Ranger"]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", e => errors.push(String(e)));
      await page.goto(url);
      await page.locator(".class-option").filter({ hasText: hero }).click();
      await page.getByText("Begin in Greenfields").click();
      await page.waitForFunction(() => window.__emberRenderer?.actors.size > 1);
      await page.evaluate(() => {
        const r = window.__emberRenderer;
        const probe = window.__attackProbe = { hits: 0, impacts: 0, trails: 0, enemies: 0, maxEffects: 0 };
        const apply = r.apply.bind(r);
        r.apply = (e, now, ff) => {
          if (!ff && e.type === "hit") probe.hits++;
          return apply(e, now, ff);
        };
        const impact = r.attackImpact.bind(r);
        r.attackImpact = (src, tgt, ...args) => {
          probe.impacts++;
          if (!src.isHero) probe.enemies++;
          return impact(src, tgt, ...args);
        };
        const trail = r.attackTrail.bind(r);
        r.attackTrail = (...args) => { probe.trails++; return trail(...args); };
        const animate = r.animate.bind(r);
        r.animate = now => { animate(now); probe.maxEffects = Math.max(probe.maxEffects, r.effects.length); };
      });
      await page.waitForFunction(() => window.__attackProbe.hits >= 6, undefined, { timeout: 15000 });
      const probe = await page.evaluate(() => window.__attackProbe);
      assert.equal(probe.impacts, probe.hits, `${hero}: exactly one accent per authoritative hit`);
      assert(probe.enemies > 0, `${hero}: enemy attacks have accents`);
      assert(probe.maxEffects <= 8, `${hero}: procedural budget is bounded`);
      if (["Mage", "Ranger"].includes(hero)) assert(probe.trails > 0, `${hero}: ranged attacks have trails`);

      // Freeze only the disposable renderer, then inspect a representative hit.
      const checks = await page.evaluate(() => {
        const r = window.__emberRenderer;
        r.setVisible(false);
        const src = r.actors.get("hero"), tgt = [...r.actors.values()].find(a => !a.isHero);
        const now = performance.now();
        r.animate(now + 2000);
        const event = { type: "hit", src: src.id, tgt: tgt.id, hp: tgt.hp100, amt: 100, via: "basic", crit: 1 };
        const hp = tgt.hp100;
        r.apply(event, now, true);
        const skipped = r.effects.length === 0;
        r.apply(event, now, false);
        r.animate(now + 75);
        r.app.renderer.render(r.app.stage);
        return { skipped, sameHp: tgt.hp100 === hp, visibleImpact: r.effects.length === 1 && r.effects[0].node.alpha > 0 };
      });
      assert.deepEqual(checks, { skipped: true, sameHp: true, visibleImpact: true });
      await page.locator(".combat-canvas").screenshot({ path: `${out}/${hero.toLowerCase()}.png` });
      const cleanup = await page.evaluate(() => {
        const r = window.__emberRenderer;
        const now = performance.now();
        r.animate(now + 5000);
        const expired = r.effects.length === 0;
        const src = r.actors.get("hero"), tgt = [...r.actors.values()].find(a => !a.isHero);
        r.attackImpact(src, tgt, now, false, "basic");
        r.lastPlayback = 0;
        r.play(1000, now);
        const catchupCleared = r.effects.length === 0;
        // All special attacks render without touching the simulation.
        for (const via of ["combo_strike", "flowing_combo", "retaliation", "relentless_finish", "spell_echo", "wildfire", "stormcall", "split_arrow", "piercing_strike", "venom_burst"]) {
          r.attackImpact(src, tgt, now, false, via);
          r.animate(now + 60);
          r.app.renderer.render(r.app.stage);
          r.animate(now + 1000);
        }
        for (let i = 0; i < 40; i++) r.attackImpact(src, tgt, now, true, "stormcall");
        const bounded = r.effects.length === 8;
        r.animate(now + 1000);
        r.attackTrail(src, tgt, [20, 30], [100, 30], now);
        src.alive = false;
        r.animate(now + 30);
        const cancelled = r.effects.length === 0;
        r.clearScene();
        return { expired, catchupCleared, bounded, cancelled, empty: r.fxLayer.children.length === 0 };
      });
      assert.deepEqual(cleanup, { expired: true, catchupCleared: true, bounded: true, cancelled: true, empty: true });
      assert.deepEqual(errors, []);
      console.log(`${hero}: ${probe.hits} synchronized impacts; ${probe.trails} trails; lifecycle and special attacks passed`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
