/**
 * B3 (automated): rendering never determines outcomes.
 *
 * 1. Run the real built app in Chromium with the PixiJS combat canvas visible.
 * 2. Export the save twice, T seconds apart (no player input in between).
 * 3. In Node, load the first save and advance game-core headlessly by exactly the
 *    simulated time that passed in the app.
 * 4. The headless profile must equal the app's second save (wall-clock fields excluded).
 *
 *   npx tsx tools/smoke/b3-render-independence.ts [baseUrl] [seconds]
 */
import { chromium } from "playwright";
import { CONTENT } from "@emberbound/game-content";
import { ContentIndex, advanceAdventure, canonicalJson, encodeProfile, parseSave, type Profile } from "@emberbound/game-core";

const base = process.argv[2] ?? "http://127.0.0.1:4173/";
const seconds = Number(process.argv[3] ?? 20);
const content = new ContentIndex(CONTENT);

type Hook = { exportSave(): string; simulatedMs(): number };

function comparable(p: Profile): string {
  const copy = structuredClone(p);
  copy.clock.lastSettledWallMs = 0;
  return canonicalJson(encodeProfile(copy));
}

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const page = await context.newPage();
await page.goto(base);
await page.getByText("Begin in Greenfields").waitFor({ timeout: 15_000 });
await page.getByText("Begin in Greenfields").tap();
await page.locator(".combat-canvas").waitFor({ timeout: 15_000 });
await page.waitForTimeout(1_000);
const first = await page.evaluate(() => (window as unknown as { __ember: Hook }).__ember.exportSave());
await page.waitForTimeout(seconds * 1_000);
const second = await page.evaluate(() => (window as unknown as { __ember: Hook }).__ember.exportSave());
await browser.close();

const a = parseSave(first);
const b = parseSave(second);
if (!a.ok || !b.ok) throw new Error("could not parse exported saves");
const delta = b.profile.clock.simulatedMs - a.profile.clock.simulatedMs;
const headless = structuredClone(a.profile);
advanceAdventure(headless, content, delta, { offline: false, contentTimeMs: 0 });
const same = comparable(headless) === comparable(b.profile);
console.log(
  JSON.stringify(
    {
      check: "B3 render independence",
      renderedSimulatedMs: delta,
      fightsDuringWindow: b.profile.stats.fights - a.profile.stats.fights,
      identical: same,
    },
    null,
    2,
  ),
);
process.exit(same ? 0 : 1);
