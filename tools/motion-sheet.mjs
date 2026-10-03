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
 *   --weapon <id>                装備（ある場合）。例: greatsword
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
const weapon = opt('weapon', null);
const aim = opt('aim', null) ? opt('aim').split(',').map(Number) : null;
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

  await page.evaluate(([cam, yaw, focus, dist, h, pitch, weapon, aim]) => {
    const g = window.__mw.game;
    g.loop.stop();
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
  }, [camName, CAMS[camName] ?? CAMS.side, focusZ, dist, height, pitch, weapon, aim]);

  const shots = [];
  let at = 0;
  for (const target of frames) {
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
    await sleep(60);
    shots.push({ frame: target, buf: await page.screenshot({ type: 'png' }) });
  }

  // ---- 並べる ----
  const tw = Math.round(W * 0.5);
  const th = Math.round(H * 0.5);
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
