#!/usr/bin/env node
/**
 * Blocker B2: game-core must not depend on React, PixiJS, DOM/browser APIs,
 * Node APIs or Capacitor, and must not use Math.random or wall-clock time.
 * (Type-checking game-core with lib ES2022 and no ambient types is the second guard.)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const roots = ["packages/game-core/src", "packages/game-content/src", "packages/shared-types/src"].map((p) =>
  fileURLToPath(new URL(`../${p}`, import.meta.url)),
);
const allowedImports = [/^\.{1,2}\//, /^@emberbound\/shared-types$/];
const allowedByPackage = { "game-content": allowedImports, "game-core": allowedImports, "shared-types": [/^\.{1,2}\//] };
const forbiddenTokens = [
  [/\bMath\.random\b/, "Math.random"],
  [/\bDate\.now\b|\bnew Date\b/, "wall-clock Date"],
  [/\bperformance\.now\b/, "performance.now"],
  [/\b(window|document|navigator|localStorage|sessionStorage|indexedDB)\b\s*[.[]/, "browser global"],
  [/\bprocess\.(env|argv|hrtime)/, "Node process"],
  [/\bMath\.(sin|cos|tan|asin|acos|atan|atan2|exp|expm1|log|log1p|log2|log10|pow|cbrt|hypot|sinh|cosh|tanh)\b/, "implementation-approximated Math function"],
  [/\*\*/, "exponent operator (implementation-approximated)"],
  [/\bTextEncoder\b|\bcrypto\./, "platform API"],
  [/\bsetTimeout\b|\bsetInterval\b|\brequestAnimationFrame\b/, "timer"],
];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith(".ts") ? [full] : [];
  });
}

const problems = [];
for (const root of roots) {
  const pkg = root.replaceAll("\\", "/").split("/packages/")[1].split("/")[0];
  const allowed = allowedByPackage[pkg];
  for (const file of walk(root)) {
    const text = readFileSync(file, "utf8");
    const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const m of code.matchAll(/(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
      const spec = m[1] ?? m[2];
      if (!allowed.some((re) => re.test(spec))) problems.push(`${file}: forbidden import "${spec}"`);
    }
    for (const [re, label] of forbiddenTokens) {
      if (re.test(code)) problems.push(`${file}: ${label}`);
    }
  }
}
if (problems.length) {
  console.error("game-core purity check FAILED:\n" + problems.map((p) => `  - ${p}`).join("\n"));
  process.exit(1);
}
console.log(`game-core purity check passed (${roots.length} packages scanned).`);
