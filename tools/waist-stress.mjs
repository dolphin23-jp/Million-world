#!/usr/bin/env node
/**
 * 腰まわり（骨盤〜胸）のスキン変形の「崩れ度」を、ゲームに登録された全クリップで数値にする（docs/05-asset-automation.md「腰まわりの再スキン」）。
 *
 *   npm run build && node tools/waist-stress.mjs [--step 2] [--clip <名前の一部>] [--json out.json] [--worst 12] [--check]
 *
 * ゲームを起動し、焼き込み済みの各クリップ（手付けの技・ロール・ガードの盾版／大剣版・Meshy 由来の待機や走り）を 60fps の --step フレームごとに止めて、
 * three.js 自身のスキニング（SkinnedMesh.applyBoneTransform）で胴の頂点を動かし、次の 3 つを測る。描画と同じ計算なので、ここで OK なら画面でも崩れない。
 *
 *   stretch … 胴の辺の長さ（変形後 / バインド時）。p99・最大・最小。伸びすぎ（皮膚が裂けて見える）と縮みすぎ（潰れ）。
 *             腰（Hips の −6〜+20cm。骨盤・ウエスト・ショーツ）と、胸（+20〜+30cm。脇の下・肩甲骨のまわり。腕の動きに引かれる）を分けて出す
 *   pinch   … 高さ 1cm ごとの輪切りの断面の大きさ（輪の頂点の分散の √(λ1·λ2)）の、バインド時に対する比。最小 = いちばん細く潰れた所。
 *             「雑巾絞り」で腰がくびれて細く見える崩れはここに出る（0.8 を切ると目に付く）
 *   twist   … 3cm 離れた輪切り同士の相対回転（輪の頂点をバインド姿勢に重ねる最適な回転。Horn 法）÷ 3cm = ひねり・曲げの集中度（度/cm）。
 *             回転が細い帯に集中すると大きくなる（腰↔胸 70° を 15cm に均すと 5 度/cm。10 度/cm を超えると帯状にくびれて見える）
 *
 * 胴 = バインド姿勢で Hips の −6cm〜+30cm の高さにあり、腕（上腕・前腕の軸）から 10cm 以上離れた頂点（位置だけで決めるので、重みを直す前後で同じ頂点を比べられる）。
 *       脇の下・肩・股・頭・脚は含めない。
 *
 * 出力: クリップごとに最悪値（と、その時刻のフレーム）。--worst N で、全クリップを通した最悪のフレームを N 件並べる（motion-sheet で見に行く目印）。
 * --check を付けると、しきい値（下の LIMITS）を超えたクリップがあれば終了コード 2 で終わる（回帰検査）。
 */
import { spawn, execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';

const require = createRequire(import.meta.url);
function loadPlaywright() {
  try { return require('playwright'); } catch { return require(`${execSync('npm root -g').toString().trim()}/playwright`); }
}
const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : def; };
const step = Number(opt('step', 2));
const only = opt('clip', null);
const jsonOut = opt('json', null);
const worstN = Number(opt('worst', 0));
const check = argv.includes('--check');

/**
 * 合格のしきい値（クリップごとの最悪値に対して）。補正前後の実測にもとづく（docs/05「腰まわりの再スキン」）。腰の伸びは p99 と最大・最小、胸は p99。
 * 補正後の最悪値: 腰 p99 2.10 / 最大 2.43 / 最小 0.12（死亡の倒れ込み。股・膝の折れ目の縮み）、胸 p99 2.06、断面 0.96、ひねり 6.9（Meshy の死亡・斬り）。
 * 補正前: 腰 p99 5.79 / 最大 17.2 / 最小 0.03、胸 p99 2.59（最大 9.05）、断面 0.22、ひねり 28.7
 */
const LIMITS = { stretchP99: 2.3, stretchMax: 2.8, stretchMin: 0.1, chestP99: 2.3, pinchMin: 0.9, twistMax: 8 };

