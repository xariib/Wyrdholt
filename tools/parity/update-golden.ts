/**
 * Regenerate packages/game-core/src/selftest/golden.json from Node.
 * Run ONLY after an intentional rules/content change, then commit the result
 * and bump RULES_VERSION or the content version.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CONTENT } from "@emberbound/game-content";
import { ContentIndex, RULES_VERSION, runSelfTest, type GoldenFile } from "@emberbound/game-core";

const content = new ContentIndex(CONTENT);
const results = runSelfTest(content, null, () => performance.now());
const failed = results.filter((r) => r.error);
if (failed.length > 0) {
  for (const f of failed) console.error(`${f.id}: ${f.error}`);
  process.exit(1);
}
const golden: GoldenFile = {
  rulesVersion: RULES_VERSION,
  contentVersion: content.snapshot.contentVersion,
  contentHash: content.hash,
  generatedBy: `node ${process.version}`,
  cases: Object.fromEntries(results.map((r) => [r.id, r.actual])),
};
const target = fileURLToPath(new URL("../../packages/game-core/src/selftest/golden.json", import.meta.url));
writeFileSync(target, `${JSON.stringify(golden, null, 2)}\n`);
console.log(`Wrote ${results.length} golden hashes to ${target}`);
for (const r of results) console.log(`  ${r.id.padEnd(30)} ${r.actual.slice(0, 16)}  ${r.detail}`);
