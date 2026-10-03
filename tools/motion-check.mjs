#!/usr/bin/env node
/**
 * 手付けクリップの数値検査: 各部位の床からの高さ（めり込み・浮き）、接地足の滑り、剣先の速さを、実際の骨で測る。
 *
 *   npm run build && node tools/motion-check.mjs <クリップ名> [--step 2] [--all]
 *   例: node tools/motion-check.mjs dodge --step 2
 *
 * 出力: 1 行 = 1 フレーム（--step ごと）。ルートの前進（rootZ）は含まない（高さは影響されない）。
 *   hipsY / headY / handR / handL / footL / footR / tip（剣先）/ min（上のうち最低の高さ）。
 *   末尾に要約: 最低の高さ（床下 = めり込み）と、その部位・時刻、剣先の最高速。
 * クリップ名は game.player のアニメーターに登録された名前（combo1 / combo2 / combo3 / heavy / dodge など）。
 *
 *   node tools/motion-check.mjs <クリップ名> --weapon greatsword   装備（ロードアウトの id）を替えて測る（剣先の高さ・速さは武器ごとの刃の長さ）
 *   node tools/motion-check.mjs --trace <クリップ名>   フレームごとの腕の挙上角・肘・手首の曲がり/ねじれ・握りの誤差（BakeStats の元の値。どこで超えたかを探す）
 *   node tools/motion-check.mjs --stats      全クリップの焼き込み統計（BakeStats）を 1 行ずつ出す。
 *     腕/脚のクランプ（到達不能で諦めたフレーム数。0 が目標）、腰の沈み、握りの誤差、右上腕の最大挙上角（130° 以下）、
 *     右手首の曲がり・ねじれ（ねじれは 150° 以下）、右肘の最小の曲がり（0 に近いと伸び切り）
 */
import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';

const require = createRequire(import.meta.url);
function loadPlaywright() {
  try { return require('playwright'); } catch { return require(`${execSync('npm root -g').toString().trim()}/playwright`); }
}
const argv = process.argv.slice(2);
const statsMode = argv.includes('--stats');
const traceIdx = argv.indexOf('--trace');
const traceName = traceIdx >= 0 ? argv[traceIdx + 1] : null;
const name = argv[0];
if (!statsMode && !traceName && (!name || name.startsWith('--'))) {
  console.error('使い方: node tools/motion-check.mjs <クリップ名> [--step 2]   または   --stats');
  process.exit(1);
}
const stepIdx = argv.indexOf('--step');
const step = stepIdx >= 0 ? Number(argv[stepIdx + 1]) : 2;
const weaponIdx = argv.indexOf('--weapon');
const weapon = weaponIdx >= 0 ? argv[weaponIdx + 1] : null;

