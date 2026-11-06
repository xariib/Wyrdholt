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
import { ContentIndex, SELF_TEST_CASES, createProfile, applyCommand, serializeSave, parseSave, sha256Hex } from "@emberbound/game-core";

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
    { name: "unsupported-main", slots: { main: changed(valid, (p, e) => { p.schema = 4; e.schema = 4; }), backup: valid }, reason: "A saved adventure uses a version this build cannot open." },
    { name: "corrupt-sidefile", slots: { main: valid, temp: "not a save", backup: valid }, reason: "A saved adventure could not be read as a valid save." },
    { name: "malformed-profile", slots: { main: changed(valid, p => { delete p.clock; }), backup: valid }, reason: "A saved adventure could not be read as a valid save." },
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
