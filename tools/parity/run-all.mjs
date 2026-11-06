#!/usr/bin/env node
/**
 * Migration gate A: run the determinism self-test in every available engine
 * and require identical hashes everywhere (and equal to the golden file).
 * Writes tools/parity/out/parity-report.md and parity-report.json.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const outDir = fileURLToPath(new URL("./out/", import.meta.url));
const windows = process.platform === "win32";
const bun = process.env.BUN_EXECUTABLE ?? (existsSync(`${root}.local-tools/node_modules/bun/bin/bun.exe`) ? `${root}.local-tools/node_modules/bun/bin/bun.exe` : "bun");
const steps = windows ? [
  { engine: "node-v8", cmd: process.execPath, args: ["--import", "tsx", "tools/parity/run-node.ts"] },
  { engine: "bun-jsc", cmd: bun, args: ["tools/parity/run-node.ts", "--engine=bun-jsc"] },
  { engine: "webkit-playwright", cmd: process.execPath, args: ["tools/parity/windows-browser.mjs"] },
  { engine: "chromium-v8", reuse: true },
] : [
  { engine: "node-v8", cmd: "npx", args: ["tsx", "tools/parity/run-node.ts"] },
  { engine: "bun-jsc", cmd: "bun", args: ["tools/parity/run-node.ts", "--engine=bun-jsc"] },
  { engine: "webkit-webkitgtk", cmd: "node", args: ["tools/parity/run-webkit.mjs", "--only=webkit"] },
  { engine: "chromium-v8", cmd: "node", args: ["tools/parity/run-webkit.mjs", "--only=chromium"] },
];

// Reject stale reports, including when an engine exits before writing output.
for (const step of steps) {
  const file = `${outDir}${step.engine}.json`;
  if (existsSync(file)) unlinkSync(file);
}
if (windows) {
  const bundle = spawnSync(bun, ["build", "tools/parity/browser-entry.ts", "--target=browser", "--format=iife", `--outfile=${outDir}parity-browser.js`], {cwd: root, stdio: "inherit"});
  if (bundle.status !== 0) process.exit(1);
}
const reports = [];
for (const step of steps) {
  console.log(`\n=== ${step.engine} ===`);
  const res = step.reuse ? {status: 0} : spawnSync(step.cmd, step.args, { cwd: root, stdio: "inherit" });
  const file = `${outDir}${step.engine}.json`;
  if (res.status !== 0 || !existsSync(file)) {
    reports.push({ engine: step.engine, missing: true, pass: false, results: [] });
    continue;
  }
  reports.push(JSON.parse(readFileSync(file, "utf8")));
}

const golden = JSON.parse(readFileSync(`${root}packages/game-core/src/selftest/golden.json`, "utf8"));
const ids = Object.keys(golden.cases);
const rows = ids.map((id) => {
  const hashes = reports.map((r) => r.results?.find((x) => x.id === id)?.actual ?? "—");
  const identical = hashes.every((h) => h === golden.cases[id]);
  return { id, golden: golden.cases[id], hashes, identical };
});
const allPass = reports.every((r) => r.pass && !r.missing) && rows.every((r) => r.identical);

const lines = [
  `# Determinism parity report`,
  ``,
  `Generated: ${new Date().toISOString()}`,
  `Rules: \`${golden.rulesVersion}\` · Content: \`${golden.contentVersion}\` · Content hash: \`${golden.contentHash.slice(0, 16)}…\``,
  ``,
  `**Gate A result: ${allPass ? "PASS — identical complete results in every engine" : "FAIL"}**`,
  ``,
  `## Engines`,
  ``,
  `| Engine | Version | Result |`,
  `|---|---|---|`,
  ...reports.map((r) => `| ${r.engine} | ${r.version ?? "not run"} | ${r.missing ? "NOT RUN" : r.pass ? "PASS" : "FAIL"} |`),
  ``,
  `## Cases (first 12 hex chars of SHA-256 over inputs + full event stream + final state)`,
  ``,
  `| Case | Golden | ${reports.map((r) => r.engine).join(" | ")} | Identical |`,
  `|---|---|${reports.map(() => "---").join("|")}|---|`,
  ...rows.map((r) => `| ${r.id} | \`${r.golden.slice(0, 12)}\` | ${r.hashes.map((h) => `\`${String(h).slice(0, 12)}\``).join(" | ")} | ${r.identical ? "yes" : "**NO**"} |`),
  ``,
];
writeFileSync(`${outDir}parity-report.md`, lines.join("\n"));
writeFileSync(`${outDir}parity-report.json`, JSON.stringify({ allPass, reports, rows }, null, 2));
console.log(`\n${lines.slice(0, 20).join("\n")}`);
process.exit(allPass ? 0 : 1);
