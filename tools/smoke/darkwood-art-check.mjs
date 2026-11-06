import { chromium, webkit } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
const out = "artifacts/darkwood-production-v1/screenshots";
mkdirSync(out, { recursive: true });
const results = [];
for (const [name, engine] of [["chromium", chromium], ["webkit", webkit]]) {
  const browser = await engine.launch(name === "chromium" ? { args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } : {});
  try {
    for (const [width, height] of [[360, 640], [390, 844], [412, 915], [480, 854]]) {
      const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
      const page = await context.newPage(); const errors = [];
      page.on("pageerror", e => errors.push(String(e)));
      await page.goto(process.argv[2] ?? "http://127.0.0.1:4173/");
      await page.locator(".class-option").filter({ hasText: "Warrior" }).click();
      await page.getByText("Begin in Greenfields").click();
      await page.locator(".combat-canvas").waitFor();
      await page.getByRole("button", { name: /Gear/ }).last().click();
      const portrait = page.locator(".production-portrait").first();
      await portrait.locator("img").evaluate(im => im.decode());
      const bounds = await portrait.evaluate(el => {
        const p = el.getBoundingClientRect(), im = el.querySelector("img").getBoundingClientRect();
        return { width: p.width, height: p.height, iw: im.width, ih: im.height, left: im.left - p.left, top: im.top - p.top };
      });
      assert.equal(bounds.iw, 192); assert.equal(bounds.ih, 192); assert(bounds.left >= 8 && bounds.top >= 8);
      await page.screenshot({ path: `${out}/${name}-${width}-gear.png` });
      await page.getByRole("button", { name: /Character/ }).last().click();
      assert.equal(await page.locator(".production-class-art .production-portrait").count(), 2);
      await page.locator(".production-class-art").first().screenshot({ path: `${out}/${name}-${width}-character.png` });
      await page.getByRole("button", { name: "Developer tools" }).click();
      await page.getByRole("button", { name: "Art Preview", exact: true }).click();
      await page.locator('[data-art-ready="true"]').waitFor();
      for (const hero of ["warrior", "monk", "mage", "ranger"]) {
        await page.getByLabel("Art character").selectOption(hero);
        await page.getByLabel("Art enemy").selectOption("mixed");
        await page.getByLabel("Art count").selectOption("3");
        await page.getByLabel("Art effect").selectOption(hero === "mage" ? "ward" : "none");
        await page.waitForTimeout(500);
        for (const pose of ["idle", "attack", "hit", "death"]) {
          await page.getByLabel("Art pose").selectOption(pose);
          await page.getByLabel("Art animation time").fill(pose === "death" ? "1000" : "200");
          await page.waitForTimeout(200);
          const snapshot = await page.evaluate(() => window.__emberArtPreview.presentationSnapshot());
          assert.equal(snapshot.cssScale, 2);
          for (const a of snapshot.actors) {
            assert(a.production, JSON.stringify(a)); assert.deepEqual(a.scale, [1, 1]);
            assert(a.left >= 0 && a.right <= snapshot.width && a.top >= 0, JSON.stringify(a));
          }
          if (hero === "warrior" && pose === "attack") assert.deepEqual(snapshot.actors[0].frame, [72, 72]);
          await page.locator(".art-gallery .combat-host").screenshot({ path: `${out}/${name}-${width}-${hero}-${pose}.png` });
          results.push({ name, width, hero, pose, snapshot });
        }
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
  } finally { await browser.close(); }
}
writeFileSync(`${out}/report.json`, JSON.stringify({ pass: true, cases: results }, null, 2));
console.log(`PASS: ${results.length} production compositions and Gear/Character 3× bounds in both engines.`);
