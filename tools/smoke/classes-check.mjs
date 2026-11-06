#!/usr/bin/env node
/**
 * C2 preparation: Warrior and Ranger in the built app (Chromium, 390x844 touch).
 * - both are selectable at character creation (Warrior Active, Ranger Alternate)
 * - combat renders with the Warrior; the in-app self-test passes (18 cases)
 * - Character screen: both class cards show identity, Mastery, next milestone and 5 techniques
 *   with lock states; the codex lists Monk and Mage as not learned with their paths
 * - switching to Ranger works
 *
 *   npm run build:web && (cd apps/mobile && npx vite preview --port 4173)
 *   node tools/smoke/classes-check.mjs [baseUrl]
 * Exits non-zero when a check fails. Screenshots: tools/smoke/out/classes-*.png
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://127.0.0.1:4173/";
const out = fileURLToPath(new URL("./out/", import.meta.url));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const page = await context.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
const shot = (label) => page.screenshot({ path: `${out}classes-${label}.png` });

await page.goto(base);
await page.getByText("Begin in Greenfields").waitFor({ timeout: 15_000 });
const pick = page.locator(".class-option");
const enabled = await pick.evaluateAll((els) => els.map((e) => ({ text: e.textContent, disabled: e.disabled })));
await pick.filter({ hasText: "Ranger" }).tap();
await pick.filter({ hasText: "Warrior" }).tap();
await shot("01-create");
const roles = await pick.evaluateAll((els) => els.map((e) => e.textContent));
await page.getByText("Begin in Greenfields").tap();
await page.locator(".combat-canvas").waitFor({ timeout: 15_000 });
await page.waitForTimeout(4_000);
await shot("02-adventure-warrior");
const header = await page.locator(".header").innerText();

await page.getByRole("button", { name: "Developer tools" }).tap();
await page.getByText("Run determinism self-test").tap();
await page.getByText(/ALL PASS|FAIL/).first().waitFor({ timeout: 60_000 });
const selftestRows = await page.locator(".selftest-row").count();
const allPass = (await page.getByText("ALL PASS").count()) > 0;
await page.getByRole("button", { name: "Close" }).first().tap();

await page.getByRole("button", { name: /Character/ }).last().tap();
await page.waitForTimeout(300);
const card = (cls) => page.locator(`.class-card[data-class="${cls}"]`);
const cardInfo = async (cls) => ({
  role: await card(cls).getAttribute("data-role"),
  text: (await card(cls).innerText()).replace(/\s+/g, " "),
  techniques: await card(cls).locator(".technique").evaluateAll((els) => els.map((e) => `${e.dataset.technique}:${e.dataset.state}`)),
});
const warrior = await cardInfo("warrior");
const ranger = await cardInfo("ranger");
await shot("03-character");
const codex = await page.locator(".codex-entry").evaluateAll((els) => els.map((e) => e.dataset.class));
await page.locator('.codex-entry[data-class="mage"] summary').tap();
const mageCodex = await page.locator('.codex-entry[data-class="mage"] .technique').count();
await page.locator('.codex-entry[data-class="mage"]').scrollIntoViewIfNeeded();
await shot("04-codex");

await card("ranger").getByRole("button", { name: /Make Ranger active/ }).tap();
// During a fight the switch is queued until the fight ends (build snapshot rule).
const queuedText = (await card("ranger").innerText().catch(() => "")).replace(/\s+/g, " ");
await page.locator(".header").filter({ hasText: "Ranger" }).waitFor({ timeout: 90_000 }).catch(() => undefined);
const afterSwitch = await page.locator(".header").innerText();
await page.getByRole("button", { name: /Adventure/ }).last().tap();
await page.waitForTimeout(3_000);
await shot("05-adventure-ranger");
await browser.close();

const checks = {
  fourClassesSelectable: enabled.length === 4 && enabled.every((e) => !e.disabled),
  warriorActiveRangerAlternate: roles.some((t) => /Warrior.*Active/.test(t)) && roles.some((t) => /Ranger.*Alternate/.test(t)),
  headerShowsWarrior: /Warrior/.test(header),
  selftestAllPass: allPass && selftestRows === 18,
  warriorCard: warrior.role === "Active" && /Mastery 1 \/ 20/.test(warrior.text) && /Next technique at M5: Retaliation/.test(warrior.text) && warrior.techniques.length === 5,
  warriorLockStates:
    warrior.techniques.join(",") ===
    "warrior_bleeding_strikes:unlocked,warrior_retaliation:next,warrior_execute:locked,warrior_deep_wounds:locked,warrior_relentless_finish:locked",
  rangerCard: ranger.role === "Alternate" && /Poisoned Shots/.test(ranger.text) && /Venom Burst/.test(ranger.text) && ranger.techniques.length === 5,
  codexListsOthers: codex.join(",") === "monk,mage" && mageCodex === 6, // Mage: Ignition + Arcane Ward at M1 (C2), then M5-M20
  switchToRanger: /Ranger/.test(afterSwitch) && (/Switch queued/.test(queuedText) || /Active/.test(queuedText)),
  noConsoleErrors: errors.length === 0,
};
const report = { base, enabled, roles, header, selftestRows, warrior, ranger, codex, queuedText, afterSwitch, checks, errors };
writeFileSync(`${out}classes-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ checks, errors }, null, 2));
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