const port = 4170 + Math.floor(Math.random() * 9);
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
  if (weapon) {
    // 装備を替えて、見た目（武器のメッシュ）に反映させる（描画ループを回さないので update を 1 回呼ぶ）
    const ok = await page.evaluate((id) => {
      const g = window.__mw.game;
      if (!g.setLoadout(id)) return false;
      g.player.visual.update(g.player, 0, 0);
      return true;
    }, weapon);
    if (!ok) throw new Error(`装備を替えられません: ${weapon}`);
  }
  if (traceName) {
    const trace = await page.evaluate((n) => window.__mw.game.player.visual.authoredTrace[n] ?? null, traceName);
    if (!trace) throw new Error(`クリップがありません: ${traceName}`);
    console.log(`クリップ ${traceName}: 1 行 = 1 フレーム`);
    console.log('  f     t  elev  elbow wBend wTwist  grip  hipsDrop');
    trace.forEach((r, f) => {
      if (f % step === 0) console.log(String(f).padStart(3), r.t.toFixed(2).padStart(5), r.armElevation.toFixed(0).padStart(5), r.elbowBend.toFixed(0).padStart(6), r.wristBend.toFixed(0).padStart(5), r.wristTwist.toFixed(0).padStart(6), r.gripError.toFixed(3).padStart(6), r.hipsDrop.toFixed(3).padStart(8));
    });
    await browser.close();
    try { process.kill(-server.pid, 'SIGTERM'); } catch {}
    process.exit(0);
  }
  if (statsMode) {
    const stats = await page.evaluate(() => Object.entries(window.__mw.game.player.visual.authoredStats));
    const f1 = (v) => v.toFixed(1).padStart(6);
    console.log('クリップ        frames  armR  armL   leg  hipsDrop  grip  elevR  wBend wTwist elbowMin');
    for (const [n, s] of stats) {
      const flag = s.armRClampedFrames || s.armLClampedFrames || s.legClampedFrames || s.maxArmElevationDeg > 130 || s.maxWristTwistDeg > 150 ? ' ←' : '';
      console.log(n.padEnd(14), String(s.frames).padStart(6), String(s.armRClampedFrames).padStart(5), String(s.armLClampedFrames).padStart(5), String(s.legClampedFrames).padStart(5), s.maxHipsDrop.toFixed(3).padStart(9), s.maxGripError.toFixed(3).padStart(5), f1(s.maxArmElevationDeg), f1(s.maxWristBendDeg), f1(s.maxWristTwistDeg), f1(s.minElbowBendDeg) + flag);
    }
    await browser.close();
    try { process.kill(-server.pid, 'SIGTERM'); } catch {}
    process.exit(0);
  }
  const result = await page.evaluate(([clipName, step]) => {
    const g = window.__mw.game;
    g.loop.stop();
    const vis = g.player.visual;
    const an = vis.animator;
    if (!an.has(clipName)) return { error: `クリップがありません: ${clipName}` };
    const dur = an.duration(clipName);
    // 直前に再生していたクリップ（装備を替えたときの待機など）が重みを残して姿勢に混ざらないよう、すべて止めてから再生する
    an.mixer.stopAllAction();
    const act = an.play(clipName, { loop: false, fade: 0, restart: true, rate: 1, clamp: true });
    // 直前のクリップからのクロスフェード（長さ 0）はミキサーの時間が進まないと完了しない。1 度だけ進めて、このクリップだけが効く状態にする
    an.mixer.update(0.01);
    const bones = vis.capture ? vis : null;
    const asset = vis.asset ?? null;
    const THREE = window.__mw.THREE;
    const root = vis.root;
    // 骨の名前 → Bone（CharacterAsset.bones）。見つからない骨は飛ばす
    const get = (n) => { let found = null; root.traverse((o) => { if (o.isBone && o.name === n) found = o; }); return found; };
    const parts = { hipsY: get('Hips'), headY: get('Head'), handR: get('RightHand'), handL: get('LeftHand'), footL: get('LeftFoot'), footR: get('RightFoot'), toeL: get('LeftToeBase'), toeR: get('RightToeBase') };
    const rows = [];
    const p = new THREE.Vector3();
    const base = new THREE.Vector3();
    const tip = new THREE.Vector3();
    let prevTip = null;
    let maxTip = 0;
    const frames = Math.round(dur * 60);
    for (let f = 0; f <= frames; f += 1) {
      act.time = Math.min(f / 60, dur - 1e-6);
      an.mixer.update(0);
      root.updateMatrixWorld(true);
      const row = { f };
      for (const [k, b] of Object.entries(parts)) {
        if (!b) continue;
        b.getWorldPosition(p);
        row[k] = p.y;
      }
      vis.getBladePoints(base, tip);
      row.tip = tip.y;
      if (prevTip) maxTip = Math.max(maxTip, tip.distanceTo(prevTip) * 60);
      prevTip = tip.clone();
      row.min = Math.min(...['hipsY', 'headY', 'handR', 'handL', 'footL', 'footR', 'tip'].map((k) => row[k] ?? 9));
      rows.push(row);
    }
    return { dur, rows, maxTipSpeed: maxTip };
  }, [name, step]);
  if (result.error) throw new Error(result.error);
  const fmt = (v) => (v === undefined ? '    -' : v.toFixed(2).padStart(5));
  console.log(`クリップ ${name}（${result.dur.toFixed(2)}s）`);
  console.log('  f   t  hipsY headY handR handL footL footR   tip   min');
  let lowest = { v: 9, k: '', f: 0 };
  for (const r of result.rows) {
    for (const k of ['headY', 'handR', 'handL', 'footL', 'footR', 'tip']) if (r[k] !== undefined && r[k] < lowest.v) lowest = { v: r[k], k, f: r.f };
    if (r.f % step === 0) console.log(String(r.f).padStart(3), (r.f / 60).toFixed(2), fmt(r.hipsY), fmt(r.headY), fmt(r.handR), fmt(r.handL), fmt(r.footL), fmt(r.footR), fmt(r.tip), fmt(r.min));
  }
  console.log(`\n最低の高さ: ${lowest.v.toFixed(3)}m（${lowest.k}、f${lowest.f}）${lowest.v < 0 ? ' ← 床にめり込んでいる' : ''}`);
  console.log(`剣先の最高速: ${result.maxTipSpeed.toFixed(1)} m/s`);
} catch (e) {
  console.error(e);
  failed = true;
} finally {
  await browser.close();
  try { process.kill(-server.pid, 'SIGTERM'); } catch {}
  process.exit(failed ? 1 : 0);
}
