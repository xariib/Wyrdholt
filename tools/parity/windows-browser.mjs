import { chromium, webkit } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const out = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL("./out/", import.meta.url));
const source = readFileSync(join(out, "parity-browser.js"));
const html = '<!doctype html><meta charset="utf-8"><body><script src="/code.js"></script></body>';
const server = createServer((req, res) => {
  const script = req.url === "/code.js";
  res.setHeader("Content-Type", script ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8");
  res.end(script ? source : html);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
try {
  for (const [engine, type] of [["chromium-v8", chromium], ["webkit-playwright", webkit]]) {
    const browser = await type.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.waitForFunction(() => window.__PARITY__);
      const result = await page.evaluate(() => window.__PARITY__);
      writeFileSync(join(out, `${engine}.json`), JSON.stringify({ engine, version: browser.version(), ...result }, null, 2));
      console.log(engine, result.pass, result.results.length);
      if (!result.pass) throw new Error(JSON.stringify(result.results.filter(test => !test.pass)));
    } finally {
      await browser.close();
    }
  }
} finally {
  server.close();
}
