#!/usr/bin/env node
/**
 * 各クリップで「手が頭よりどれだけ高く上がるか」と上腕の挙上角（真下からの角度）を測る。
 * 脇の下のトップスの縁のささくれは腕を高く上げたときに出る（目安: 130° 超で出始め、160° で目立つ）。
 *
 *   node tools/clip-arm-height.mjs <glb> [clip名,clip名,...]   （クリップ名は GLB 内の並び順）
 */
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = resolve('.');
const glb = process.argv[2] ?? 'public/assets/characters/hero.glb';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm' };
const server = http.createServer((req, res) => { const url = decodeURIComponent(req.url.split('?')[0]); const file = join(root, url); if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end(); return; } res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' }); createReadStream(file).pipe(res); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 200, height: 200 } });
await page.goto(`http://127.0.0.1:${server.address().port}/tools/inspect/index.html`);
await page.waitForFunction(() => window.__ready === true);
await page.evaluate((u) => window.loadModel(u), '/' + glb);
const names = (process.argv[3] ?? 'idle,stance,run,combo,slash,heavy,dodge,hit,death').split(',');
const res = await page.evaluate((names) => {
  const model = window.__model, THREE = window.__THREE;
  const bones = {}; model.traverse((o) => { if (o.isBone) bones[o.name] = o; });
  const v = new THREE.Vector3(), q = new THREE.Quaternion(), qi = new THREE.Quaternion();
  const out = [];
  names.forEach((name, ci) => {
    let maxRel = -9, maxT = 0, maxElev = 0, elevT = 0, overHead = 0, n = 0;
    for (let t = 0; t <= 1.0001; t += 0.01) {
      window.setAnim(ci, Math.min(t, 1)); model.updateMatrixWorld(true);
      const y = (b) => bones[b].getWorldPosition(v).y;
      const rel = Math.max(y('LeftHand'), y('RightHand')) - y('Head');
      if (rel > maxRel) { maxRel = rel; maxT = t; }
      // 腕の挙上: 上腕ボーン（肩→肘）の向きと下向きのなす角
      for (const side of ['Left', 'Right']) {
        const a = bones[side + 'Arm'].getWorldPosition(new THREE.Vector3()), e = bones[side + 'ForeArm'].getWorldPosition(new THREE.Vector3());
        const d = e.sub(a).normalize(); const ang = Math.acos(Math.max(-1, Math.min(1, -d.y))) * 180 / Math.PI;
        if (ang > maxElev) { maxElev = ang; elevT = t; }
      }
      n++; if (rel > 0) overHead++;
    }
    out.push({ name, handAboveHeadMax: +maxRel.toFixed(2), at: +maxT.toFixed(2), upperArmMaxDeg: Math.round(maxElev), overHeadShare: Math.round(overHead / n * 100) });
  });
  return out;
}, names);
console.table(res);
await browser.close(); server.close();
console.log(res);
