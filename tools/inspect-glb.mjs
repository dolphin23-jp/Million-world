#!/usr/bin/env node
/**
 * GLB を多方向から描画して検査用の画像と統計を出力する（docs/03-asset-pipeline.md の検査基準用）。
 *
 *   node tools/inspect-glb.mjs raw/pilot.glb            # → artifacts/inspect/pilot-*.png と pilot-sheet.png
 *
 * 出力: 全身（正面・斜め・側面・背面）と顔アップ（正面・斜め・側面）の合成シート、および統計(JSON)。
 */
import http from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve, basename } from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);
function loadPlaywright() {
  try { return require('playwright'); } catch { return require(`${execSync('npm root -g').toString().trim()}/playwright`); }
}
function loadSharp() {
  try { return require('sharp'); } catch { return require(`${execSync('npm root -g').toString().trim()}/sharp`); }
}

const glbArg = process.argv[2];
if (!glbArg || !existsSync(glbArg)) {
  console.error('使い方: node tools/inspect-glb.mjs <file.glb>');
  process.exit(1);
}
const root = resolve('.');
const glbPath = resolve(glbArg);
const name = basename(glbPath).replace(/\.glb$/i, '');
const outDir = join(root, 'artifacts', 'inspect');
mkdirSync(outDir, { recursive: true });

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.json': 'application/json', '.wasm': 'application/wasm' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = url === '/__model.glb' ? glbPath : join(root, url);
  if (!file.startsWith(root) && file !== glbPath) { res.writeHead(403).end(); return; }
  if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 800 }, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
  page.on('pageerror', (e) => logs.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/tools/inspect/index.html`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 15000 });
  const stats = await page.evaluate((u) => window.loadModel(u), '/__model.glb');
  writeFileSync(join(outDir, `${name}-stats.json`), JSON.stringify(stats, null, 2));

  const views = [
    ['front', 0, 'full'], ['q45', 40, 'full'], ['side', 90, 'full'], ['back', 180, 'full'],
    ['face-front', 0, 'head'], ['face-q45', 40, 'head'], ['face-side', 90, 'head'], ['upper-q45', -40, 'upper'],
  ];
  const files = [];
  for (const [label, yaw, focus] of views) {
    await page.evaluate(([y, f]) => window.setView(y, f), [yaw, focus]);
    const p = join(outDir, `${name}-${label}.png`);
    await page.locator('canvas').screenshot({ path: p });
    files.push(p);
  }
  // アニメがあれば、各クリップを 8 分割したポーズ列を側面から描画する
  const animSheets = [];
  const nClips = stats.animations.length;
  for (let ci = 0; ci < nClips; ci++) {
    const frames = [];
    for (let k = 0; k < 8; k++) {
      await page.evaluate(([c, t]) => { window.setAnim(c, t); window.setView(60, 'full'); }, [ci, k / 8]);
      const p = join(outDir, `${name}-anim${ci}-${k}.png`);
      await page.locator('canvas').screenshot({ path: p });
      frames.push(p);
    }
    animSheets.push(frames);
  }
  const sharp = loadSharp();
  for (let ci = 0; ci < animSheets.length; ci++) {
    const aw = 240, ah = 300;
    const t = await Promise.all(animSheets[ci].map((f) => sharp(f).resize(aw, ah).png().toBuffer()));
    await sharp({ create: { width: aw * 4, height: ah * 2, channels: 3, background: '#fff' } })
      .composite(t.map((input, i) => ({ input, left: (i % 4) * aw, top: Math.floor(i / 4) * ah })))
      .png().toFile(join(outDir, `${name}-anim${ci}-sheet.png`));
  }
  const tw = 320, th = 400;
  const tiles = await Promise.all(files.map((f) => sharp(f).resize(tw, th).png().toBuffer()));
  await sharp({ create: { width: tw * 4, height: th * 2, channels: 3, background: '#fff' } })
    .composite(tiles.map((input, i) => ({ input, left: (i % 4) * tw, top: Math.floor(i / 4) * th })))
    .png().toFile(join(outDir, `${name}-sheet.png`));

  console.log(JSON.stringify(stats, null, 2));
  if (logs.length) console.error('console errors:\n' + logs.join('\n'));
  console.log(`\n→ ${join('artifacts/inspect', `${name}-sheet.png`)}`);
} finally {
  await browser.close();
  server.close();
}
