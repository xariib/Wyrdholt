#!/usr/bin/env node
/**
 * Parity gate in real browser engines:
 *  - WebKit: WebKitGTK MiniBrowser via WebKitWebDriver (JavaScriptCore + WebKit), under Xvfb
 *  - Chromium: Playwright (V8, browser build)
 *
 * The self-test is bundled with Bun into a single script, served over HTTP,
 * executed in each browser, and the results are written to tools/parity/out/.
 *
 *   node tools/parity/run-webkit.mjs [--only=webkit|chromium]
 */
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const outDir = fileURLToPath(new URL("./out/", import.meta.url));
mkdirSync(outDir, { recursive: true });
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);

const bundle = `${outDir}parity-browser.js`;
const build = spawnSync("bun", ["build", "tools/parity/browser-entry.ts", "--target=browser", "--format=iife", `--outfile=${bundle}`], {
  cwd: root,
  stdio: "inherit",
});
if (build.status !== 0) throw new Error("bundle failed");

const html = `<!doctype html><html><head><meta charset="utf-8"><title>parity</title></head><body>running…<script src="/parity.js"></script></body></html>`;
const server = createServer((req, res) => {
  if (req.url === "/parity.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(readFileSync(bundle));
  } else {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html);
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/`;

async function pollResult(getter) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const value = await getter();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("timed out waiting for parity results");
}

function save(engine, version, data) {
  const report = { engine, version, ...data };
  writeFileSync(`${outDir}${engine}.json`, `${JSON.stringify(report, null, 2)}\n`);
  for (const r of data.results ?? []) {
    console.log(`${r.pass ? "PASS" : "FAIL"} ${r.id.padEnd(30)} ${String(r.actual).slice(0, 16)} ${Number(r.ms).toFixed(1)}ms ${r.error ?? ""}`);
  }
  console.log(`${engine}: ${data.pass ? "ALL PASS" : "FAILED"} — ${version}`);
  return data.pass === true;
}

let ok = true;

async function runWebKit() {
  const port = 4444 + Math.floor(Math.random() * 500);
  // Detached process group so Xvfb, the driver and MiniBrowser all stop together.
  const xvfb = spawn("xvfb-run", ["-a", "WebKitWebDriver", `--port=${port}`], { stdio: "ignore", detached: true });
  try {
    await new Promise((r) => setTimeout(r, 2_500));
    const { Builder, Capabilities } = await import("selenium-webdriver");
    const caps = new Capabilities();
    caps.setBrowserName("MiniBrowser");
    caps.set("webkitgtk:browserOptions", {
      binary: "/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser",
      // MiniBrowser 2.52 has no --headless flag; Xvfb provides the display.
      args: ["--automation"],
    });
    const driver = await new Builder().usingServer(`http://127.0.0.1:${port}`).withCapabilities(caps).build();
    try {
      await driver.get(url);
      const data = await pollResult(() => driver.executeScript("return window.__PARITY__ || null"));
      const version = `WebKitGTK MiniBrowser — ${data.userAgent ?? "unknown UA"}`;
      ok = save("webkit-webkitgtk", version, data) && ok;
    } finally {
      await driver.quit();
    }
  } finally {
    try {
      process.kill(-xvfb.pid, "SIGTERM");
    } catch {
      xvfb.kill("SIGTERM");
    }
  }
}

async function runChromium() {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(url);
    const data = await pollResult(() => page.evaluate(() => window.__PARITY__ || null));
    ok = save("chromium-v8", `Chromium ${browser.version()} — ${data.userAgent}`, data) && ok;
  } finally {
    await browser.close();
  }
}

try {
  if (!only || only === "webkit") await runWebKit();
  if (!only || only === "chromium") await runChromium();
} catch (error) {
  console.error(error);
  ok = false;
} finally {
  server.close();
}
process.exit(ok ? 0 : 1);
