#!/usr/bin/env node
/**
 * Built-app save integration in real IndexedDB, Web Locks, React and Web Workers.
 * node --import tsx tools/smoke/save-integration-check.mjs [distDir] [reportDir]
 * CHROMIUM_EXECUTABLE_PATH optionally selects an installed browser.
 * Uses isolated disposable browser contexts and explicit fixture seeding only.
 * This is NOT PR13's authentic old-build upgrade, trusted lifecycle or native gate.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { extname, resolve, sep, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { CONTENT } from "@emberbound/game-content";
import { ContentIndex, SELF_TEST_CASES, cloneProfile, createInstance, createProfile, applyCommand, executeRecord, prepareFight, serializeSave, parseSave, sha256Hex } from "@emberbound/game-core";

const root = fileURLToPath(new URL("../../", import.meta.url));
const dist = resolve(process.argv[2] ?? join(root, "apps/mobile/dist"));
const out = resolve(process.argv[3] ?? join(root, "tools/smoke/out/save-integration"));
mkdirSync(out, { recursive: true });
let externalBase = process.env.SAVE_INTEGRATION_BASE_URL;
if (externalBase) {
  const url = new URL(externalBase);
  assert(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && url.protocol === "http:"
    && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash,
  "External test server must be a loopback HTTP origin");
  externalBase = url.href;
}
const paths = { main: "/DATA/saves/profile.json", temp: "/DATA/saves/profile.tmp.json", backup: "/DATA/saves/profile.bak.json" };
const lockName = "wyrdholt-save/Directory.Data/saves";
const content = new ContentIndex(CONTENT);
const hash = text => createHash("sha256").update(text).digest("hex");
const legacySave = readFileSync(join(root, "packages/game-core/test/fixtures/legacy-schema1.json"), "utf8");
assert(parseSave(legacySave).ok, "The pinned legacy schema 1 fixture must parse");
function fixture(name = "Preserved", farming = false) {
  const p = createProfile(content, { name, activeClassId: "monk", alternateClassId: "mage", masterSeed: 1042, nowWallMs: Date.now() - 3_600_000 });
  if (farming) applyCommand(p, content, { type: "startFarm", zoneId: "greenfields" }, { contentTimeMs: Date.now() });
  return serializeSave(p, Date.now());
}
function changed(text, mutate) {
  const envelope = JSON.parse(text), payload = JSON.parse(envelope.payload);
  mutate(payload, envelope); envelope.payload = JSON.stringify(payload); envelope.checksum = sha256Hex(envelope.payload);
  return JSON.stringify(envelope);
}
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const server = createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname === "/__observer__") { res.writeHead(200, { "content-type": "text/html" }); res.end("<!doctype html><title>Fixture observer</title>"); return; }
  const file = resolve(dist, "." + (pathname === "/" ? "/index.html" : pathname));
  try {
    assert(file.startsWith(dist + sep) && statSync(file).isFile());
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }); res.end(readFileSync(file));
  } catch { res.writeHead(404); res.end(); }
});
const report = { passed: false, dist, observationScope: "Headless built app; real browser storage/locks/worker with controlled fixtures and explicit fault injection; no native durability or authentic upgrade claim", legacyFixtureSHA256: hash(legacySave), checks: [], errors: [] };
let browser;
const contexts = new Set();
async function storage(page, slots, readOnly = false) {
  return page.evaluate(async ({ paths, slots, readOnly }) => {
    const db = await new Promise((done, fail) => {
      const request = indexedDB.open("Disc", 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore("FileStorage", { keyPath: "path" });
        store.createIndex("by_folder", "folder");
      };
      request.onsuccess = () => done(request.result); request.onerror = () => fail(request.error);
    });
    try {
      if (!readOnly) await new Promise((done, fail) => {
        const tx = db.transaction("FileStorage", "readwrite"), store = tx.objectStore("FileStorage");
        for (const [slot, raw] of Object.entries(slots)) {
          const path = paths[slot];
          if (raw === null) store.delete(path);
          else store.put({ path, folder: "/DATA/saves", type: "file", content: raw, size: raw.length, ctime: 1, mtime: 1 });
        }
        tx.oncomplete = done; tx.onerror = () => fail(tx.error); tx.onabort = () => fail(tx.error);
      });
      return await new Promise((done, fail) => {
        const tx = db.transaction("FileStorage", "readonly"), store = tx.objectStore("FileStorage"), result = {};
        for (const [slot, path] of Object.entries(paths)) {
          const req = store.get(path); req.onsuccess = () => { result[slot] = req.result?.content ?? null; };
        }
        tx.oncomplete = () => done(result); tx.onerror = () => fail(tx.error);
      });
    } finally { db.close(); }
  }, { paths, slots, readOnly });
}
async function setup(slots, fault = null) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, acceptDownloads: true });
  contexts.add(context);
  if (externalBase) await context.route(base + "__observer__", route => route.fulfill({
    status: 200, contentType: "text/html", body: "<!doctype html><title>Fixture observer</title>",
  }));
  const observer = await context.newPage(); await observer.goto(base + "__observer__");
  const before = await storage(observer, slots);
  const page = await context.newPage();
  page.on("pageerror", e => report.errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error") report.errors.push(m.text()); });
  const workers = []; page.on("worker", w => workers.push(w.url()));
  await page.addInitScript(({ paths, fault }) => {
    window.__saveAudit = { mutations: [], reads: [], forbidden: [], fault: false };
    const prototype = IDBObjectStore.prototype;
    for (const method of ["get", "put", "add", "delete", "clear"]) {
      const native = prototype[method];
      prototype[method] = function (...args) {
        if (this.name === "FileStorage" && this.transaction.db.name === "Disc") {
          const audit = window.__saveAudit;
          if (method === "get") {
            audit.reads.push(args[0]);
            if (fault === "read" && args[0] === paths.main) { audit.fault = true; throw new DOMException("Injected read failure", "InvalidStateError"); }
          } else {
            audit.mutations.push({ method, key: args[0]?.path ?? args[0] ?? null, text: typeof args[0]?.content === "string" ? args[0].content : null });
            if (fault === "write") { audit.fault = true; throw new DOMException("Injected write failure", "QuotaExceededError"); }
          }
        }
        return Reflect.apply(native, this, args);
      };
    }
    if (fault === "refusal") {
      const observe = () => {
        for (const selector of [".create", ".combat-canvas", ".header"]) if (document.querySelector(selector)) window.__saveAudit.forbidden.push(selector);
        for (const button of document.querySelectorAll("button")) if (button.textContent === "Continue") window.__saveAudit.forbidden.push("Continue");
      };
      new MutationObserver(observe).observe(document, { subtree: true, childList: true });
    }
  }, { paths, fault });
  return { context, observer, page, before, workers };
}
const audit = page => page.evaluate(() => window.__saveAudit);
async function close(test) { await test.context.close(); contexts.delete(test.context); }
async function refused(test, reason) {
  await test.page.getByRole("heading", { name: "Adventure paused", exact: true }).waitFor();
  await test.page.getByText(reason, { exact: true }).waitFor();
  for (const selector of [".create", ".combat-canvas", ".header"]) assert.equal(await test.page.locator(selector).count(), 0);
  assert.equal(await test.page.getByRole("button", { name: "Continue", exact: true }).count(), 0);
}
let base;
try {
  if (externalBase) base = externalBase;
  else {
    await new Promise((done, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", done); });
    base = `http://127.0.0.1:${server.address().port}/`;
  }
  report.baseURL = base; report.externalServer = Boolean(externalBase);
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  report.browser = browser.version(); report.playwright = JSON.parse(readFileSync(join(root, "node_modules/playwright/package.json"))).version;
  const valid = fixture();
  const cases = [
    { name: "unsupported-main", slots: { main: changed(valid, (p, e) => { p.schema = 6; e.schema = 6; }), backup: valid }, reason: "A saved adventure uses a version this build cannot open." },
    { name: "corrupt-sidefile", slots: { main: valid, temp: "not a save", backup: valid }, reason: "A saved adventure could not be read as a valid save." },
    { name: "malformed-profile", slots: { main: changed(valid, p => { delete p.clock; }), backup: valid }, reason: "A saved adventure could not be read as a valid save." },
    { name: "malformed-character", slots: { main: changed(valid, p => { p.character.name = { broken: true }; }), backup: valid }, reason: "A saved adventure could not be read as a valid save." },
    { name: "legacy-schema1-rules", slots: { main: legacySave, backup: valid }, reason: "A saved adventure belongs to a different game version." },
    { name: "read-io", slots: { main: valid, backup: valid }, reason: "The saved adventure could not be read or written reliably.", fault: "read" },
    { name: "occupied-web-lock", slots: { main: valid, backup: valid }, reason: "The saved adventure is in use elsewhere or could not be accessed safely.", holdLock: true },
  ];
  for (const spec of cases) {
    const test = await setup(spec.slots, spec.fault ?? "refusal");
    if (spec.holdLock) {
      await test.observer.evaluate(name => {
        window.__heldLock = navigator.locks.request(name, async () => {
          window.__lockAcquired = true; await new Promise(done => { window.__releaseLock = done; });
        });
      }, lockName);
      await test.observer.waitForFunction(() => window.__lockAcquired);
    }
    await test.page.goto(base); await refused(test, spec.reason);
    await test.page.getByRole("button", { name: "Check again (read only)", exact: true }).tap();
    await test.page.getByText("The adventure is still paused. Review the file status below.", { exact: true }).waitFor();
    const state = await audit(test.page);
    assert(Object.values(paths).every(path => state.reads.includes(path)), "All three slots must actually be inspected");
    for (const [slot, raw] of Object.entries(test.before)) {
      if (raw === null || spec.fault === "read" && slot === "main") continue;
      await test.page.getByRole("button", { name: `View observed ${slot} text`, exact: true }).tap();
      assert.equal(await test.page.getByRole("textbox", { name: `Observed ${slot} text`, exact: true }).inputValue(), raw);
      if (spec.name === "legacy-schema1-rules" && slot === "main") {
        const download = test.page.waitForEvent("download"); await test.page.getByRole("button", { name: "Download observed text", exact: true }).tap();
        const downloaded = await download; const file = join(out, "observed-legacy-schema1.txt"); await downloaded.saveAs(file);
        assert.equal(readFileSync(file, "utf8"), raw);
      }
      await test.page.getByRole("button", { name: "Hide text", exact: true }).tap();
    }
    if (spec.name === "legacy-schema1-rules") {
      // Real RAF/clock, no time or lifecycle overrides. A headless visible window
      // is a refusal regression, not PR13's headed/trusted lifecycle contract.
      const timing = await test.page.evaluate(() => new Promise(done => {
        const start = performance.now(); let frames = 0;
        function frame() { frames++; if (performance.now() - start >= 12_000) done({ elapsedMs: performance.now() - start, frames, visible: document.visibilityState }); else requestAnimationFrame(frame); }
        requestAnimationFrame(frame);
      }));
      assert(timing.elapsedMs >= 12_000 && timing.frames > 12 && timing.visible === "visible"); report.refusalWindow = timing;
    }
    assert.deepEqual(await storage(test.observer, {}, true), test.before);
    assert.deepEqual((await audit(test.page)).mutations, []);
    assert.deepEqual((await audit(test.page)).forbidden, []);
    if (spec.fault) assert((await audit(test.page)).fault);
    await test.page.reload(); await refused(test, spec.reason);
    assert.deepEqual(await storage(test.observer, {}, true), test.before);
    assert.deepEqual((await audit(test.page)).mutations, []);
    report.checks.push({ name: spec.name, passed: true, rawSHA256: Object.fromEntries(Object.entries(test.before).map(([k, v]) => [k, v === null ? null : hash(v)])) });
    await close(test);
  }

  // Real cross-tab repair observation: Retry is read only; explicit Continue
  // starts one actual worker settlement and persists that result once.
  const recovery = await setup({ main: legacySave }); await recovery.page.goto(base);
  await refused(recovery, "A saved adventure belongs to a different game version.");
  const farming = changed(fixture("Recovered", true), (profile, envelope) => {
    profile.contentVersion = envelope.contentVersion = "emberbound-content/0.4.0-c2";
  });
  await storage(recovery.observer, { main: farming });
  await recovery.page.getByRole("button", { name: "Check again (read only)", exact: true }).tap();
  await recovery.page.getByText("A compatible saved adventure was found. Select Continue to load it.", { exact: true }).waitFor();
  assert.deepEqual((await audit(recovery.page)).mutations, []);
  assert.equal((await storage(recovery.observer, {}, true)).main, farming);
  await recovery.page.getByRole("button", { name: "Continue", exact: true }).tap();
  await recovery.page.getByText("While you were away…", { exact: true }).waitFor({ timeout: 30_000 });
  const savedText = (await storage(recovery.observer, {}, true)).main;
  const saved = parseSave(savedText); assert(saved.ok);
  const original = parseSave(farming); assert(original.ok);
  assert.equal(saved.profile.stats.offlineSettlements, original.profile.stats.offlineSettlements + 1);
  assert(saved.profile.character.xp > original.profile.character.xp);
  assert(saved.profile.character.masteryXp.monk > original.profile.character.masteryXp.monk);
  assert(recovery.workers.some(url => url.includes("offline.worker")));
  const perf = await recovery.page.evaluate(() => window.__ember.perf());
  assert.equal(perf.lastCatchUp.mode, "worker");
  const writes = (await audit(recovery.page)).mutations.filter(m => m.method === "put" && m.key === paths.main);
  // FilesystemWeb rename puts main content, then puts its ctime/mtime update.
  // Both must contain the same saved bytes; exactly one temp write is one commit.
  assert.equal(writes.length, 2);
  assert(writes.every(m => m.text === savedText));
  assert.equal((await audit(recovery.page)).mutations.filter(m => m.method === "put" && m.key === paths.temp).length, 1);
  report.checks.push({ name: "retry-readonly-explicit-continue-worker-once", passed: true, worker: perf.lastCatchUp.mode, offlineSettlements: saved.profile.stats.offlineSettlements, mainWrites: writes.length });
  await close(recovery);

  // Positive calibration: create really writes to the observed backend. Two
  // synchronous DOM clicks cannot create two characters; no private session API.
  const creation = await setup({}); await creation.page.goto(base);
  const begin = creation.page.getByRole("button", { name: "Begin in Greenfields", exact: true }); await begin.waitFor();
  await begin.evaluate(button => { button.click(); button.click(); });
  await creation.page.locator(".combat-canvas").waitFor({ timeout: 20_000 });
  const created = parseSave((await storage(creation.observer, {}, true)).main); assert(created.ok);
  assert.equal(created.profile.character.name, "Adventurer");
  assert.equal((await audit(creation.page)).mutations.filter(m => m.method === "put" && m.key === paths.main).length, 2);
  assert.equal((await audit(creation.page)).mutations.filter(m => m.method === "put" && m.key === paths.temp).length, 1);
  await creation.page.getByRole("button", { name: "Challenges", exact: true }).tap();
  await creation.page.getByText("Clear Ashen Mountains to unlock this challenge.", { exact: true }).waitFor();
  assert.equal(await creation.page.getByRole("button", { name: /Challenge Tier/ }).count(), 0);
  await creation.page.getByRole("button", { name: "Adventure", exact: true }).tap();
  await creation.page.getByRole("button", { name: "Developer tools", exact: true }).tap();
  await creation.page.getByRole("button", { name: "Run determinism self-test", exact: true }).tap();
  await creation.page.getByText("ALL PASS", { exact: true }).waitFor();
  const goldens = await creation.page.locator(".selftest-row").allInnerTexts(); assert.equal(goldens.length, SELF_TEST_CASES.length); assert(goldens.every(row => row.startsWith("PASS")));
  report.checks.push({ name: "explicit-create-double-submit-readback-and-browser-goldens", passed: true, goldenCases: goldens.length });

  // Parse-valid input can still fail simulation (catalog checks are deliberately
  // outside the structural parser). Exercise the real review/confirm UI and worker
  // failure without replacing the current character or emitting success.
  const invalidSimulation = changed(fixture("Rejected", true), p => {
    p.adventure.zoneId = "unavailable-test-zone";
    p.adventure.run.zoneId = "unavailable-test-zone";
    p.adventure.run.phase = "fight";
  });
  assert(parseSave(invalidSimulation).ok);
  await creation.page.getByRole("textbox", { name: "Save text to import", exact: true }).fill(invalidSimulation);
  await creation.page.getByRole("button", { name: "Review pasted save", exact: true }).tap();
  const beforeImport = await storage(creation.observer, {}, true);
  const mutationsBeforeImport = (await audit(creation.page)).mutations.length;
  await creation.page.getByRole("button", { name: "Confirm replacement", exact: true }).tap();
  await refused(creation, "The saved adventure could not be loaded safely.");
  assert.deepEqual(await storage(creation.observer, {}, true), beforeImport);
  assert.equal((await audit(creation.page)).mutations.length, mutationsBeforeImport);
  assert.equal(await creation.page.getByText("Save loaded", { exact: true }).count(), 0);
  report.checks.push({ name: "confirmed-parse-valid-import-simulation-failure-preserves-slots", passed: true });
  await close(creation);

  const bossWall = Date.now();
  const bossProfile = createProfile(content, { name: "Ashen Test", activeClassId: "mage", alternateClassId: "monk", masterSeed: 4104, nowWallMs: bossWall });
  bossProfile.character.xp = content.levelTotals[29];
  bossProfile.character.level = 30;
  bossProfile.character.masteryXp.mage = content.masteryTotals(content.classDef("mage").masteryTrackId)[19];
  for (const item of CONTENT.items.filter(item => item.rarity === "legendary")) {
    bossProfile.equipment[item.slot] = createInstance(bossProfile, item.id, { isNew: false }).id;
  }
  const clearingProfile = cloneProfile(bossProfile);
  clearingProfile.adventure.zones.ashen_mountains.unlocked = true;
  assert(applyCommand(clearingProfile, content, { type: "startPush", zoneId: "ashen_mountains" }, { contentTimeMs: bossWall }).ok);
  const finalStage = clearingProfile.adventure.run;
  finalStage.stageIndex = content.zone("ashen_mountains").stages.length - 1;
  finalStage.phase = "fight";
  const ashenFight = prepareFight(clearingProfile, content, finalStage, { contentTimeMs: bossWall, recordEvents: false });
  assert.equal(ashenFight.summary.outcome, "victory");
  clearingProfile.clock.lastSettledWallMs = bossWall - ashenFight.summary.durationMs - 2000;
  const unlock = await setup({ main: serializeSave(clearingProfile, bossWall) });
  await unlock.page.goto(base);
  const unlockDialog = unlock.page.locator(".modal").filter({ has: unlock.page.getByRole("heading", { name: "While you were away…", exact: true }) });
  await unlockDialog.getByText("Ashen Mountains cleared!", { exact: true }).waitFor();
  await unlockDialog.getByRole("button", { name: "View Ashen King challenge", exact: true }).tap();
  await unlockDialog.waitFor({ state: "hidden" });
  await unlock.page.getByRole("button", { name: "Challenge Tier 1", exact: true }).waitFor();
  const unlocked = parseSave((await storage(unlock.observer, {}, true)).main);
  assert(unlocked.ok && unlocked.profile.adventure.zones.ashen_mountains.cleared);
  assert.equal(unlocked.profile.ashenKing, undefined);
  assert.equal(unlocked.profile.adventure.activity, "farm");
  report.checks.push({ name: "offline-ashen-clear-links-to-unstarted-ladder", passed: true });
  await close(unlock);

  Object.assign(bossProfile.adventure.zones.ashen_mountains, { unlocked: true, cleared: true, completions: 1, bestStage: 10 });
  const challenge = await setup({ main: serializeSave(bossProfile, bossWall) });
  const bossPage = challenge.page;
  const readBossSave = async () => {
    const saved = parseSave((await storage(challenge.observer, {}, true)).main);
    assert(saved.ok);
    return saved.profile;
  };
  await bossPage.clock.install({ time: bossWall });
  await bossPage.goto(base);
  await bossPage.getByRole("region", { name: "Ashen King unlocked" })
    .getByRole("button", { name: "View Ashen King challenge", exact: true }).tap();
  await bossPage.getByRole("checkbox", { name: "Auto-push after wins while online" }).check();
  await bossPage.getByRole("button", { name: "Challenge Tier 1", exact: true }).tap();
  await bossPage.getByRole("region", { name: "Ashen King tier 1 combat" }).locator(".combat-canvas").waitFor();
  const started = await readBossSave();
  assert.equal(started.schema, 4);
  assert.equal(started.ashenKing.attemptCount, 1);
  const record = started.ashenKing.active.record;
  const firstDuration = executeRecord(content, record, { recordEvents: false }).summary.durationMs;

  async function reloadAfterBossAbsence(elapsedMs) {
    const countMain = state => state.mutations.filter(m => m.method === "put" && m.key === paths.main).length;
    const writes = countMain(await audit(bossPage));
    await bossPage.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await bossPage.waitForFunction(({ writes, main }) => window.__saveAudit.mutations.filter(m => m.method === "put" && m.key === main).length >= writes + 2,
      { writes, main: paths.main });
    const saved = await readBossSave();
    await bossPage.clock.setSystemTime(saved.clock.lastSettledWallMs + elapsedMs);
    await bossPage.reload();
  }

  await reloadAfterBossAbsence(2000);
  await bossPage.getByRole("button", { name: "Watch Tier 1 in Challenges", exact: true }).waitFor();
  const resumed = await readBossSave();
  assert.deepEqual(resumed.ashenKing.active.record, record);
  assert(resumed.ashenKing.active.elapsedMs > started.ashenKing.active.elapsedMs);
  await reloadAfterBossAbsence(firstDuration + 2000);
  await bossPage.getByRole("button", { name: "View Challenges", exact: true }).tap();
  await bossPage.getByText("Tier 1 cleared", { exact: true }).waitFor();
  await bossPage.getByText("Rank 1 · +3% Attack", { exact: true }).waitFor();
  const cleared = await readBossSave();
  assert.equal(cleared.ashenKing.highestClearedTier, 1);
  assert.equal(cleared.ashenKing.attemptCount, 1);
  assert.equal(cleared.ashenKing.active, null);
  assert.equal(cleared.adventure.run.mode, "farm");

  await bossPage.getByRole("checkbox", { name: "Auto-push after wins while online" }).check();
  await bossPage.getByRole("button", { name: "Challenge Tier 2", exact: true }).tap();
  await bossPage.getByRole("region", { name: "Ashen King tier 2 combat" }).waitFor();
  const tierTwo = (await readBossSave()).ashenKing.active.record;
  const tierTwoDuration = executeRecord(content, tierTwo, { recordEvents: false }).summary.durationMs;
  await bossPage.getByRole("button", { name: "Character", exact: true }).tap();
  await bossPage.clock.runFor(tierTwoDuration + 1000);
  await bossPage.getByRole("button", { name: "Challenges", exact: true }).tap();
  await bossPage.getByRole("region", { name: "Ashen King tier 3 combat" }).waitFor();
  const chained = await readBossSave();
  assert.equal(chained.ashenKing.highestClearedTier, 2);
  assert.equal(chained.ashenKing.active.record.encounter.tier, 3);
  report.checks.push({ name: "ashen-king-entry-resume-offline-milestone-and-online-auto-push", passed: true });
  await close(challenge);

  const [season, nextSeason] = [...content.seasons.values()];
  const c5Wall = season.startMs + 60_000;
  const c5Profile = cloneProfile(bossProfile);
  c5Profile.createdAtWallMs = c5Wall;
  c5Profile.clock.lastSettledWallMs = c5Wall;
  const c5 = await setup({ main: serializeSave(c5Profile, c5Wall) });
  const c5Page = c5.page;
  const readC5 = async () => {
    const saved = parseSave((await storage(c5.observer, {}, true)).main);
    assert(saved.ok);
    return saved.profile;
  };
  await c5Page.clock.install({ time: c5Wall });
  await c5Page.goto(base);
  await c5Page.getByRole("button", { name: "Challenges", exact: true }).tap();
  const trials = c5Page.getByRole("region", { name: "Promotion trials" });
  assert(await trials.getByRole("button", { name: "Enter Ascendant Trial" }).isDisabled());
  await trials.getByRole("button", { name: "Enter Arcanist Trial" }).tap();
  await c5Page.getByRole("region", { name: "Arcanist Trial combat" }).waitFor();
  const promotion = await readC5();
  assert.equal(promotion.schema, 5);
  const trialRecord = promotion.longTerm.ladders.trial_mage.active.record;
  const trialDuration = executeRecord(content, trialRecord, { recordEvents: false }).summary.durationMs;
  await c5Page.getByRole("button", { name: "Character", exact: true }).tap();
  await c5Page.clock.runFor(trialDuration + 1000);
  await c5Page.getByText("Arcanist promotion · +10% Attack", { exact: true }).waitFor();
  assert.equal((await readC5()).longTerm.ladders.trial_mage.highestClearedTier, 1);

  await c5Page.getByRole("button", { name: "Challenges", exact: true }).tap();
  const seasons = c5Page.getByRole("region", { name: "Seasons" });
  await seasons.getByRole("heading", { name: season.name }).waitFor();
  await seasons.getByRole("button", { name: "Challenge seasonal Tier 1" }).tap();
  await c5Page.getByRole("region", { name: `${season.boss.name} combat` }).waitFor();
  const seasonal = await readC5();
  const seasonalRecord = seasonal.longTerm.ladders[season.boss.id].active.record;
  assert.deepEqual(seasonalRecord.activeRuleIds, [season.rule.id]);
  assert.equal(seasonalRecord.build.promoted, true);
  const seasonDuration = executeRecord(content, seasonalRecord, { recordEvents: false }).summary.durationMs;
  await c5Page.getByRole("button", { name: "Character", exact: true }).tap();
  await c5Page.clock.runFor(seasonDuration + 1000);
  await c5Page.getByRole("button", { name: "Challenges", exact: true }).tap();
  await seasons.getByText(`${season.relicName} · Rank 1 · +3% Attack in this ladder`, { exact: true }).waitFor();
  assert(await seasons.getByRole("button", { name: /Tier 2 opens/ }).isDisabled());
  // Model an absence, as in the boss reload check above. Moving Date.now while
  // the foreground clock still runs can settle the new wall time before reload,
  // legitimately leaving no offline dialog for this assertion to find.
  const rolloverWrites = (await audit(c5Page)).mutations.filter(m => m.method === "put" && m.key === paths.main).length;
  await c5Page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await c5Page.waitForFunction(({ writes, main }) => window.__saveAudit.mutations.filter(m => m.method === "put" && m.key === main).length >= writes + 2,
    { writes: rolloverWrites, main: paths.main });
  assert((await readC5()).clock.lastSettledWallMs < nextSeason.startMs);
  await c5Page.clock.setSystemTime(nextSeason.startMs + 1);
  await c5Page.reload();
  const offlineModal = c5Page.locator(".modal").filter({ hasText: "While you were away" });
  await offlineModal.getByRole("button", { name: "Continue", exact: true }).tap();
  await c5Page.getByRole("button", { name: "Challenges", exact: true }).tap();
  await seasons.getByRole("heading", { name: nextSeason.name }).waitFor();
  await seasons.getByText(`${nextSeason.relicName} · Rank 0 · +0% Attack in this ladder`, { exact: true }).waitFor();
  await seasons.getByText(`${season.name} · ${season.titles[0]}`, { exact: true }).waitFor();
  report.checks.push({ name: "promotion-and-season-reward-save-tier-cadence-and-rollover", passed: true });
  await close(c5);

  const menu = await setup({ main: fixture("Backup Tester") });
  const menuPage = menu.page;
  await menuPage.goto(base);
  const navigation = menuPage.getByRole("navigation", { name: "Game navigation" });
  await navigation.waitFor();
  assert.deepEqual(await navigation.getByRole("button").allTextContents(), ["Character", "Gear", "Adventure", "Challenges", "Menu"]);
  await navigation.getByRole("button", { name: "Character", exact: true }).tap();
  assert.equal(await menuPage.getByRole("button", { name: "Open online adventure" }).count(), 0);
  await navigation.getByRole("button", { name: "Menu", exact: true }).tap();
  await menuPage.getByText("Online Play is temporarily disabled.", { exact: true }).waitFor();
  assert.equal(await navigation.getByRole("button", { name: "Menu", exact: true }).getAttribute("aria-current"), "page");
  const downloadPending = menuPage.waitForEvent("download");
  await menuPage.getByRole("button", { name: "Back up save", exact: true }).tap();
  const downloaded = await downloadPending;
  assert.match(downloaded.suggestedFilename(), /^Wyrdholt-Backup-\d{4}-\d{2}-\d{2}\.json$/);
  const backup = readFileSync(await downloaded.path());
  const decoded = parseSave(backup.toString("utf8"));
  assert(decoded.ok && decoded.profile.character.name === "Backup Tester");

  await menuPage.getByRole("button", { name: /^Encyclopedia/ }).tap();
  const encyclopedia = menuPage.getByRole("main", { name: "Encyclopedia" });
  await encyclopedia.getByText("Mage", { exact: true }).tap();
  await encyclopedia.getByText("Arcane Ward", { exact: true }).waitFor();
  await encyclopedia.getByRole("button", { name: "Bestiary", exact: true }).tap();
  await encyclopedia.getByRole("searchbox", { name: "Search bestiary" }).fill("wolf");
  await encyclopedia.getByText("Field Wolf", { exact: true }).tap();
  await encyclopedia.getByText("Appears in Greenfields.", { exact: true }).waitFor();
  await encyclopedia.getByRole("button", { name: "Back to menu" }).tap();

  await menuPage.getByText("Restore backup", { exact: true }).tap();
  await menuPage.getByLabel("Or paste backup text").fill(fixture("Restore Tester"));
  await menuPage.getByRole("button", { name: "Review backup text", exact: true }).tap();
  await menuPage.getByText("Restore Tester · Level 1", { exact: true }).waitFor();
  const beforeRestore = parseSave((await storage(menu.observer, {}, true)).main);
  assert(beforeRestore.ok && beforeRestore.profile.character.name === "Backup Tester");
  await menuPage.getByRole("button", { name: "Confirm restore", exact: true }).tap();
  await navigation.getByRole("button", { name: "Adventure", exact: true }).and(menuPage.locator('[aria-current="page"]')).waitFor();
  const replaced = parseSave((await storage(menu.observer, {}, true)).main);
  assert(replaced.ok && replaced.profile.character.name === "Restore Tester");
  await navigation.getByRole("button", { name: "Menu", exact: true }).tap();

  await menuPage.getByRole("button", { name: "Restart save", exact: true }).tap();
  await menuPage.getByRole("button", { name: "Cancel restart", exact: true }).tap();
  assert(parseSave((await storage(menu.observer, {}, true)).main).ok);
  await menuPage.getByRole("button", { name: "Restart save", exact: true }).tap();
  await menuPage.getByRole("button", { name: "Confirm restart", exact: true }).tap();
  await menuPage.getByRole("button", { name: "Begin in Greenfields", exact: true }).waitFor();
  const empty = await storage(menu.observer, {}, true);
  assert.deepEqual(empty, { main: null, temp: null, backup: null });
  assert.equal(await menuPage.getByRole("button", { name: "Open online adventure" }).count(), 0);

  await menuPage.getByRole("button", { name: "Restore a backup", exact: true }).tap();
  const restore = menuPage.getByRole("dialog", { name: "Restore a backup" });
  const picker = restore.getByLabel("Choose a Wyrdholt backup file");
  await picker.setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from("{}") });
  await restore.getByText("This backup is invalid or uses an incompatible game version.").waitFor();
  assert.equal((await storage(menu.observer, {}, true)).main, null);
  await picker.setInputFiles({ name: downloaded.suggestedFilename(), mimeType: "application/json", buffer: backup });
  await restore.getByText("Backup Tester · Level 1", { exact: true }).waitFor();
  assert.equal((await storage(menu.observer, {}, true)).main, null);
  await restore.getByRole("button", { name: "Confirm restore", exact: true }).tap();
  await menuPage.getByRole("navigation", { name: "Game navigation" }).waitFor();
  const restored = parseSave((await storage(menu.observer, {}, true)).main);
  assert(restored.ok && restored.profile.character.name === "Backup Tester");
  report.checks.push({ name: "player-menu-backup-download-restart-restore-and-encyclopedia", passed: true });
  await close(menu);

  const failed = await setup({}, "write"); await failed.page.goto(base);
  await failed.page.getByRole("button", { name: "Begin in Greenfields", exact: true }).tap();
  await refused(failed, "The saved adventure could not be read or written reliably.");
  assert((await audit(failed.page)).fault);
  assert.deepEqual(await storage(failed.observer, {}, true), failed.before);
  assert.equal(await failed.page.getByText(/Save loaded|Character created/).count(), 0);
  report.checks.push({ name: "injected-real-idb-write-failure-no-false-success", passed: true });
  await close(failed);
  assert.deepEqual(report.errors, []); report.passed = true;
} catch (error) {
  report.failure = String(error?.stack ?? error);
} finally {
  try { for (const context of contexts) await context.close(); await browser?.close(); }
  catch (error) { report.passed = false; report.cleanupFailure = String(error); }
  if (server.listening) await new Promise(done => server.close(done));
  if (report.errors.length) report.passed = false;
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2)); process.exitCode = report.passed ? 0 : 1;
}
