// Real-app check: production attack art must make contact on the logged HIT time.
// The combat log stamps ATTACK and HIT together (the authoritative contact moment);
// the renderer winds the clip up early so the melee impact / projectile arrival lands there.
// Usage: node tools/smoke/darkwood-sync-check.mjs [url] (Chromium; add "webkit" as 3rd arg for WebKit).
import { chromium, webkit } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
const url = process.argv[2] ?? "http://127.0.0.1:4173/";
const engines = process.argv[3] === "webkit" ? [chromium, webkit] : [chromium];
const out = "artifacts/darkwood-production-v1/sync";
mkdirSync(out, { recursive: true });
const TOLERANCE_MS = 67; // four 60 Hz frames: headless software GL drops frames; the old offset was 150-350 ms
const report = [];
for (const engine of engines) {
  const browser = await engine.launch(engine === chromium ? { args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } : {});
  try {
    for (const hero of ["Warrior", "Monk", "Mage", "Ranger"]) {
      const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
      const errors = []; page.on("pageerror", e => errors.push(String(e)));
      await page.goto(url);
      await page.locator(".class-option").filter({ hasText: hero }).click();
      await page.getByText("Begin in Greenfields").click();
      await page.locator(".combat-canvas").waitFor();
      await page.getByRole("button", { name: "Developer tools" }).click();
      await page.getByRole("button", { name: /Unlock all zones/i }).click();
      await page.getByRole("button", { name: "Close" }).click().catch(() => {});
      await page.getByRole("button", { name: /Begin Darkwood/ }).click();
      await page.waitForTimeout(1500);
      await page.evaluate(() => {
        const r = window.__emberRenderer, log = (window.__syncProbe = { hits: [], contacts: [] });
        const apply = r.apply.bind(r);
        r.apply = (e, now, ff) => { if (!ff && e.type === "hit" && e.via === "basic") log.hits.push({ now, src: String(e.src) }); return apply(e, now, ff); };
        const burst = r.artBurst.bind(r);
        r.artBurst = (name, from, to, start, d, hit) => { if (/_hit$|splash|impact|bite/.test(name)) log.contacts.push({ now: start, name }); return burst(name, from, to, start, d, hit); };
      });
      await page.waitForTimeout(6000);
      await page.locator(".combat-canvas").screenshot({ path: `${out}/${engine.name()}-${hero.toLowerCase()}.png` });
      const log = await page.evaluate(() => window.__syncProbe);
      const deltas = log.contacts.map(c => Math.min(...log.hits.map(h => Math.abs(c.now - h.now))));
      assert(deltas.length >= 5, `${hero}: too few contacts (${deltas.length})`);
      const late = deltas.filter(d => d > TOLERANCE_MS);
      assert(late.length === 0, `${hero}: contact VFX off the logged HIT by ${late.join(",")} ms`);
      assert.deepEqual(errors, []);
      report.push({ engine: engine.name(), hero, contacts: deltas.length, maxDeltaMs: Math.max(...deltas) });
      console.log(`${engine.name()} ${hero}: ${deltas.length} contacts, max ${Math.max(...deltas)} ms from the logged HIT`);
      await page.context().close();
    }
  } finally { await browser.close(); }
}
writeFileSync(`${out}/report.json`, JSON.stringify({ pass: true, toleranceMs: TOLERANCE_MS, report }, null, 2));
console.log("PASS: production contact art lands on the logged HIT time.");
