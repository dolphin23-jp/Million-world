#!/usr/bin/env node
/**
 * 剣の握りの数値検査（ADR-023）: 手付けクリップを実際の骨で再生し、両手が柄を握れているかをフレームごとに測る。
 *
 *   npm run build && node tools/grip-check.mjs [--weapon greatsword] [--step 2] [--worst] [クリップ名 ...]
 *   例: node tools/grip-check.mjs gs1 gsHeavy        node tools/grip-check.mjs --weapon greatsword --worst   （大剣の全クリップの最悪値）
 *
 * 柄の軸 = 右手の握りの位置（剣のソケット）から刃の向きの直線。各手の「手のひらの中心」（右手は HERO.sword.position、左手はその鏡像 rig.data.gripL）を世界へ出して測る:
 *  - 軸からの距離（cm）: 手のひらの中心が柄の軸からどれだけ離れているか。0 に近いほど柄を握っている（右手は固定の握りなので ≈ 0）
 *  - 軸の向きのずれ（°）: 手ボーンのローカルの「握りの軸」（右 = 刃の向き、左 = その鏡像）と、世界の柄の向きのなす角。0 なら握りの向きが合っている
 *  - 左手の位置（石突き側へ cm）: 右手の握りから左手のひらまでの、柄の軸に沿った距離（両手持ちの offset = 24cm になる）
 * 片手剣のクリップでは右手だけを測る（左手は柄を握らない）。左手の列は、そのクリップが両手持ち（大剣）のときだけ意味がある。
 * 出力: 1 行 = 1 フレーム（--step ごと）。--worst はクリップごとの最大値だけ。しきい値（GRIP_LIMITS）を超えると ← を付け、--check で終了コード 2。
 */
import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';

