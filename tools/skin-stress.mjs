#!/usr/bin/env node
/**
 * スキン変形の「破綻度」を数値で測る（docs/05-asset-automation.md）。
 *
 *   node tools/skin-stress.mjs public/assets/characters/hero.glb [--step 0.05] [--json out.json]
 *
 * ヘッドレス Chromium 上で three.js 自身のスキニング（SkinnedMesh.applyBoneTransform）を使い、
 * 各クリップを一定間隔でサンプルしてメッシュの各辺の長さをバインド姿勢と比べる。
 *   stretch = 変形後の辺長 / バインド時の辺長
 * 1 クリップにつき、最大値・99.9 / 99 パーセンタイル・しきい値(1.8)超過の辺の割合と、
 * 最悪の辺に強く効いているボーンを出す。描画と同じ計算なので、ここで OK なら画面でも破綻しない。
 *
 * 目安: OK = max < 2.0 かつ p99.9 < 1.6。WARN = max < 3.0。BAD = それ以上（確実にスパイクが見える）。
 */
import http from 'node:http';
import { createReadStream, existsSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);
function loadPlaywright() {
  try { return require('playwright'); } catch { return require(`${execSync('npm root -g').toString().trim()}/playwright`); }
}
const args = process.argv.slice(2);
const optionValues = new Set();
for (const flag of ['--step', '--json']) { const i = args.indexOf(flag); if (i >= 0 && args[i + 1]) optionValues.add(args[i + 1]); }
const file = args.find((a) => !a.startsWith('--') && !optionValues.has(a));
if (!file || !existsSync(file)) {
  console.error('使い方: node tools/skin-stress.mjs <file.glb> [--step 0.05] [--json out.json]');
  process.exit(1);
}
const step = args.includes('--step') ? Number(args[args.indexOf('--step') + 1]) : 0.05;
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;

const root = resolve('.');
const glbPath = resolve(file);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const f = url === '/__model.glb' ? glbPath : join(root, url);
  if (!existsSync(f) || !statSync(f).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': mime[extname(f)] ?? 'application/octet-stream' });
  createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const { chromium } = loadPlaywright();
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 320, height: 320 } });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.goto(`http://127.0.0.1:${port}/tools/inspect/index.html`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 15000 });
  const stats = await page.evaluate((u) => window.loadModel(u), '/__model.glb');
  const results = [];
  for (let i = 0; i < stats.animations.length; i++) {
    const r = await page.evaluate(([ci, st]) => window.measureStress(ci, st), [i, step]);
    for (const x of r) {
      results.push(x);
      console.log(`${x.clip.padEnd(10)} ${x.verdict.padEnd(5)} max ${x.max.toFixed(2)} @${x.maxAt.toFixed(2)}s  p99.9 ${x.p999.toFixed(2)}  p99 ${x.p99.toFixed(2)}  med ${x.median.toFixed(2)}  degen ${x.degenerate}  >1.8: ${x.overPct.toFixed(3)}%  minJointY ${x.minJointY.toFixed(2)}m@${x.minJointYAt}s  bones ${x.worstBones.join(' ')}`);
    }
  }
  console.log(`\nstep ${step}s, clips ${stats.animations.length}, tris ${stats.tris}`);
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ file, step, results }, null, 2));
  const worst = results.reduce((m, r) => (r.max > m ? r.max : m), 0);
  process.exitCode = worst >= 3 ? 2 : 0;
} finally {
  await browser.close();
  server.close();
}
