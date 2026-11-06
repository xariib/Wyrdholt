/** Run against Vite DEV on 4174. In-memory fixture only; never ships test art. */
import { chromium, webkit } from "playwright";
import assert from "node:assert/strict";
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage();
    await page.goto(process.argv[2] ?? "http://127.0.0.1:4174/");
    const fixture = await page.evaluate(async () => {
      const { SPRITES, spriteCanvas } = await import("/src/render/pixelArt.ts");
      const source = spriteCanvas(SPRITES.monk);
      const canvas = document.createElement("canvas"); canvas.width = source.width * 2; canvas.height = source.height;
      const ctx = canvas.getContext("2d"); ctx.drawImage(source, 0, 0); ctx.drawImage(source, source.width, 0);
      return { png: canvas.toDataURL().split(",")[1], width: source.width, height: source.height };
    });
    await page.route("**/art/test/monk.png", route => route.fulfill({ contentType: "image/png", body: Buffer.from(fixture.png, "base64") }));
    const result = await page.evaluate(async ({ width, height }) => {
      const { TextureBank } = await import("/src/render/textures.ts");
      const { ArtScope, frameCanvas } = await import("/src/art/load.ts");
      const a = { id: "characters/monk", file: "art/test/monk.png", approved: true, atlasWidth: width * 2, atlasHeight: height, width, height, anchor: { x: width / 2, y: height }, facing: "right", pixelsPerUnit: 1, attachments: { head: { x: 0, y: 0 }, chest: { x: 0, y: 0 }, feet: { x: 0, y: height } }, frames: [{ x: 0, y: 0, durationMs: 100 }, { x: width, y: 0, durationMs: 100 }], clips: Object.fromEntries(["idle", "attack", "hit", "death"].map(p => [p, { frames: [0, 1], loop: p === "idle" }])) };
      const scope = new ArtScope(); const image = await scope.load(a);
      const first = frameCanvas(a, image, 0); const second = frameCanvas(a, image, 1);
      const same = first.toDataURL() === second.toDataURL();
      let ready; const loaded = new Promise(resolve => { ready = resolve; });
      const bank = new TextureBank(ready, id => id === a.id ? a : undefined);
      const fallback = bank.get("monk");
      await loaded;
      const production = bank.get("monk");
      const bytes = bank.decodedBytes;
      const valid = production.frames.length === 2 && production.asset.id === a.id && production !== fallback;
      bank.dispose(); scope.dispose();
      return { same, valid, bytes, released: bank.decodedBytes === 0, destroyed: production.normal.destroyed };
    }, fixture);
    assert(result.same && result.valid && result.released && result.destroyed && result.bytes > 0, JSON.stringify(result));
    console.log(`${engine.name()}: real PNG decode, frame extraction, placeholder replacement and disposal PASS`);
  } finally { await browser.close(); }
}
