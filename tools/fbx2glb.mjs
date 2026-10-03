#!/usr/bin/env node
/**
 * FBX → GLB 変換（Tripo の quad 出力は FBX で返るため）。
 * three.js の FBXLoader で読み（quad は三角形化される）、GLTFExporter で GLB に書き出す。
 * 埋め込みテクスチャはそのまま持ち越す。
 *
 *   node tools/fbx2glb.mjs raw/heroine/heroine.fbx raw/heroine/heroine.glb
 */
import http from 'node:http';
import { createReadStream, existsSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve, dirname, basename } from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);
function loadPlaywright() {
  try { return require('playwright'); } catch { return require(`${execSync('npm root -g').toString().trim()}/playwright`); }
}
const [inPath, outPath] = process.argv.slice(2);
if (!inPath || !outPath || !existsSync(inPath)) {
  console.error('使い方: node tools/fbx2glb.mjs <in.fbx> <out.glb>');
  process.exit(1);
}
const root = resolve('.');
const inAbs = resolve(inPath);
const inDir = dirname(inAbs);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.fbx': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  // /__in/ 以下は入力ファイルのディレクトリ（同梱テクスチャ用）
  const f = url.startsWith('/__in/') ? join(inDir, url.slice(6)) : join(root, url);
  if (!existsSync(f) || !statSync(f).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': mime[extname(f).toLowerCase()] ?? 'application/octet-stream' });
  createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const page_html = `<!doctype html><html><head><meta charset="utf-8">
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>
</head><body><script type="module">
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
window.convert = async (url) => {
  const loader = new FBXLoader();
  const obj = await loader.loadAsync(url);
  // 埋め込みテクスチャは blob URL 経由で非同期に読まれるので、画像が揃うまで待つ
  const maps = [];
  obj.traverse((o) => { if (o.isMesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m.map) maps.push(m.map); });
  const deadline = performance.now() + 15000;
  while (performance.now() < deadline) {
    const ok = maps.every((t) => t.image && (t.image.complete !== false) && (t.image.width > 0 || t.image.naturalWidth > 0));
    if (ok) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const info = { meshes: 0, tris: 0, textures: [], materials: [], bbox: null, skinned: 0, mapsLoaded: maps.filter((t) => t.image && t.image.width > 0).length + '/' + maps.length };
  const box = new THREE.Box3().setFromObject(obj);
  info.bbox = [box.min.toArray(), box.max.toArray()];
  obj.traverse((o) => {
    if (o.isMesh) {
      info.meshes++;
      const g = o.geometry;
      info.tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
      if (o.isSkinnedMesh) info.skinned++;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        info.materials.push(m.type + ':' + m.name);
        if (m.map && m.map.image) info.textures.push((m.map.image.width || '?') + 'x' + (m.map.image.height || '?'));
        // 書き出し前に標準マテリアルへ（FBX の Phong を glTF 互換に）
        if (!m.isMeshStandardMaterial) {
          const std = new THREE.MeshStandardMaterial({ map: m.map ?? null, color: m.color ?? new THREE.Color(1,1,1), metalness: 0, roughness: 1 });
          std.name = m.name; o.material = std;
        }
      }
    }
  });
  const exporter = new GLTFExporter();
  const glb = await exporter.parseAsync(obj, { binary: true, maxTextureSize: 4096 });
  const bytes = new Uint8Array(glb);
  let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return { info, b64: btoa(bin) };
};
window.__ready = true;
</script></body></html>`;
writeFileSync(join(root, 'tools', 'scratch-fbx2glb.html'), page_html);

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.error('[page]', m.text()); });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.goto(`http://127.0.0.1:${port}/tools/scratch-fbx2glb.html`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 15000 });
  const { info, b64 } = await page.evaluate((u) => window.convert(u), `/__in/${basename(inAbs)}`);
  writeFileSync(resolve(outPath), Buffer.from(b64, 'base64'));
  console.log(JSON.stringify(info, null, 2));
  console.log(`→ ${outPath} (${(Buffer.from(b64, 'base64').length / 1024).toFixed(0)} KB)`);
} finally {
  await browser.close();
  server.close();
  try { execSync(`rm -f ${join(root, 'tools', 'scratch-fbx2glb.html')}`); } catch {}
}
