/**
 * One-off capture of the C1 equivalence fixtures (run on the C1 engine only).
 * Writes packages/game-core/test/fixtures/c1-content.json, c1-golden.json and c1-equivalence.json.
 */
import { copyFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CONTENT } from "@emberbound/game-content";
import { ContentIndex, RULES_VERSION } from "@emberbound/game-core";
import { C1_EQUIVALENCE_CASES } from "../../packages/game-core/test/c1-equivalence-cases";

const dir = fileURLToPath(new URL("../../packages/game-core/test/fixtures/", import.meta.url));
const content = new ContentIndex(CONTENT);
writeFileSync(`${dir}c1-content.json`, `${JSON.stringify(CONTENT)}\n`);
copyFileSync(fileURLToPath(new URL("../../packages/game-core/src/selftest/golden.json", import.meta.url)), `${dir}c1-golden.json`);
const cases = Object.fromEntries(C1_EQUIVALENCE_CASES.map((c) => [c.id, c.run(content)]));
writeFileSync(
  `${dir}c1-equivalence.json`,
  `${JSON.stringify({ rulesVersion: RULES_VERSION, contentVersion: CONTENT.contentVersion, contentHash: content.hash, cases }, null, 2)}\n`,
);
console.log(cases);
