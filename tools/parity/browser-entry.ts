/**
 * Browser bundle for the parity gate: runs the same self-test inside a real
 * browser engine and publishes the results on window.__PARITY__.
 */
import { CONTENT } from "@emberbound/game-content";
import { ContentIndex, GOLDEN, RULES_VERSION, goldenMatches, runSelfTest, type GoldenFile } from "@emberbound/game-core";

declare global {
  interface Window {
    __PARITY__?: unknown;
  }
}

try {
  const content = new ContentIndex(CONTENT);
  const golden = GOLDEN as GoldenFile;
  const problem = goldenMatches(golden, content, RULES_VERSION);
  const results = runSelfTest(content, golden, () => performance.now());
  window.__PARITY__ = {
    userAgent: navigator.userAgent,
    contentHash: content.hash,
    goldenProblem: problem,
    pass: problem === null && results.every((r) => r.pass),
    results,
  };
  document.body.textContent = results.map((r) => `${r.pass ? "PASS" : "FAIL"} ${r.id}`).join("\n");
} catch (error) {
  window.__PARITY__ = { error: String(error), pass: false, results: [] };
}
