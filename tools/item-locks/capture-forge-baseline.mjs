// Capture exact PR22 Forge behavior without rewriting its historical C2 golden.
// node tools/item-locks/capture-forge-baseline.mjs [output.json]
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { build } from "esbuild";

const sourceCommit = "256688d9d875ada8490e3fc1bbaa3cff4968f631";
const output = resolve(process.argv[2] ?? "docs/project/tasks/evidence/ITEM-LOCKS-007/forge-pr22-baseline.json");
const snapshot = mkdtempSync("/tmp/wyrdholt-locks-pr22-");
const archive = execFileSync("git", ["archive", sourceCommit, "packages", "tools/parity/forge-vector.ts", "tsconfig.json", "tsconfig.base.json", "package.json"], { maxBuffer: 16 * 1024 * 1024 });
execFileSync("tar", ["-x", "-C", snapshot], { input: archive });
const artifact = join(snapshot, "forge-baseline.mjs");
await build({ entryPoints: [join(snapshot, "tools/parity/forge-vector.ts")], bundle: true, platform: "node", format: "esm", outfile: artifact,
  alias: Object.fromEntries(["shared-types", "game-core", "game-content"].map(name => [`@emberbound/${name}`, join(snapshot, `packages/${name}/src/index.ts`)])) });
const { forgeVector } = await import(artifact);
const result = { sourceCommit, ...forgeVector() };
const text = JSON.stringify(result, null, 2) + "\n";
if (existsSync(output)) assert.equal(readFileSync(output, "utf8"), text, "Preserve the previously captured baseline");
else writeFileSync(output, text);
console.log(text);
