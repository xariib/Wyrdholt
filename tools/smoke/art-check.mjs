import { chromium, webkit } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";

const out = process.env.ART_REPORT_DIR ?? "artifacts/art-pipeline-20260927/screenshots";
mkdirSync(out, { recursive: true });
const base = process.argv[2] ?? "http://127.0.0.1:4173/";
const captures = [];
for (const [engineName, engine] of [["chromium", chromium], ["webkit", webkit]]) {
  const browser = await engine.launch(engineName === "chromium" ? { args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } : {});
  try {
    for (const [width, height] of [[360, 640], [390, 844], [412, 915], [480, 854]]) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", e => errors.push(String(e)));
      await page.goto(base);
      await page.getByText("Begin in Greenfields").click();
      await page.locator(".combat-canvas").waitFor();
      await page.getByRole("button", { name: "Developer tools" }).click();
      await page.getByRole("button", { name: "Art Preview", exact: true }).click();
      await page.locator('[data-art-ready="true"]').waitFor();
      const gallery = page.locator(".art-gallery");
      const host = gallery.locator(".combat-host");
      const shot = async (name, locator = host) => {
        await locator.scrollIntoViewIfNeeded();
        await page.waitForTimeout(150);
        const bounds = await locator.boundingBox();
        assert(bounds && bounds.width <= width && bounds.x >= -1);
        const path = `${out}/${engineName}-${width}x${height}-${name}.png`;
        await locator.screenshot({ path });
        captures.push({ engineName, width, height, name, path });
      };
      await shot("warrior-darkwood");
      await page.getByLabel("Art character").selectOption("mage");
      await page.getByLabel("Art effect").selectOption("ward");
      await shot("mage-ward");
      await page.getByLabel("Art count").selectOption("3");
      await shot("three-enemies");
      await page.getByLabel("Art enemy").selectOption("matron");
      await page.getByLabel("Art count").selectOption("1");
      await shot("boss");
      await shot("gear", gallery.locator("[data-art-gear]"));
      await shot("icons", gallery.locator("[data-art-icons]"));
      await page.getByLabel("Art effect").selectOption("none");
      await page.getByLabel("Art character").selectOption("monk");
      await shot("darkwood");
      for (const pose of ["attack", "hit", "death"]) {
        await page.getByLabel("Art pose").selectOption(pose);
        await shot(pose);
      }
      // Close and re-open verifies renderer disposal / fresh ownership.
      await gallery.getByRole("button", { name: "×", exact: true }).click();
      await page.getByRole("button", { name: "Art Preview", exact: true }).click();
      await page.locator('[data-art-ready="true"]').waitFor();
      assert.deepEqual(errors, [], errors.join("\n"));
      await context.close();
    }
  } finally { await browser.close(); }
}
writeFileSync(`${out}/report.json`, JSON.stringify({ pass: true, captures }, null, 2));
console.log(`PASS: ${captures.length} deterministic art captures; Chromium + WebKit; four portrait sizes.`);
