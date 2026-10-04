#!/usr/bin/env node
/**
 * モーションシート: ゲーム内で手付けクリップを 1 フレームずつ進め、定点のカメラで撮った姿勢を 1 枚に並べる。
 * 手付けモーション（ADR-012）を目視で検査するための道具（実機が無いので、動きは静止画の連続で確かめる）。
 *
 *   npm run build && node tools/motion-sheet.mjs <ラベル> [オプション]
 *
 *   --script "0:{...};22:{...}"   フレーム番号:入力(JSON) の列。0 番の入力で技が始まる（InputIntent の一部。下の例）。
 *                                 "5-30:{...}" と書くと 5〜30 の毎フレームに同じ入力（長押し）
 *                                 "dir":[x,z] を書くと、ワールドの向き（キャラは +Z を向く）でスティックを倒す（カメラの向きに関わらず）
 *   --frames 0,6,12,18           撮るフレーム（開始から進めた sim ステップ数。0 = 待機の姿勢）。省略すると --end を --count 等分
 *   --end 36 --count 8           撮る範囲と枚数（--frames が無いとき）
 *   --cam side|front|back|three|top  カメラの向き。既定は side（キャラは +Z を向く。side は +X 側から見るので、前は画面の左）
 *   --focus 0.0                  注視点の z（前進する動きは中ほどに置く）  --dist 4.2  --height 1.0  --pitch 0.12
 *   --cols 4                     1 行に並べる枚数
 *   --no-outline                 主人公の輪郭線（inverted hull）を隠す。腰まわりの黒いギザギザが輪郭線の突き抜けか、メッシュの変形かを切り分けるとき
 *   --mode tex|weights|normals|wire  主人公の見せ方。weights = スキンの重みを色で（赤 Hips / 緑 Spine02 / 青 Spine01 / シアン Spine / 黄 脚 / マゼンタ 腕 / 白 首・頭）、
 *                                 normals = 法線の色、wire = ワイヤーフレーム。輪郭線は隠す。変形の崩れが重みのせいか形のせいかを切り分けるとき。
 *                                 ybands = テクスチャの上に、Hips の高さからの 1cm ごとの帯（5cm ごとに赤・10cm ごとに緑）を重ねる（服の縁や関節の高さを測る）。
 *                                 wsum:<ボーン名の正規表現> = 該当ボーンの重みの合計を 0.1 刻みの等高線つきの虹色で（青 0 → 赤 1）。例: --mode 'wsum:UpLeg|Leg'  /  --mode 'wsum:^Hips$'
 *   --tile 0.5                   1 コマの大きさ（撮影サイズ 900×640 に対する倍率。1 にすると縮めない。腰まわりなど細部を見るとき --dist 1.2 と合わせる）
 *   --weapon <id>                装備（ロードアウトの id）。例: sword-shield（盾を持つ。盾版の技が出る）
 *   --clip <名前>                sim を使わず、焼いたクリップを直接指定して --frames の時刻（60fps のフレーム番号）の姿勢を撮る。
 *                                ガードの構えなど、状態機械を通さず姿勢だけ見たいとき。例: --clip guardShield  /  --clip combo1@shield
 *   --track grip|hands|handR|handL|tip   注視点をフレームごとに追尾する（握りの検査用。--dist 1.0 前後で拡大。grip = 右手の握り（剣の柄の位置）、hands = 両手の中点、tip = 剣先）。
 *                                --height は使われない（追尾の位置が注視点）。--cam front|side|back|three で見る向きを変える
 *   --skill <id>                 スキルボタンで使うスキルを選ぶ（剣技の動きを見るとき。script に {"skillPressed":true} を書く。ADR-031）
 *   --aim 0,4                    ロックオン中にする（対象の位置 x,z。サンドボックスには敵がいないので、ロック中だけに出る技を撮るため）
 *
 *   例: 回避  node tools/motion-sheet.mjs dodge --script '0:{"dodgePressed":true,"dir":[0,1]}' --end 36 --focus 1.4
 *       1 段目 node tools/motion-sheet.mjs combo1 --script '0:{"attackPressed":true}' --end 40 --cam three
 *
 * 出力: artifacts/motion/<ラベル>-<cam>.png（各コマにフレーム番号と時刻を書く）
 */
