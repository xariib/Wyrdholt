#!/usr/bin/env node
/**
 * Browser smoke test of the built app at portrait phone sizes (Chromium, touch emulation).
 * Early signal only — physical-device results decide pass/fail.
 *
 *   npm run build:web && npx vite preview --port 4173 (in apps/mobile)
 *   node tools/smoke/ui-smoke.mjs [baseUrl]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://127.0.0.1:4173/";
const out = fileURLToPath(new URL("./out/", import.meta.url));
mkdirSync(out, { recursive: true });
const sizes = [
  { name: "390x844", width: 390, height: 844, dpr: 3 },
  { name: "360x640", width: 360, height: 640, dpr: 2 },
];
const report = { base, sizes: [] };
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });

for (const size of sizes) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: size.dpr,
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  const shot = async (label) => page.screenshot({ path: `${out}${size.name}-${label}.png` });
  const t0 = Date.now();
  await page.goto(base);
  await page.getByText("Begin in Greenfields").waitFor({ timeout: 15_000 });
  await shot("01-create");
  await page.getByRole("button", { name: /Mage/ }).first().tap();
  await page.getByRole("button", { name: /Monk/ }).first().tap();
  await page.getByText("Begin in Greenfields").tap();
  await page.locator(".combat-canvas").waitFor({ timeout: 15_000 });
  const msToPlay = Date.now() - t0;
  await page.waitForTimeout(3_500);
  await shot("02-adventure");

  // Developer tools: grant gear, self-test
  await page.getByRole("button", { name: "Developer tools" }).tap();
  await page.getByText("Grant sample gear").tap();
  await page.getByText("Run determinism self-test").tap();
  await page.getByText(/ALL PASS|FAIL/).first().waitFor({ timeout: 60_000 });
  const selftest = await page.locator(".selftest-row").allInnerTexts();
  const allPass = (await page.getByText("ALL PASS").count()) > 0;
  await page.locator(".sheet").evaluate((el) => el.scrollTo(0, 400));
  await shot("03-selftest");
  await page.getByRole("button", { name: "Close" }).first().tap();

  // Gear flow: slot -> compare -> equip -> back
  await page.getByRole("button", { name: /Gear/ }).last().tap();
  await page.waitForTimeout(300);
  await shot("04-gear");
  await page.locator(".slot-card").nth(3).tap();
  await page.waitForTimeout(300);
  await shot("05-slot-compare");
  await page.locator(".slot-inventory .list-item:not(.equipped)").first().tap();
  const equipBtn = page.getByRole("button", { name: /^Equip / });
  const equipLabel = (await equipBtn.count()) ? await equipBtn.first().innerText() : null;
  if (equipLabel) await equipBtn.first().tap();
  await page.waitForTimeout(400);
  await shot("06-after-equip");

  // Character
  await page.getByRole("button", { name: /Character/ }).last().tap();
  await page.waitForTimeout(300);
  await shot("07-character");

  // Scroll-vs-tap check on the gear list: a drag starting on a card must not open it.
  await page.getByRole("button", { name: /Gear/ }).last().tap();
  await page.locator(".slot-card").nth(0).tap();
  await page.waitForTimeout(300);
  const before = (await page.locator(".list-item.selected").allInnerTexts()).join("\n");
  // Start the drag on an item that is NOT selected; a drag must not select it.
  const items = page.locator(".list-item");
  let dragIndex = 0;
  for (let i = 0; i < (await items.count()); i += 1) {
    const cls = (await items.nth(i).getAttribute("class")) ?? "";
    if (!cls.includes("selected") && !cls.includes("equipped")) {
      dragIndex = i;
      break;
    }
  }
  const box = await items.nth(dragIndex).boundingBox();
  const cdp = await context.newCDPSession(page);
  if (box) {
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (let i = 1; i <= 8; i += 1) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - i * 12 }] });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
  await page.waitForTimeout(300);
  const selectedAfterDrag = (await page.locator(".list-item.selected").allInnerTexts()).join("\n");
  const scrollDidNotSelect = before === selectedAfterDrag;
  await page.getByRole("button", { name: "Close equipment" }).tap();

  // Offline benchmark
  await page.getByRole("button", { name: /Adventure/ }).last().tap();
  await page.getByRole("button", { name: "Developer tools" }).tap();
  await page.getByText("Benchmark 8-hour catch-up").tap();
  await page.getByText("While you were away").waitFor({ timeout: 60_000 });
  const benchText = await page.locator(".modal .mono").filter({ hasText: "catch-up" }).last().innerText().catch(() => "");
  await shot("08-offline-summary");
  await page.getByRole("button", { name: "Continue" }).tap();

  // Persistence across reload
  const goldBefore = await page.locator(".gold-chip").innerText();
  await page.waitForTimeout(2_500);
  await page.reload();
  await page.locator(".combat-canvas").waitFor({ timeout: 15_000 });
  const nameAfter = await page.locator(".header-name").innerText();
  await page.waitForTimeout(1_500);
  await shot("09-after-reload");

  // FPS sample (headless software GL: not representative of devices)
  const fps = await page.evaluate(
    () =>
      new Promise((resolve) => {
        let frames = 0;
        const start = performance.now();
        const loop = () => {
          frames += 1;
          if (performance.now() - start < 3000) requestAnimationFrame(loop);
          else resolve((frames * 1000) / (performance.now() - start));
        };
        requestAnimationFrame(loop);
      }),
  );

  report.sizes.push({
    size: size.name,
    msToPlay,
    totalTestMs: Date.now() - t0,
    selftestAllPass: allPass,
    selftest,
    equipLabel,
    scrollDidNotSelect,
    benchText,
    goldBefore,
    nameAfter,
    headlessFps: Math.round(fps),
    errors,
  });
  await context.close();
}
await browser.close();
writeFileSync(`${out}smoke-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

if (report.sizes.some(r => !r.selftestAllPass || !r.scrollDidNotSelect || !r.equipLabel || r.errors.length)) process.exit(1);