const port = 4150 + Math.floor(Math.random() * 9);
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore', detached: true });
const url = `http://127.0.0.1:${port}/?autostart=1&adaptive=0&mute=1&sandbox=1&debug=0`;
for (let i = 0; i < 40; i++) {
  await sleep(250);
  try { if ((await fetch(url)).ok) break; } catch {}
}
const { chromium } = loadPlaywright();
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.goto(url);
  await page.waitForFunction(() => Boolean(window.__mw?.game?.ready), null, { timeout: 60000 });

  const result = await page.evaluate(([step, only]) => {
    const g = window.__mw.game;
    g.loop.stop();
    const THREE = window.__mw.THREE;
    const vis = g.player.visual;
    const an = vis.animator;
    const root = vis.root;
    let mesh = null;
    root.traverse((o) => { if (o.isSkinnedMesh && !o.name.endsWith('__outline')) mesh = o; });
    const bones = mesh.skeleton.bones;
    const geo = mesh.geometry;
    const pos = geo.attributes.position, si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
    const n = pos.count;
    const hipsIdx = bones.findIndex((b) => b.name === 'Hips');
    const hipsY = new THREE.Vector3().setFromMatrixPosition(mesh.skeleton.boneInverses[hipsIdx].clone().invert()).y;
    // 腕の軸（バインド姿勢の関節位置。ジオメトリ空間）: 上腕 → 前腕 → 手首
    const jointPos = (name) => {
      const i = bones.findIndex((b) => b.name === name);
      return new THREE.Vector3().setFromMatrixPosition(mesh.skeleton.boneInverses[i].clone().invert());
    };
    const armSegs = [];
    for (const side of ['Left', 'Right']) {
      const a = jointPos(`${side}Arm`), e = jointPos(`${side}ForeArm`), h = jointPos(`${side}Hand`);
      armSegs.push([a, e], [e, h]);
    }
    const segDist = (p, a, b) => {
      const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / (abx * abx + aby * aby + abz * abz)));
      return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t), p.z - (a.z + abz * t));
    };

    // ---- 胴の頂点（バインド姿勢で Hips の −10〜+30cm、腕の重み < 0.5）と、その辺 ----
    const bindY = new Float32Array(n);
    const inS = new Uint8Array(n);
    const sel = [];
    const pv = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      bindY[i] = pos.getY(i) - hipsY;
      if (bindY[i] < -0.06 || bindY[i] > 0.3) continue;
      pv.fromBufferAttribute(pos, i);
      let dArm = 9;
      for (const [a, b] of armSegs) dArm = Math.min(dArm, segDist(pv, a, b));
      if (dArm >= 0.1) { inS[i] = 1; sel.push(i); }
    }
    const index = geo.index.array;
    const edgeSet = new Set();
    const edges = [];
    for (let t = 0; t < index.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const a = index[t + k], b = index[t + ((k + 1) % 3)];
        if (!inS[a] || !inS[b]) continue;
        const key = a < b ? a * n + b : b * n + a;
        if (edgeSet.has(key)) continue;
        edgeSet.add(key);
        edges.push(a, b);
      }
    }
    const nE = edges.length / 2;
    const zoneOf = new Uint8Array(nE); // 0 = 腰（−6〜+20cm）、1 = 胸（+20〜+30cm）。辺の両端の高さの平均
    for (let e = 0; e < nE; e++) zoneOf[e] = (bindY[edges[e * 2]] + bindY[edges[e * 2 + 1]]) / 2 >= 0.2 ? 1 : 0;
    const bindLen = new Float32Array(nE);
    const pa = new THREE.Vector3(), pb = new THREE.Vector3();
    for (let e = 0; e < nE; e++) {
      pa.fromBufferAttribute(pos, edges[e * 2]);
      pb.fromBufferAttribute(pos, edges[e * 2 + 1]);
      bindLen[e] = pa.distanceTo(pb);
    }
    // 輪切り（1cm ごと。幅 1cm の高さの頂点）
    const RING0 = -0.06, RING1 = 0.3, nRing = Math.round((RING1 - RING0) / 0.01);
    const rings = Array.from({ length: nRing }, () => []);
    for (const i of sel) {
      const r = Math.floor((bindY[i] - RING0) / 0.01);
      if (r >= 0 && r < nRing) rings[r].push(i);
    }
    const posed = new Float32Array(n * 3);
    const v = new THREE.Vector3();
    const posePositions = () => {
      mesh.skeleton.update();
      for (const i of sel) {
        v.fromBufferAttribute(pos, i);
        mesh.applyBoneTransform(i, v); // メッシュローカルを返すので、world へ戻して bind 座標（world と同スケール）と比べる（tools/inspect/index.html の measureStress と同じ）
        v.applyMatrix4(mesh.matrixWorld);
        posed[i * 3] = v.x; posed[i * 3 + 1] = v.y; posed[i * 3 + 2] = v.z;
      }
    };
    // 対称行列（n×n）のヤコビ法。固有値と固有ベクトル（列）を返す
    const jacobi = (A, nn) => {
      const a = A.slice();
      const V = new Array(nn * nn).fill(0);
      for (let i = 0; i < nn; i++) V[i * nn + i] = 1;
      for (let sweep = 0; sweep < 24; sweep++) {
        let off = 0;
        for (let p = 0; p < nn; p++) for (let q = p + 1; q < nn; q++) off += Math.abs(a[p * nn + q]);
        if (off < 1e-18) break;
        for (let p = 0; p < nn; p++) for (let q = p + 1; q < nn; q++) {
          const apq = a[p * nn + q];
          if (Math.abs(apq) < 1e-20) continue;
          const th = (a[q * nn + q] - a[p * nn + p]) / (2 * apq);
          const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
          const cs = 1 / Math.sqrt(t * t + 1), sn = t * cs;
          for (let k = 0; k < nn; k++) { const akp = a[k * nn + p], akq = a[k * nn + q]; a[k * nn + p] = cs * akp - sn * akq; a[k * nn + q] = sn * akp + cs * akq; }
          for (let k = 0; k < nn; k++) { const apk = a[p * nn + k], aqk = a[q * nn + k]; a[p * nn + k] = cs * apk - sn * aqk; a[q * nn + k] = sn * apk + cs * aqk; }
          for (let k = 0; k < nn; k++) { const vkp = V[k * nn + p], vkq = V[k * nn + q]; V[k * nn + p] = cs * vkp - sn * vkq; V[k * nn + q] = sn * vkp + cs * vkq; }
        }
      }
      const ev = []; for (let i = 0; i < nn; i++) ev.push(a[i * nn + i]);
      return { ev, V };
    };
    const eigTop = (V, nn, col) => { const o = []; for (let k = 0; k < nn; k++) o.push(V[k * nn + col]); return o; };
    // 輪ごとに: 重心・共分散（断面の大きさ √(λ1·λ2)）。Procrustes の回転は bind と posed の対応する頂点から（Horn 法の四元数）
    const ringArea = (list, src) => {
      let mx = 0, my = 0, mz = 0;
      for (const i of list) { const p = src(i); mx += p[0]; my += p[1]; mz += p[2]; }
      mx /= list.length; my /= list.length; mz /= list.length;
      let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
      for (const i of list) { const p = src(i); const dx = p[0] - mx, dy = p[1] - my, dz = p[2] - mz; xx += dx * dx; xy += dx * dy; xz += dx * dz; yy += dy * dy; yz += dy * dz; zz += dz * dz; }
      const k = 1 / list.length;
      const { ev } = jacobi([xx * k, xy * k, xz * k, xy * k, yy * k, yz * k, xz * k, yz * k, zz * k], 3);
      const e = ev.map((x) => Math.max(x, 0)).sort((x, y) => y - x);
      return Math.sqrt(e[0] * e[1]);
    };
    const ringQuat = (list, bindSrc, posedSrc) => {
      let bx = 0, by = 0, bz = 0, px = 0, py = 0, pz = 0;
      for (const i of list) { const b = bindSrc(i), p = posedSrc(i); bx += b[0]; by += b[1]; bz += b[2]; px += p[0]; py += p[1]; pz += p[2]; }
      const c = 1 / list.length; bx *= c; by *= c; bz *= c; px *= c; py *= c; pz *= c;
      let Sxx = 0, Sxy = 0, Sxz = 0, Syx = 0, Syy = 0, Syz = 0, Szx = 0, Szy = 0, Szz = 0;
      for (const i of list) {
        const b = bindSrc(i), p = posedSrc(i); const ax = b[0] - bx, ay = b[1] - by, az = b[2] - bz, cx = p[0] - px, cy = p[1] - py, cz = p[2] - pz;
        Sxx += ax * cx; Sxy += ax * cy; Sxz += ax * cz; Syx += ay * cx; Syy += ay * cy; Syz += ay * cz; Szx += az * cx; Szy += az * cy; Szz += az * cz;
      }
      const N = [
        Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx,
        Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz,
        Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy,
        Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz,
      ];
      const { ev, V } = jacobi(N, 4);
      let top = 0; for (let i = 1; i < 4; i++) if (ev[i] > ev[top]) top = i;
      return eigTop(V, 4, top); // [w, x, y, z]
    };
    const bindPos = new Float32Array(n * 3);
    for (const i of sel) { bindPos[i * 3] = pos.getX(i); bindPos[i * 3 + 1] = pos.getY(i); bindPos[i * 3 + 2] = pos.getZ(i); }
    const bindSrc = (i) => [bindPos[i * 3], bindPos[i * 3 + 1], bindPos[i * 3 + 2]];
    const posedSrc = (i) => [posed[i * 3], posed[i * 3 + 1], posed[i * 3 + 2]];
    const bindArea = rings.map((list) => (list.length >= 8 ? ringArea(list, bindSrc) : 0));
    // 評価する輪: 腰の帯（Hips の +0〜+24cm）。輪切りは 1cm ごと、1 つの輪に 8 頂点以上
    const evalRing = (r) => { const y = RING0 + (r + 0.5) * 0.01; return y >= 0.0 && y <= 0.24; };

    const measure = () => {
      posePositions();
      // 辺の伸び（腰と胸に分けて）
      const rz = [[], []];
      for (let e = 0; e < nE; e++) {
        const a = edges[e * 2] * 3, b = edges[e * 2 + 1] * 3;
        const d = Math.hypot(posed[a] - posed[b], posed[a + 1] - posed[b + 1], posed[a + 2] - posed[b + 2]);
        if (bindLen[e] >= 2e-3) rz[zoneOf[e]].push(d / bindLen[e]); // 2mm 未満の辺は見えない上に比が暴れるので数えない（tools/inspect/index.html の measureStress と同じ）
      }
      const stat = (arr) => { const a = Float32Array.from(arr).sort(); return { p99: a[Math.floor(a.length * 0.99)], max: a[a.length - 1], min: a[0] }; };
      const zw = stat(rz[0]), zc = stat(rz[1]);
      const p99 = zw.p99, max = zw.max, min = zw.min, p999 = 0;
      // 輪切り: 断面の大きさの比と、バインドに重ねる最適な回転
      let pinch = 9, pinchAt = 0, twist = 0, twistAt = 0;
      const quats = new Array(nRing).fill(null);
      for (let r = 0; r < nRing; r++) {
        const list = rings[r];
        if (list.length < 8 || !evalRing(r)) continue;
        const ratio = ringArea(list, posedSrc) / bindArea[r];
        if (ratio < pinch) { pinch = ratio; pinchAt = r; }
        quats[r] = ringQuat(list, bindSrc, posedSrc);
      }
      // ひねり: 3cm 離れた輪の相対回転（度）÷ 3cm
      for (let r = 0; r + 3 < nRing; r++) {
        const a = quats[r], b = quats[r + 3];
        if (!a || !b) continue;
        const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
        const rate = ((2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI) / 3;
        if (rate > twist) { twist = rate; twistAt = r; }
      }
      return { p99, p999, max, min, chest99: zc.p99, chestMax: zc.max, pinch, pinchY: Math.round((RING0 + (pinchAt + 0.5) * 0.01) * 100), twist, twistY: Math.round((RING0 + (twistAt + 0.5) * 0.01) * 100) };
    };

    // ---- 全クリップ ----
    const results = [];
    const names = [...an.clips.keys()].filter((nm) => !only || nm.includes(only));
    for (const name of names) {
      const dur = an.duration(name);
      if (dur <= 0) continue;
      an.mixer.stopAllAction();
      const act = an.play(name, { loop: false, fade: 0, restart: true, rate: 1, clamp: true });
      an.mixer.update(0.01);
      const frames = Math.round(dur * 60);
      const worst = { stretchP99: { v: 0, f: 0 }, stretchMax: { v: 0, f: 0 }, stretchMin: { v: 9, f: 0 }, chestP99: { v: 0, f: 0 }, chestMax: { v: 0, f: 0 }, pinchMin: { v: 9, f: 0, y: 0 }, twistMax: { v: 0, f: 0, y: 0 } };
      for (let f = 0; f <= frames; f += step) {
        act.time = Math.min(f / 60, dur - 1e-6);
        an.mixer.update(0);
        root.updateMatrixWorld(true);
        const m = measure();
        if (m.p99 > worst.stretchP99.v) worst.stretchP99 = { v: m.p99, f };
        if (m.max > worst.stretchMax.v) worst.stretchMax = { v: m.max, f };
        if (m.min < worst.stretchMin.v) worst.stretchMin = { v: m.min, f };
        if (m.chest99 > worst.chestP99.v) worst.chestP99 = { v: m.chest99, f };
        if (m.chestMax > worst.chestMax.v) worst.chestMax = { v: m.chestMax, f };
        if (m.pinch < worst.pinchMin.v) worst.pinchMin = { v: m.pinch, f, y: m.pinchY };
        if (m.twist > worst.twistMax.v) worst.twistMax = { v: m.twist, f, y: m.twistY };
      }
      results.push({ name, frames, ...worst });
    }
    // 参考: 胴の頂点数・辺の数・輪の数
    return { results, info: { vertices: sel.length, edges: nE, rings: rings.filter((r) => r.length >= 8).length } };
  }, [step, only]);

  console.log(`胴の頂点 ${result.info.vertices} / 辺 ${result.info.edges} / 輪 ${result.info.rings}（1cm ごと）。--step ${step}`);
  console.log('クリップ                  腰: 伸びp99  最大  縮み最小 | 胸: p99  最大 | 断面最小(高さcm)   ひねり最大(高さcm)');
  const flag = (r) =>
    r.stretchP99.v > LIMITS.stretchP99 || r.stretchMax.v > LIMITS.stretchMax || r.stretchMin.v < LIMITS.stretchMin || r.chestP99.v > LIMITS.chestP99 || r.pinchMin.v < LIMITS.pinchMin || r.twistMax.v > LIMITS.twistMax ? ' ←' : '';
  let bad = 0;
  for (const r of result.results) {
    const f = flag(r);
    if (f) bad++;
    console.log(
      r.name.padEnd(24),
      r.stretchP99.v.toFixed(2).padStart(6), `f${r.stretchP99.f}`.padEnd(4),
      r.stretchMax.v.toFixed(2).padStart(5),
      r.stretchMin.v.toFixed(2).padStart(5), '|',
      r.chestP99.v.toFixed(2).padStart(5), r.chestMax.v.toFixed(2).padStart(5), '|',
      r.pinchMin.v.toFixed(2).padStart(5), `(${r.pinchMin.y}cm f${r.pinchMin.f})`.padEnd(14),
      r.twistMax.v.toFixed(1).padStart(5), `度/cm (${r.twistMax.y}cm f${r.twistMax.f})` + f,
    );
  }
  const wp = result.results.reduce((m, r) => Math.min(m, r.pinchMin.v), 9);
  const wt = result.results.reduce((m, r) => Math.max(m, r.twistMax.v), 0);
  const ws = result.results.reduce((m, r) => Math.max(m, r.stretchP99.v), 0);
  console.log(`\n全クリップの最悪値: 腰の伸び p99 ${ws.toFixed(2)} / 断面 ${wp.toFixed(2)} / ひねり ${wt.toFixed(1)} 度/cm  （しきい値 腰の p99 ≤ ${LIMITS.stretchP99}・最大 ≤ ${LIMITS.stretchMax}・最小 ≥ ${LIMITS.stretchMin}、胸の p99 ≤ ${LIMITS.chestP99}、断面 ≥ ${LIMITS.pinchMin}、ひねり ≤ ${LIMITS.twistMax}。超過 ${bad} クリップ）`);
  if (worstN > 0) {
    const all = [];
    for (const r of result.results) {
      all.push({ name: r.name, kind: 'pinch', v: r.pinchMin.v, f: r.pinchMin.f }, { name: r.name, kind: 'twist', v: r.twistMax.v, f: r.twistMax.f }, { name: r.name, kind: 'stretchP99', v: r.stretchP99.v, f: r.stretchP99.f });
    }
    console.log('\n最悪のフレーム（motion-sheet --clip <名前> --frames <f> --cam back --dist 0.85 --height 1.0 で見に行く）:');
    for (const kind of ['pinch', 'twist', 'stretchP99']) {
      const list = all.filter((x) => x.kind === kind).sort((a, b) => (kind === 'pinch' ? a.v - b.v : b.v - a.v)).slice(0, worstN);
      console.log(`  ${kind}: ${list.map((x) => `${x.name} f${x.f} (${x.v.toFixed(2)})`).join(' / ')}`);
    }
  }
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ step, limits: LIMITS, ...result }, null, 2));
  if (check && bad > 0) process.exitCode = 2;
} catch (e) {
  console.error(e);
  failed = true;
} finally {
  await browser.close();
  try { process.kill(-server.pid, 'SIGTERM'); } catch {}
  process.exit(failed ? 1 : process.exitCode ?? 0);
}