import { spawn, execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';

const require = createRequire(import.meta.url);
function loadModule(name) {
  try { return require(name); } catch { return require(`${execSync('npm root -g').toString().trim()}/${name}`); }
}

// ---- 引数 ----
const argv = process.argv.slice(2);
const label = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'motion';
const opt = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : def; };
const camName = opt('cam', 'side');
const end = Number(opt('end', 36));
const count = Number(opt('count', 8));
const frames = opt('frames', null)
  ? opt('frames').split(',').map(Number)
  : Array.from({ length: count }, (_, i) => Math.round((i / (count - 1)) * end));
const focusZ = Number(opt('focus', 0));
const dist = Number(opt('dist', 4.2));
const height = Number(opt('height', 1.0));
const pitch = Number(opt('pitch', 0.12));
const cols = Number(opt('cols', 4));
const tileScale = Number(opt('tile', 0.5));
const noOutline = argv.includes('--no-outline');
const mode = opt('mode', 'tex');
const weapon = opt('weapon', null);
const clipName = opt('clip', null);
const track = opt('track', null);
const aim = opt('aim', null) ? opt('aim').split(',').map(Number) : null;
const skillId = opt('skill', null);
const script = {};
for (const part of (opt('script', '0:{}') ?? '').split(';').filter(Boolean)) {
  const k = part.indexOf(':');
  const value = JSON.parse(part.slice(k + 1));
  // "a-b:{...}" は a〜b の毎フレーム（押し続ける入力に使う。同じフレームに複数あれば合成）
  const [from, to = from] = part.slice(0, k).split('-').map(Number);
  for (let f = from; f <= to; f++) script[f] = { ...script[f], ...value };
}
const CAMS = { side: Math.PI / 2, front: 0, back: Math.PI, three: Math.PI / 2 + 0.75, top: Math.PI / 2 };

// ---- サーバとブラウザ ----
const port = 4190 + Math.floor(Math.random() * 9);
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore', detached: true });
const url = `http://127.0.0.1:${port}/?autostart=1&adaptive=0&mute=1&sandbox=1&debug=0`;
for (let i = 0; i < 40; i++) {
  await sleep(250);
  try { if ((await fetch(url)).ok) break; } catch {}
}

