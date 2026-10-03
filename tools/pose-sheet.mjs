#!/usr/bin/env node
/**
 * 複数の GLB/クリップを固定カメラで 4 コマずつ描画して 1 枚に並べる（クリップの比較・検査用）。
 *
 *   node tools/pose-sheet.mjs <glb>:<clipIndex>:<label> [...]
 *   例: node tools/pose-sheet.mjs public/assets/characters/hero.glb:0:combo raw/clips/hero-combo.glb:0:orig
 * 出力: artifacts/inspect/fixed-compare.png
 */
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const sharp = require('sharp');
const root = resolve('.');
const files = process.argv.slice(2); // [glb, clipIndex, outPrefix]...
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm' };
const server = http.createServer((req, res) => { const url = decodeURIComponent(req.url.split('?')[0]); const file = join(root, url); if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end(); return; } res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' }); createReadStream(file).pipe(res); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const tiles = [];
for (const spec of files) {
  const [glb, clipIdx, label] = spec.split(':');
  const page = await browser.newPage({ viewport: { width: 640, height: 800 } });
  await page.goto(`http://127.0.0.1:${port}/tools/inspect/index.html`);
  await page.waitForFunction(() => window.__ready === true);
  await page.evaluate((u) => window.loadModel(u), '/' + glb);
  for (const t of [0, 0.25, 0.5, 0.75]) {
    await page.evaluate(([c, tt]) => { window.setAnim(c, tt); window.setFixedView(60); }, [Number(clipIdx), t]);
    const p = `artifacts/inspect/fixed-${label}-${t}.png`;
    await page.locator('canvas').screenshot({ path: p });
    tiles.push(p);
  }
  await page.close();
}
const tw = 240, th = 300, cols = 4;
const bufs = await Promise.all(tiles.map(f => sharp(f).resize(tw, th).png().toBuffer()));
await sharp({ create: { width: tw * cols, height: th * Math.ceil(bufs.length / cols), channels: 3, background: '#fff' } }).composite(bufs.map((input, i) => ({ input, left: (i % cols) * tw, top: Math.floor(i / cols) * th }))).png().toFile('artifacts/inspect/fixed-compare.png');
await browser.close(); server.close();
console.log('artifacts/inspect/fixed-compare.png');
