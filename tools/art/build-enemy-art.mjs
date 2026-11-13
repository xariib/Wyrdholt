// node --import tsx tools/art/build-enemy-art.mjs
// Extract generated silhouettes and compile packaged native-grid animation atlases.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const out = resolve('tools/smoke/out/enemy-art'); mkdirSync(out, { recursive: true });
const web = await createServer({ root: resolve('apps/mobile'), logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
await web.listen();
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH });
  const page = await browser.newPage({ viewport: { width: 1100, height: 1200 } });
  await page.goto(`http://127.0.0.1:${web.httpServer.address().port}`);
  const result = await page.evaluate(async () => {
    const { ENEMY_SOURCES, ENEMY_DESIGNS, ENEMY_ATLAS, refinedEnemyAssets } = await import('/src/art/refinedEnemies.ts');
    const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
    const context = c => { const x = c.getContext('2d', { willReadFrequently: true }); x.imageSmoothingEnabled = false; return x; };
    const extracted = {}, bounds = {}, files = [];
    // Detect connected silhouettes across the entire source: generated layouts do not
    // promise mathematically exact cell borders. Never crop a limb to a nominal grid.
    for (const [zone, source] of Object.entries(ENEMY_SOURCES)) {
      const image = new Image(); image.src = `/${source.file}`; await image.decode();
      if (image.naturalWidth !== source.width || image.naturalHeight !== source.height) throw Error(`Source dimensions: ${zone}`);
      const c = canvas(source.width, source.height), ctx = context(c); ctx.drawImage(image, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height), seen = new Uint8Array(c.width * c.height), pieces = [];
      for (let start = 0; start < seen.length; start++) {
        if (seen[start] || d.data[start * 4 + 3] < 180) continue;
        const queue = [start]; seen[start] = 1;
        let l = c.width, r = 0, t = c.height, b = 0;
        for (let n = 0; n < queue.length; n++) {
          const at = queue[n], x = at % c.width, y = Math.floor(at / c.width);
          l = Math.min(l, x); r = Math.max(r, x); t = Math.min(t, y); b = Math.max(b, y);
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy, next = yy * c.width + xx;
            if (xx < 0 || yy < 0 || xx >= c.width || yy >= c.height || seen[next] || d.data[next * 4 + 3] < 180) continue;
            seen[next] = 1; queue.push(next);
          }
        }
        if (queue.length > 1000) pieces.push({ l, r, t, b, pixels: queue });
      }
      pieces.sort((a, b) => b.pixels.length - a.pixels.length);
      const selected = pieces.slice(0, source.columns * source.rows);
      if (selected.length !== source.columns * source.rows) throw Error(`Missing source silhouettes: ${zone}/${selected.length}`);
      for (let col = 0; col < source.columns; col++) {
        const column = selected.filter(p => Math.floor((p.l + p.r) / 2 / c.width * source.columns) === col).sort((a, b) => a.t - b.t);
        if (column.length !== source.rows) throw Error(`Source column: ${zone}/${col}/${column.length}`);
        column.forEach((p, row) => {
          const cell = canvas(p.r - p.l + 1, p.b - p.t + 1), cc = context(cell), data = cc.createImageData(cell.width, cell.height);
          for (const at of p.pixels) {
            const x = at % c.width - p.l, y = Math.floor(at / c.width) - p.t, k = (y * cell.width + x) * 4;
            data.data.set(d.data.subarray(at * 4, at * 4 + 3), k); data.data[k + 3] = 255;
          }
          cc.putImageData(data, 0, 0); extracted[`${zone}/${col}/${row}`] = cell;
          bounds[`${zone}/${col}/${row}`] = [p.l, p.t, cell.width, cell.height];
        });
      }
    }
    document.body.replaceChildren();
    document.body.style.cssText = 'margin:20px;background:#182830;color:#eee2c5;font:14px system-ui;display:grid;grid-template-columns:repeat(4,1fr);gap:14px';
    for (const design of ENEMY_DESIGNS) {
      const [col, row] = design.cell, idle = extracted[`${design.zone}/${col}/${row}`];
      const strike = extracted[`${design.zone}/${design.zone === 'ashen' ? col + 1 : col}/${design.zone === 'ashen' ? row : row + 1}`];
      const assets = refinedEnemyAssets.filter(a => a.id === `enemies/${design.name}` || a.id.startsWith(`enemies/${design.name}/`));
      const minW = Math.min(...assets.map(a => a.width)), minGround = Math.min(...assets.map(a => a.anchor.y));
      // Both illustrated poses use ONE scale. Their anatomy never grows during attacks.
      const scale = Math.min(design.height / Math.max(idle.height, strike.height), (minW - 16) / Math.max(idle.width, strike.width), (minGround - 12) / Math.max(idle.height, strike.height));
      const normalize = source => { const c = canvas(Math.round(source.width * scale), Math.round(source.height * scale)); context(c).drawImage(source, 0, 0, c.width, c.height); return c; };
      const bodies = [normalize(idle), normalize(strike)], atlas = canvas(ENEMY_ATLAS.width, ENEMY_ATLAS.height), ctx = context(atlas);
      for (const a of assets) {
        const pose = a.id.split('/')[2] ?? 'idle';
        for (const [i, f] of a.frames.entries()) {
          const body = bodies[pose === 'attack' && (i === 1 || i === 2) ? 1 : 0];
          ctx.save(); ctx.beginPath(); ctx.rect(f.x, f.y, a.width, a.height); ctx.clip();
          let x = f.x + a.anchor.x - Math.round(body.width / 2), y = f.y + a.anchor.y - body.height;
          if (pose === 'idle') x += [0, 1, 0, -1][i];
          if (pose === 'attack') x += [2, -2, -1, 0][i];
          if (pose === 'hit') x += i ? 1 : 3;
          if (pose === 'death' && i >= 2) {
            // Rotate the whole illustration into a fallen pose and fit its bounds.
            const ratio = Math.min(1, (a.width - 16) / body.height, (a.anchor.y - 8) / body.width);
            ctx.translate(f.x + a.anchor.x, f.y + a.anchor.y - body.width * ratio / 2);
            ctx.rotate(-Math.PI / 2); ctx.scale(ratio, ratio); ctx.drawImage(body, -body.width / 2, -body.height / 2);
          } else ctx.drawImage(body, x, y);
          ctx.restore();
          if (pose === 'flash') {
            const white = canvas(a.width, a.height), wc = context(white);
            wc.drawImage(atlas, f.x, f.y, a.width, a.height, 0, 0, a.width, a.height);
            wc.globalCompositeOperation = 'source-in'; wc.fillStyle = '#fff5dc'; wc.fillRect(0, 0, a.width, a.height);
            ctx.clearRect(f.x, f.y, a.width, a.height); ctx.drawImage(white, f.x, f.y);
          }
        }
      }
      const pixels = ctx.getImageData(0, 0, atlas.width, atlas.height);
      for (let i = 3; i < pixels.data.length; i += 4) pixels.data[i] = pixels.data[i] >= 128 ? 255 : 0;
      ctx.putImageData(pixels, 0, 0);
      const idleAsset = assets[0], first = canvas(idleAsset.width, idleAsset.height), fc = context(first);
      fc.drawImage(atlas, 0, 0, first.width, first.height, 0, 0, first.width, first.height);
      first.style.cssText = 'image-rendering:pixelated;background:#23363d;max-width:100%';
      const card = document.createElement('div'); card.textContent = design.name; card.append(first); document.body.append(card);
      files.push({ file: assets[0].file, png: atlas.toDataURL('image/png').split(',')[1] });
    }
    return { files, bounds };
  });
  assert.equal(result.files.length, 16);
  for (const file of result.files) writeFileSync(resolve('apps/mobile/public', file.file), Buffer.from(file.png, 'base64'));
  writeFileSync(resolve(out, 'source-bounds.json'), JSON.stringify(result.bounds, null, 2));
  await page.screenshot({ path: resolve(out, 'enemy-lineup.png'), fullPage: true });
  console.log(`Compiled ${result.files.length} native-grid enemy atlases.`);
} finally { await browser?.close(); await web.close(); }
