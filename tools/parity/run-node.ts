/**
 * Runs the determinism self-test in the current JS engine and writes
 * tools/parity/out/<engine>.json. Works under Node (V8) and Bun (JavaScriptCore).
 *
 *   npx tsx tools/parity/run-node.ts
 *   bun tools/parity/run-node.ts --engine=bun-jsc
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CONTENT } from "@emberbound/game-content";
import { ContentIndex, GOLDEN, RULES_VERSION, goldenMatches, runSelfTest, type GoldenFile } from "@emberbound/game-core";

const arg = process.argv.find((a) => a.startsWith("--engine="));
const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
const engine = arg ? arg.slice("--engine=".length) : isBun ? "bun-jsc" : "node-v8";
const version = isBun
  ? `Bun ${(globalThis as unknown as { Bun: { version: string } }).Bun.version} (JavaScriptCore)`
  : `Node ${process.version} (V8 ${process.versions.v8})`;

const content = new ContentIndex(CONTENT);
const golden = GOLDEN as GoldenFile;
const mismatch = goldenMatches(golden, content, RULES_VERSION);
const results = runSelfTest(content, golden, () => performance.now());
const report = {
  engine,
  version,
  contentHash: content.hash,
  goldenProblem: mismatch,
  pass: mismatch === null && results.every((r) => r.pass),
  results,
};
const outDir = fileURLToPath(new URL("./out/", import.meta.url));
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}${engine}.json`, `${JSON.stringify(report, null, 2)}\n`);
for (const r of results) {
  console.log(`${r.pass ? "PASS" : "FAIL"} ${r.id.padEnd(30)} ${r.actual.slice(0, 16)} ${r.ms.toFixed(1)}ms ${r.error ?? ""}`);
}
console.log(`${engine}: ${report.pass ? "ALL PASS" : "FAILED"} — ${version}`);
process.exit(report.pass ? 0 : 1);
