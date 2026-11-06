#!/usr/bin/env node
/**
 * Serves the preview fragment (dist-preview) wrapped in a minimal skeleton under a
 * strict CSP without 'unsafe-eval', then checks the app boots, renders combat and
 * passes the determinism self-test. Mirrors a locked-down preview host.
 */
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../../apps/mobile/", import.meta.url));
// Rebuild the wrapper for the current hashed assets; never test a stale fragment.
execFileSync(process.execPath, [fileURLToPath(new URL("../deploy/prepare-preview.mjs", import.meta.url))]);
const fragment = readFileSync(join(root, "dist-preview/index.html"), "utf8");
const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><link rel="icon" href="./brand/I0_32_native.png" type="image/png"></head><body>${fragment}</body></html>`;
const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self'";
const types = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".woff": "font/woff" };
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.writeHead(200, { "content-type": "text/html", "content-security-policy": csp });
    return res.end(page);
  }
  const file = join(root, "dist", url.pathname);
  if (!existsSync(file)) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream", "content-security-policy": csp });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const p = await ctx.newPage();
const errors = [];
const resourceFailures = [];
p.on("response", (r) => { if (r.status() >= 400) resourceFailures.push({ url: r.url(), status: r.status() }); });
p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
p.on("pageerror", (e) => errors.push(String(e)));
await p.goto(base);
await p.getByText("Begin in Greenfields").tap({ timeout: 15000 });
await p.locator(".combat-canvas").waitFor({ timeout: 15000 });
await p.waitForTimeout(2500);
const comboFailed = await p.getByText("Combat view unavailable").count();
await p.getByRole("button", { name: "Developer tools" }).tap();
const rendererLine = await p.locator(".mono").filter({ hasText: "renderer" }).first().innerText();
await p.getByText("Run determinism self-test").tap();
await p.getByText(/ALL PASS|FAIL/).first().waitFor({ timeout: 60000 });
const pass = (await p.getByText("ALL PASS").count()) > 0;
await p.getByText("Benchmark 8-hour catch-up").tap();
await p.getByText("While you were away").waitFor({ timeout: 60000 });
const bench = await p.locator(".modal .mono").filter({ hasText: "catch-up" }).last().innerText();
await p.screenshot({ path: fileURLToPath(new URL("./out/strict-csp.png", import.meta.url)) });
await browser.close();
server.close();
const result = { combatViewFailed: comboFailed > 0, rendererLine: rendererLine.split("\n").find((l) => l.startsWith("renderer")), selftestAllPass: pass, bench, cspErrors: errors, resourceFailures };
console.log(JSON.stringify(result, null, 2));
process.exit(!result.combatViewFailed && pass && errors.length === 0 && resourceFailures.length === 0 ? 0 : 1);