const require = createRequire(import.meta.url);
function loadPlaywright() {
  try { return require('playwright'); } catch { return require(`${execSync('npm root -g').toString().trim()}/playwright`); }
}
/** 両手持ちで許す握りのずれ。手のひらの中心が柄の軸から 2.5cm 以内（手の幅の半分に収まる）、向きのずれ 25° 以内 */
const GRIP_LIMITS = { distCm: 2.5, axisDeg: 25 };
/** 待機の腕（下ろした手）から構え・担ぎの姿勢へ入る遷移のクリップ。最初の数フレームは左手が柄に届かない（もとから 6〜8 フレーム。腕のクランプ）ので、しきい値の対象にしない */
const TRANSITION_CLIPS = new Set(['gsStance', 'gsCarry']);

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : def; };
const step = Number(opt('step', 2));
const weapon = opt('weapon', null);
const worstOnly = argv.includes('--worst');
const check = argv.includes('--check');
const skipValues = new Set(['--weapon', '--step']);
const names = argv.filter((a, i) => !a.startsWith('--') && !skipValues.has(argv[i - 1]));

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
  if (weapon) {
    const ok = await page.evaluate((id) => {
      const g = window.__mw.game;
      if (!g.setLoadout(id)) return false;
      g.player.visual.update(g.player, 0, 0);
      return true;
    }, weapon);
    if (!ok) throw new Error(`装備を替えられません: ${weapon}`);
  }
  const result = await page.evaluate(([clipNames]) => {
    const g = window.__mw.game;
    g.loop.stop();
    const THREE = window.__mw.THREE;
    const vis = g.player.visual;
    const an = vis.animator;
    const root = vis.root;
    const rig = vis.capture.rig;
    const get = (n) => { let f = null; root.traverse((o) => { if (o.isBone && o.name === n) f = o; }); return f; };
    const handR = get('RightHand');
    const handL = get('LeftHand');
    const socket = root.getObjectByName('sword-socket');
    const gripR = rig.data.grip;
    const gripL = rig.data.gripL ?? null;
    // 握りの軸（手ボーンのローカル）: 右 = 剣の +Y を握りの回転で写したもの、左 = その鏡像（gripL.quat で同じ）
    const axisR = new THREE.Vector3(0, 1, 0).applyQuaternion(gripR.quat);
    const axisL = gripL ? new THREE.Vector3(0, 1, 0).applyQuaternion(gripL.quat) : null;
    const all = clipNames.length ? clipNames : Object.keys(vis.authoredStats);
    const out = {};
    const q = new THREE.Quaternion();
    const pR = new THREE.Vector3(), pL = new THREE.Vector3(), G = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3(), a = new THREE.Vector3();
    for (const name of all) {
      if (!an.has(name)) { out[name] = { error: 'no clip' }; continue; }
      const dur = an.duration(name);
      an.mixer.stopAllAction();
      const act = an.play(name, { loop: false, fade: 0, restart: true, rate: 1, clamp: true });
      an.mixer.update(0.01);
      const rows = [];
      const frames = Math.round(dur * 60);
      for (let f = 0; f <= frames; f++) {
        act.time = Math.min(f / 60, dur - 1e-6);
        an.mixer.update(0);
        root.updateMatrixWorld(true);
        socket.getWorldPosition(G);
        socket.getWorldQuaternion(q);
        b.set(0, 1, 0).applyQuaternion(q);
        const row = { f };
        // 右手: 手のひらの中心 = 手ボーンの位置 + 手の回転 × 握りの位置
        handR.getWorldPosition(pR);
        handR.getWorldQuaternion(q);
        pR.addScaledVector(d.copy(gripR.pos).applyQuaternion(q), 1);
        d.copy(pR).sub(G);
        row.rDist = (d.sub(a.copy(b).multiplyScalar(d.dot(b))).length()) * 100;
        row.rAxis = (Math.acos(Math.max(-1, Math.min(1, a.copy(axisR).applyQuaternion(q).dot(b)))) * 180) / Math.PI;
        if (gripL) {
          handL.getWorldPosition(pL);
          handL.getWorldQuaternion(q);
          pL.addScaledVector(d.copy(gripL.pos).applyQuaternion(q), 1);
          d.copy(pL).sub(G);
          row.lAlong = d.dot(b) * 100;
          row.lDist = d.sub(a.copy(b).multiplyScalar(d.dot(b))).length() * 100;
          row.lAxis = (Math.acos(Math.max(-1, Math.min(1, a.copy(axisL).applyQuaternion(q).dot(b)))) * 180) / Math.PI;
        }
        rows.push(row);
      }
      out[name] = { rows, two: Boolean(rig.data.gripL) && Boolean(vis.authoredStats[name]) && vis.authoredStats[name].maxWristBendLDeg > 0 };
    }
    return out;
  }, [names]);
  const f1 = (v) => (v === undefined ? '    -' : v.toFixed(1).padStart(6));
  let exceeded = 0;
  console.log(worstOnly ? 'クリップ               両手   右:距離 右:向き  左:距離 左:向き  左:石突き側' : '  f   右:距離 右:向き  左:距離 左:向き  左:石突き側(cm)');
  for (const [name, r] of Object.entries(result)) {
    if (r.error) { console.log(name, r.error); continue; }
    const rows = r.rows;
    const mx = (k) => Math.max(...rows.map((x) => Math.abs(x[k] ?? 0)));
    const over = r.two && !TRANSITION_CLIPS.has(name) && (mx('lDist') > GRIP_LIMITS.distCm || mx('lAxis') > GRIP_LIMITS.axisDeg);
    if (over) exceeded++;
    if (worstOnly) {
      console.log(name.padEnd(22), r.two ? ' 両手' : ' 片手', f1(mx('rDist')), f1(mx('rAxis')), r.two ? f1(mx('lDist')) : '     -', r.two ? f1(mx('lAxis')) : '     -', r.two ? f1(Math.min(...rows.map((x) => x.lAlong))) + '〜' + f1(Math.max(...rows.map((x) => x.lAlong))) : '', over ? ' ←' : '');
    } else {
      console.log(`クリップ ${name}${r.two ? '（両手持ち）' : ''}`);
      for (const x of rows) if (x.f % step === 0) console.log(String(x.f).padStart(3), f1(x.rDist), f1(x.rAxis), r.two ? f1(x.lDist) : '     -', r.two ? f1(x.lAxis) : '     -', r.two ? f1(x.lAlong) : '');
    }
  }
  if (check && exceeded) {
    console.error(`握りのしきい値（軸からの距離 ${GRIP_LIMITS.distCm}cm、向き ${GRIP_LIMITS.axisDeg}°）を超えたクリップ: ${exceeded}`);
    failed = true;
    process.exitCode = 2;
  }
} catch (e) {
  console.error(e);
  failed = true;
} finally {
  await browser.close();
  try { process.kill(-server.pid, 'SIGTERM'); } catch {}
  process.exit(failed ? (process.exitCode ?? 1) : 0);
}
