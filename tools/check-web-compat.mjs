#!/usr/bin/env node
/**
 * Web-compatibility guard for the oldest WebView we have seen on a test phone.
 *
 * Samsung A40 (performance floor) runs Android System WebView 97 (device finding F5).
 * Vite's `build.target: "es2022"` keeps the syntax compatible (ES2022 is fully
 * supported by Chrome 97), but it does not polyfill runtime APIs or CSS features.
 * This script fails the web build if the bundle uses one of the known newer ones.
 *
 * Extend the lists when a newer API is found to break on a device.
 *
 *   node tools/check-web-compat.mjs [distDir]
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const FLOOR = "Chrome/WebView 97";
const dist = process.argv[2] ?? fileURLToPath(new URL("../apps/mobile/dist/assets/", import.meta.url));

/** [pattern, feature, first Chrome version] */
const JS_DENY = [
  [/\bstructuredClone\s*\(/, "structuredClone()", 98],
  [/\.toSorted\s*\(/, "Array.prototype.toSorted", 110],
  [/\.toReversed\s*\(/, "Array.prototype.toReversed", 110],
  [/\.toSpliced\s*\(/, "Array.prototype.toSpliced", 110],
  [/\bObject\.groupBy\b/, "Object.groupBy", 117],
  [/\bMap\.groupBy\b/, "Map.groupBy", 117],
  [/\bPromise\.withResolvers\b/, "Promise.withResolvers", 119],
  [/\bArray\.fromAsync\b/, "Array.fromAsync", 121],
  [/\.isWellFormed\s*\(/, "String.prototype.isWellFormed", 111],
  [/\.(union|intersection|symmetricDifference|isSubsetOf|isSupersetOf|isDisjointFrom)\s*\(\s*new Set/, "Set methods", 122],
  [/\bAbortSignal\.any\b/, "AbortSignal.any", 116],
];
const CSS_DENY = [
  [/:has\(/, ":has()", 105],
  [/\d(dvh|svh|lvh|dvw|svw|lvw)\b/, "dynamic viewport units", 108],
  [/color-mix\(/, "color-mix()", 111],
  [/@container\b/, "container queries", 105],
  [/text-wrap\s*:/, "text-wrap", 114],
  [/@layer\b/, "cascade layers", 99],
];

const problems = [];
let files = 0;
for (const name of readdirSync(dist)) {
  const list = name.endsWith(".js") ? JS_DENY : name.endsWith(".css") ? CSS_DENY : null;
  if (!list) continue;
  files += 1;
  const text = readFileSync(join(dist, name), "utf8");
  for (const [pattern, feature, chrome] of list) {
    if (pattern.test(text)) problems.push(`${name}: ${feature} (needs Chrome ${chrome}+)`);
  }
}

if (problems.length) {
  console.error(`Web compatibility check FAILED for ${FLOOR}:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`Web compatibility check passed for ${FLOOR} (${files} JS/CSS files).`);
