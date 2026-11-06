import { chromium, webkit } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
const out = "artifacts/darkwood-production-v1/events";
mkdirSync(out, { recursive: true });
const reports = [];
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(process.argv[2] ?? "http://127.0.0.1:4173/");
    await page.getByText("Begin in Greenfields").click();
    await page.getByRole("button", { name: "Developer tools" }).click();
    await page.getByRole("button", { name: "Art Preview", exact: true }).click();
    await page.locator('[data-art-ready="true"]').waitFor();
    const setup = async (hero, enemy) => {
      await page.evaluate(({ hero, enemy }) => window.__emberArtPreview.renderPreview({ hero, enemies: [enemy], pose: "idle", effect: "none", timeMs: 0 }), { hero, enemy });
      await page.waitForTimeout(600);
    };
    await setup("mage", "wolf");
    const ward = await page.evaluate(() => {
      const r = window.__emberArtPreview, a = r.actors.get("hero");
      const event = (e, now) => { r.apply({ t: 0, ...e }, now, false); r.animate(now); };
      event({ type: "ward", tgt: "hero", ward: 2000, cap: 3000, amt: 2000, via: "gain" }, 10000);
      const form = a.wardPhase;
      const layerOrder = a.root.getChildIndex(a.vfx.get("arcane_ward_back")) < a.root.getChildIndex(a.body) && a.root.getChildIndex(a.vfx.get("arcane_ward_front")) > a.root.getChildIndex(a.body);
      r.animate(10211); const idle = a.wardPhase;
      event({ type: "hit", src: "preview-0", tgt: "hero", hp: 7000, ward: 1500, abs: 500, eff: 0, amt: 500, via: "basic" }, 10300);
      const absorb = a.wardPhase;
      const settleOnly = a.body.texture === r.sprites.optional("characters/mage/hit").frames[1].normal;
      event({ type: "hit", src: "preview-0", tgt: "hero", hp: 7000, ward: 0, abs: 1500, eff: 0, amt: 1500, via: "basic" }, 10500);
      const broken = a.wardPhase;
      r.animate(10711); const off = a.wardPhase;
      event({ type: "death", actor: "hero" }, 11000); r.animate(13000);
      return { form, idle, absorb, settleOnly, broken, off, layerOrder, deathHeld: a.body.texture === r.sprites.optional("characters/mage/death").frames[3].normal && a.root.alpha === 1 };
    });
    assert.deepEqual(ward, { form: "form", idle: "idle_loop", absorb: "absorb_hit", settleOnly: true, broken: "break", off: "off", layerOrder: true, deathHeld: true });
    const fxResults = [];
    for (const [hero, enemy, attacker, effect] of [
      ["warrior", "wolf", "hero", "warrior_impact_crit"], ["monk", "wolf", "hero", "monk_impact_crit"],
      ["mage", "wolf", "hero", "arcane_bolt"], ["ranger", "wolf", "hero", "arrow"],
      ["monk", "wolf", "preview-0", "wolf_bite"], ["warrior", "spider", "preview-0", "venom_glob"],
    ]) {
      await setup(hero, enemy);
      const result = await page.evaluate(({ attacker }) => {
        const r = window.__emberArtPreview, tgt = attacker === "hero" ? "preview-0" : "hero";
        r.apply({ type: "attack", t: 0, src: attacker, tgt }, 10000, false);
        r.apply({ type: "hit", t: 0, src: attacker, tgt, hp: 6000, amt: 1000, eff: 1000, crit: 1, via: "basic" }, 10000, false);
        r.animate(10200);
        const source = r.actors.get(attacker);
        const active = r.artEffects.map(e => e.name);
        const slash = source.vfx.get("warrior_slash")?.visible ?? false;
        const frame = [source.body.texture.width, source.body.texture.height];
        r.animate(10400);
        return { active, contact: r.artEffects.map(e => e.name), slash, frame, bytes: r.info().artDecodedBytes };
      }, { attacker });
      assert(result.active.includes(effect), JSON.stringify(result));
      if (hero === "warrior" && attacker === "hero") { assert(result.slash); assert.deepEqual(result.frame, [72, 72]); }
      if (enemy === "wolf" && attacker !== "hero") assert.deepEqual(result.frame, [72, 56]);
      if (effect === "arrow") assert(result.contact.includes("arrow_hit"));
      if (effect === "arcane_bolt") assert(result.contact.includes("arcane_bolt_hit"));
      if (effect === "venom_glob") assert(result.contact.includes("venom_splash"));
      fxResults.push({ hero, enemy, attacker, effect, result });
    }
    reports.push({ engine: engine.name(), ward, fxResults });
    console.log(`${engine.name()}: Ward transitions/layers, death hold, all six attack VFX owners PASS`);
  } finally { await browser.close(); }
}
writeFileSync(`${out}/report.json`, JSON.stringify({ pass: true, reports }, null, 2));
