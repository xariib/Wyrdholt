#!/usr/bin/env node
/**
 * Turns apps/mobile/dist (the normal Vite build) into a page fragment for a host
 * that supplies its own <head>/<body> (the private claude.ai Artifact host used for
 * the Phase B preview). The game code and assets are the unchanged build output.
 *
 * Output: apps/mobile/dist-preview/index.html and dist-preview/files.json
 * (published path -> source path, source maps excluded).
 *
 * For a normal static host (Netlify, Cloudflare Pages, GitHub Pages, any HTTPS
 * server) deploy apps/mobile/dist as-is instead — see docs/technical/BUILD_AND_DEPLOY.md.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../apps/mobile/", import.meta.url));
const dist = `${root}dist/`;
const out = `${root}dist-preview/`;
mkdirSync(out, { recursive: true });

const html = readFileSync(`${dist}index.html`, "utf8");
const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g)].map((m) => m[1]);
const styles = [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)].map((m) => m[1]);
const buildId = (readFileSync(`${dist}${scripts[0].replace("./", "")}`, "utf8").match(/EMB-[0-9A-Za-z.\-]+/) ?? ["unknown"])[0];

const page = [
  `<title>Wyrdholt: Idle — Test Build</title>`,
  ...styles.map((href) => `<link rel="stylesheet" href="${href}">`),
  `<div id="root"></div>`,
  `<noscript>Wyrdholt: Idle needs JavaScript.</noscript>`,
  ...scripts.map((src) => `<script type="module" src="${src}"></script>`),
  `<!-- build ${buildId} -->`,
  "",
].join("\n");
writeFileSync(`${out}index.html`, page);

const files = {};
for (const name of readdirSync(`${dist}assets`)) {
  if (name.endsWith(".map")) continue;
  const entry = { from: `apps/mobile/dist/assets/${name}` };
  if (name.endsWith(".woff2")) entry.contentType = "font/woff2";
  else if (name.endsWith(".woff")) entry.contentType = "font/woff";
  files[`assets/${name}`] = entry;
}
writeFileSync(`${out}files.json`, JSON.stringify(files, null, 2));
console.log(page);
console.log(`${Object.keys(files).length} supporting files; build ${buildId}`);