const sharp = loadModule('sharp');
const { chromium } = loadModule('playwright');
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
mkdirSync('artifacts/motion', { recursive: true });
let failed = false;
try {
  const W = 900;
  const H = 640;
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.goto(url);
  await page.waitForFunction(() => Boolean(window.__mw?.game?.ready), null, { timeout: 60000 });
  await sleep(500);
  await page.addStyleTag({ content: '#touch-layer, #hud, #start-overlay, #banner, #result { display: none !important; }' });

  // 追尾カメラ（--track）: いま描いたフレームの握りなどの位置へ注視点を置き直して描き直す
  await page.evaluate(() => {
    window.__trackPin = (mode) => {
      const g = window.__mw.game;
      const THREE = window.__mw.THREE;
      const root = g.player.visual.root;
      root.updateMatrixWorld(true);
      const at = (name) => root.getObjectByName(name)?.getWorldPosition(new THREE.Vector3());
      const grip = at('sword-socket');
      const handR = at('RightHand');
      const handL = at('LeftHand');
      let p = null;
      if (mode === 'grip') p = grip;
      else if (mode === 'handR') p = handR;
      else if (mode === 'handL') p = handL;
      else if (mode === 'hands') p = handR && handL ? handR.clone().add(handL).multiplyScalar(0.5) : handR;
      else if (mode === 'tip') {
        const sock = root.getObjectByName('sword-socket');
        if (sock) {
          const q = sock.getWorldQuaternion(new THREE.Quaternion());
          p = grip.clone().add(new THREE.Vector3(0, 1, 0).applyQuaternion(q).multiplyScalar(0.9));
        }
      }
      if (!p) throw new Error('--track: 位置が取れません: ' + mode);
      g.cam.pin(p.x, p.y, p.z);
      g.renderNow(1);
    };
  });

  await page.evaluate(([cam, yaw, focus, dist, h, pitch, weapon, aim, noOutline, mode, skillId]) => {
    const g = window.__mw.game;
    g.loop.stop();
    if (skillId) g.skills.select(skillId);
    if (noOutline || mode !== 'tex') g.player.visual.root.traverse((o) => { if (o.name.endsWith('__outline')) o.visible = false; });
    if (mode !== 'tex') {
      const THREE = window.__mw.THREE;
      g.player.visual.root.traverse((o) => {
        if (!o.isSkinnedMesh || o.name.endsWith('__outline')) return;
        if (mode === 'normals') o.material = new THREE.MeshNormalMaterial();
        else if (mode === 'wire') o.material = new THREE.MeshBasicMaterial({ color: 0x223355, wireframe: true });
        else if (mode === 'ybands') {
          // 寸法はバインド姿勢のジオメトリ空間（m。足裏が 0）。Hips の高さは骨の逆バインド行列から求める。帯はフラグメントで引く（頂点色だと細かい三角形で点々になる）
          const hi = o.skeleton.bones.findIndex((b) => b.name === 'Hips');
          const hy = new THREE.Vector3().setFromMatrixPosition(o.skeleton.boneInverses[hi].clone().invert()).y;
          const mat = new THREE.MeshBasicMaterial({ map: o.material.map });
          mat.onBeforeCompile = (sh) => {
            sh.uniforms.uHipsY = { value: hy };
            sh.vertexShader = sh.vertexShader.replace('void main() {', 'varying float vBindY;\nvoid main() {').replace('#include <begin_vertex>', '#include <begin_vertex>\n vBindY = position.y;');
            sh.fragmentShader = sh.fragmentShader.replace('void main() {', 'varying float vBindY;\nuniform float uHipsY;\nvoid main() {')
              .replace('#include <dithering_fragment>', `#include <dithering_fragment>
                float cm = (vBindY - uHipsY) * 100.0; float k = floor(cm + 0.0001); float fr = cm - k;
                float w = max(fwidth(cm) * 1.6, 0.09);
                float line = 1.0 - smoothstep(0.0, max(w, 0.0001), fr);
                float kk = mod(k + 1000.0, 10.0);
                vec3 lc = kk < 0.5 ? vec3(0.0, 0.8, 0.0) : (mod(k + 1000.0, 5.0) < 0.5 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 0.0));
                float strength = kk < 0.5 ? 1.0 : (mod(k + 1000.0, 5.0) < 0.5 ? 1.0 : 0.55);
                if (kk < 0.5 || mod(k + 1000.0, 5.0) < 0.5) line = 1.0 - smoothstep(0.0, max(fwidth(cm) * 3.2, 0.2), fr);
                gl_FragColor.rgb = mix(gl_FragColor.rgb, lc, line * strength);`);
          };
          o.material = mat;
        } else if (mode.startsWith('wsum:')) {
          const re = new RegExp(mode.slice(5));
          const geo = o.geometry; const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight; const n = si.count;
          const sel = o.skeleton.bones.map((b) => re.test(b.name));
          const col = new Float32Array(n * 3);
          const hsv = (h) => { const f = (k) => { const x = (k + h * 6) % 6; return 1 - Math.max(0, Math.min(1, Math.min(x, 4 - x))); }; return [f(5), f(3), f(1)]; };
          for (let i = 0; i < n; i++) {
            let w = 0; for (let k = 0; k < 4; k++) if (sel[si.getComponent(i, k)]) w += sw.getComponent(i, k);
            const band = Math.min(9, Math.floor(w * 10 + 1e-6)); const t = band / 9; // 0.1 刻みの段
            const c = hsv((1 - t) * 0.66); const edge = (w * 10) % 1 < 0.1 ? 0.55 : 1; // 段の境目を少し暗く
            col[i * 3] = c[0] * edge; col[i * 3 + 1] = c[1] * edge; col[i * 3 + 2] = c[2] * edge;
          }
          geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
          o.material = new THREE.MeshBasicMaterial({ vertexColors: true });
        } else if (mode === 'weights') {
          const pal = (n) => (n === 'Hips' ? [1, 0, 0] : n === 'Spine02' ? [0, 1, 0] : n === 'Spine01' ? [0, 0, 1] : n === 'Spine' ? [0, 1, 1]
            : /Leg|Foot|Toe/.test(n) ? [1, 1, 0] : /Shoulder|Arm|Hand/.test(n) ? [1, 0, 1] : /neck|Head|head/.test(n) ? [1, 1, 1] : [0.5, 0.5, 0.5]);
          const geo = o.geometry; const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight; const n = si.count;
          const col = new Float32Array(n * 3);
          for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w <= 0) continue; const c = pal(o.skeleton.bones[si.getComponent(i, k)].name); col[i * 3] += c[0] * w; col[i * 3 + 1] += c[1] * w; col[i * 3 + 2] += c[2] * w; }
          geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
          o.material = new THREE.MeshBasicMaterial({ vertexColors: true });
        }
      });
    }
    if (weapon && g.player.equip) g.player.equip(weapon);
    g.player.reset();
    // ロック中にする: Game.step が毎フレーム setAim(null) を呼ぶので、差し替えて固定する
    if (aim) {
      g.player.setAim({ x: aim[0], z: aim[1] });
      g.player.setAim = () => {};
    }
    g.cam.yaw = yaw;
    g.cam.pitch = cam === 'top' ? 1.35 : pitch;
    g.cam.distance = dist;
    g.cam.pin(0, h, focus);
    g.stepNow(30);
    g.renderNow(3);
  }, [camName, CAMS[camName] ?? CAMS.side, focusZ, dist, height, pitch, weapon, aim, noOutline, mode, skillId]);

  const shots = [];
  let at = 0;
  for (const target of frames) {
    if (clipName) {
      // クリップを直接再生して、その時刻で止めて撮る（止めたアクションはアニメーターの更新で進まない）
      const err = await page.evaluate(([name, f]) => {
        const g = window.__mw.game;
        const an = g.player.visual.animator;
        if (!an.has(name)) return `クリップがありません: ${name}`;
        const act = an.play(name, { loop: false, fade: 0, restart: true, rate: 1, clamp: true });
        an.mixer.update(0.2); // クロスフェード・フェードインを完了させる（同じクリップの再生し直しは 0.05 秒かけて入るので、短いと別のクリップが混ざる）
        act.paused = true;
        act.time = Math.min(f / 60, an.duration(name) - 1e-6);
        an.mixer.update(0);
        g.renderNow(1);
        return null;
      }, [clipName, target]);
      if (err) throw new Error(err);
      at = target;
      if (track) await page.evaluate((m) => window.__trackPin(m), track);
      await sleep(60);
      shots.push({ frame: target, buf: await page.screenshot({ type: 'png' }) });
      continue;
    }
    await page.evaluate(([from, to, script, yaw]) => {
      const g = window.__mw.game;
      // "dir": [x, z]（ワールドの向き）を、カメラの yaw に合わせたスティック入力に直す。前 = (−sin yaw, −cos yaw)、右 = (cos yaw, −sin yaw)
      const toIntent = (it, yaw) => {
        if (!it.dir) return it;
        const { dir, ...rest } = it;
        return { ...rest, moveX: dir[0] * Math.cos(yaw) + dir[1] * -Math.sin(yaw), moveY: dir[0] * -Math.sin(yaw) + dir[1] * -Math.cos(yaw) };
      };
      if (to === from) {
        g.renderNow(2);
        return;
      }
      for (let k = from; k < to; k++) {
        if (script[k]) g.inject(toIntent(script[k], yaw));
        g.stepNow(1);
        // 見たいフレームだけ描く。途中のフレームはアニメーションを進めるだけ
        if (k + 1 === to) g.renderNow(1);
        else g.tickVisual(1);
      }
    }, [at, target, script, CAMS[camName] ?? CAMS.side]);
    at = target;
    if (track) await page.evaluate((m) => window.__trackPin(m), track);
    await sleep(60);
    shots.push({ frame: target, buf: await page.screenshot({ type: 'png' }) });
  }

  // ---- 並べる ----
  const tw = Math.round(W * tileScale);
  const th = Math.round(H * tileScale);
  const rows = Math.ceil(shots.length / cols);
  const tiles = await Promise.all(
    shots.map(async (s, i) => {
      const img = await sharp(s.buf).resize(tw, th).png().toBuffer();
      const svg = Buffer.from(`<svg width="${tw}" height="${th}" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="4" width="118" height="22" rx="4" fill="rgba(0,0,0,0.6)"/><text x="10" y="20" font-family="monospace" font-size="14" fill="#fff">f${s.frame}  ${(s.frame / 60).toFixed(2)}s</text></svg>`);
      return { input: await sharp(img).composite([{ input: svg }]).png().toBuffer(), left: (i % cols) * tw, top: Math.floor(i / cols) * th };
    }),
  );
  const out = `artifacts/motion/${label}-${camName}.png`;
  await sharp({ create: { width: tw * cols, height: th * rows, channels: 3, background: '#222' } }).composite(tiles).png().toFile(out);
  console.log(out);
} catch (e) {
  console.error(e);
  failed = true;
} finally {
  await browser.close();
  try { process.kill(-server.pid, 'SIGTERM'); } catch {}
  process.exit(failed ? 1 : 0);
}
