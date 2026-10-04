#!/usr/bin/env node
/**
 * ヘッドレス Chromium（SwiftShader）で描画し、スクリーンショットを artifacts/ に出力する。
 * 性能は見ない。見た目の崩れを確認するためだけのツール。
 *
 *   npm run shot                 # dist/ を vite preview で配信して撮る（先に npm run build）
 *   npm run shot -- --dev        # 開発サーバ（別途 npm run dev 済み）に対して撮る
 *
 * playwright はプロジェクトに依存として入れていない。ローカル or グローバルのどちらかを解決する。
 */
import { spawn, execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';

const require = createRequire(import.meta.url);

function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    const globalRoot = execSync('npm root -g').toString().trim();
    return require(`${globalRoot}/playwright`);
  }
}

const args = new Set(process.argv.slice(2));
const useDev = args.has('--dev');
const BASE = process.env.BASE_PATH ?? '/';
const port = useDev ? 5173 : 4173;
const url = `http://127.0.0.1:${port}${BASE}?autostart=1&adaptive=0`;

mkdirSync('artifacts', { recursive: true });

/** 単体の戦闘構成（ページ側で restart(def) に渡す）。決定的に撮るために敵 1 体だけにする */
/** スロットボタンの一覧の位置（同心円。src/input/slot-layout.ts の既定の内側の輪と同じ式。n 個のうち i 番目の、ボタンの中心からの差 px） */
function slotPos(n, i) {
  const R = 116;
  const a = -Math.PI / 2 + (i - (n - 1) / 2) * (76 / R);
  return { x: Math.cos(a) * R, y: Math.sin(a) * R };
}
const SOLO = { waves: [[{ type: 'imp', offset: 0, radius: 6 }]], waveGapFrames: 100, victoryDelayFrames: 75, defeatDelayFrames: 150, maxAttackers: 2 };
/** 敵 3 体（ロックオンの撮影用） */
const TRIO = { ...SOLO, waves: [[{ type: 'imp', offset: -0.5, radius: 7 }, { type: 'imp', offset: 0, radius: 8 }, { type: 'imp', offset: 0.5, radius: 7 }]] };

let server = null;
if (!useDev) {
  server = spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
    { stdio: ['ignore', 'ignore', 'pipe'], detached: true },
  );
  server.stderr.on('data', (d) => process.stderr.write(d));
  // 起動待ち
  let ok = false;
  for (let i = 0; i < 40 && !ok; i++) {
    await sleep(250);
    try {
      const r = await fetch(url);
      ok = r.ok;
    } catch {}
  }
  if (!ok) {
    console.error('preview サーバが起動しませんでした');
    server.kill();
    process.exit(1);
  }
}

const { chromium } = loadPlaywright();
const browser = await chromium.launch({
  headless: true,
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
  ],
});

try {
  // iPad Pro 11" 横持ち相当（CSS px）。DPR は 2 だが SwiftShader なので 1 で撮る
  const page = await browser.newPage({ viewport: { width: 1194, height: 834 }, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__mw?.game?.ready), null, { timeout: 60000 });
  await sleep(1200);

  // 1. 待機
  await page.screenshot({ path: 'artifacts/shot-idle.png' });

  // 2. 走り（右前方へ 40 ステップ）
  await page.evaluate(() => {
    const g = window.__mw.game;
    for (let i = 0; i < 40; i++) {
      g.inject({ moveX: 0.6, moveY: 0.8 });
      g.stepNow(1);
    }
  });
  await sleep(150);
  await page.screenshot({ path: 'artifacts/shot-run.png' });

  // 3. 攻撃の持続フレーム付近
  await page.evaluate(() => {
    const g = window.__mw.game;
    g.inject({ attackPressed: true });
    g.stepNow(1);
    g.stepNow(20);
  });
  await sleep(150);
  await page.screenshot({ path: 'artifacts/shot-attack.png' });

  // 4. 回避中
  await page.evaluate(() => {
    const g = window.__mw.game;
    g.stepNow(40);
    g.inject({ dodgePressed: true, moveX: -1, moveY: 0 });
    g.stepNow(1);
    g.stepNow(12);
  });
  await sleep(150);
  await page.screenshot({ path: 'artifacts/shot-dodge.png' });

  // 5〜7. 戦闘（ループを止め、sim と描画を手で進める）。敵の正面で 1 段目 → 命中直後 → 倒れる途中
  await page.evaluate((solo) => {
    const g = window.__mw.game;
    g.loop.stop();
    g.restart(solo);
    g.stepNow(60);
    g.player.body.x = 0;
    g.player.body.z = 0;
    g.player.yaw = 0;
    g.enemies[0].enemy.place(0, 1.9, Math.PI);
    g.renderNow(30);
  }, SOLO);
  await page.screenshot({ path: 'artifacts/shot-combat-ready.png' });

  await page.evaluate(() => {
    const g = window.__mw.game;
    const e = g.enemies[0].enemy;
    g.inject({ attackPressed: true });
    g.stepNow(1);
    for (let i = 0; i < 60 && e.hitSerial === 0; i++) g.stepNow(1);
    g.renderNow(3);
  });
  await page.screenshot({ path: 'artifacts/shot-combat-hit.png' });

  // 会心（ADR-035）: 乱数を固定して、会心でない 1 発と会心の 1 発を当てる。会心はダメージが会心ダメージ（初期 ×1.5）になり、金色の大きな数字（末尾に「!」）が出る
  const critShot = await page.evaluate((solo) => {
    const g = window.__mw.game;
    const hitOnce = (rng) => {
      g.restart(solo);
      g.stepNow(60);
      g.player.body.x = 0;
      g.player.body.z = 0;
      g.player.yaw = 0;
      const e = g.enemies[0].enemy;
      e.place(0, 1.9, Math.PI);
      e.health.hp = e.health.max = 9999;
      g.critRng = rng;
      const hp0 = e.health.hp;
      g.inject({ attackPressed: true });
      g.stepNow(1);
      for (let i = 0; i < 60 && e.hitSerial === 0; i++) g.stepNow(1);
      g.renderNow(3);
      return hp0 - e.health.hp;
    };
    const plain = hitOnce(() => 1);
    const plainEl = document.querySelector('.dmg-crit') !== null;
    const crit = hitOnce(() => 0);
    const el = document.querySelector('.dmg-crit');
    return { plain, crit, plainEl, text: el ? el.textContent : null, mods: { rate: g.player.mods.critRate, dmg: g.player.mods.critDamage } };
  }, SOLO);
  console.log(`[crit] ${JSON.stringify(critShot)}`);
  if (critShot.plainEl || critShot.crit !== Math.round(critShot.plain * critShot.mods.dmg) || critShot.text !== `${critShot.crit}!`) {
    console.error('[crit] 会心のダメージ（通常の会心ダメージ倍）・金色の数字（末尾に「!」）が出ていない');
    process.exitCode = 3;
  }
  await page.screenshot({ path: 'artifacts/shot-crit.png' });
  await page.evaluate(() => {
    window.__mw.game.critRng = () => 1; // 以降の撮影シーンは、会心で数字が揺れないように会心なしで固定する
  });

  await page.evaluate(() => {
    const g = window.__mw.game;
    const e = g.enemies[0].enemy;
    g.stepNow(90);
    e.place(0, g.player.body.z + 1.9, Math.PI);
    e.health.hp = 5;
    // 攻撃を押し続けて溜めの構えに入り、離して重撃で倒す
    g.inject({ attackPressed: true, attackHeld: true });
    g.stepNow(1);
    for (let i = 0; i < 60 && g.player.state !== 'charge'; i++) {
      g.inject({ attackHeld: true });
      g.stepNow(1);
    }
    for (let i = 0; i < 90 && !e.dead; i++) g.stepNow(1);
    g.stepNow(14);
    g.renderNow(14);
  });
  await page.screenshot({ path: 'artifacts/shot-combat-defeat.png' });

  // 8〜9. 敵の攻撃: 予備動作（腕を上げ赤く光る）→ 被弾の直後（赤いフラッシュ・HP バー・数字）
  await page.evaluate((solo) => {
    const g = window.__mw.game;
    g.restart(solo);
    g.enemies[0].enemy.place(0, 2.4, Math.PI);
    g.stepNow(1);
    const e = g.enemies[0].enemy;
    for (let i = 0; i < 300 && !(e.state === 'windup' && e.stateFrame >= 24); i++) g.stepNow(1);
    g.renderNow(6);
  }, SOLO);
  await sleep(120);
  await page.screenshot({ path: 'artifacts/shot-telegraph.png' });

  await page.evaluate(() => {
    const g = window.__mw.game;
    const serial = g.player.hitSerial;
    for (let i = 0; i < 60 && g.player.hitSerial === serial; i++) g.stepNow(1);
    g.renderNow(4);
  });
  await sleep(120);
  await page.screenshot({ path: 'artifacts/shot-hurt.png' });

  // 9b. ガードとパリィ（盾）: 受け止め（削りだけ通る）→ パリィ（敵が体勢を崩す・PARRY・水色の閃光）→ 反撃（大きなダメージ）。素手のときは剣で受ける。
  //     大剣は盾よりシビアなパリィ（受付 6f）で、弾かれた敵は倒れる（down）。
  //     シーンごとに結果を数値でも確かめる（失敗したら終了コード 3）
  const guardScene = (loadout, mode) =>
    page.evaluate(
      ([solo, loadout, mode]) => {
        const g = window.__mw.game;
        g.restart(solo);
        g.setLoadout(loadout);
        g.stepNow(1);
        const e = g.enemies[0].enemy;
        e.place(0, 2.4, Math.PI);
        const hold = (n, extra = {}) => {
          for (let i = 0; i < n; i++) {
            g.inject({ guardHeld: true, ...extra });
            g.stepNow(1);
          }
        };
        // 予備動作の stateFrame が pressAt になったら押す（攻撃の判定は windup の 38f + startup の 3f のあと）。
        // パリィの受付は盾 10f・大剣 6f。敵の予備動作は 38f で終わって攻撃に入る（判定は 4f 後）ので、大剣は予備動作の最後（38）に押す（盾は 35 でも間に合う）
        const pressAt = mode === 'guard' ? 8 : loadout === 'greatsword' ? 38 : 35;
        for (let i = 0; i < 400 && !(e.state === 'windup' && e.stateFrame >= pressAt); i++) g.stepNow(1);
        const hp0 = g.player.health.hp;
        g.inject({ guardPressed: true, guardHeld: true });
        g.stepNow(1);
        let outcome = 'none';
        for (let i = 0; i < 60; i++) {
          const gh = g.player.guardHitSerial;
          const pr = g.player.parrySerial;
          hold(1);
          if (g.player.parrySerial !== pr) outcome = 'parry';
          else if (g.player.guardHitSerial !== gh) outcome = 'guard';
          if (outcome !== 'none') break;
        }
        const info = { outcome, hpLost: hp0 - g.player.health.hp, enemyState: e.state, playerState: g.player.state, parries: g.encounter.parries };
        g.renderNow(5);
        if (mode === 'riposte' && outcome === 'parry') {
          hold(6);
          // 大剣は敵が遠くへ弾き飛ばされている（踏み込みで追う）。見た目と倍率の確認のため、反撃が届く位置へ置く
          if (loadout === 'greatsword') e.body.z = g.player.body.z + 1.8;
          g.inject({ guardHeld: true, attackPressed: true });
          g.stepNow(1);
          const hp = e.health.hp;
          for (let i = 0; i < 40 && e.health.hp === hp; i++) g.stepNow(1);
          info.riposteDamage = hp - e.health.hp;
          g.renderNow(5);
        }
        return info;
      },
      [SOLO, loadout, mode],
    );
  const expectGuard = (name, info, want) => {
    console.log(`[guard] ${name}: ${JSON.stringify(info)}`);
    if (info.outcome !== want.outcome || (want.noDamage && info.hpLost !== 0) || (want.enemyState && info.enemyState !== want.enemyState)) {
      console.error(`[guard] ${name}: 期待と違います ${JSON.stringify(want)}`);
      process.exitCode = 3;
    }
  };
  expectGuard('shield-guard', await guardScene('sword-shield', 'guard'), { outcome: 'guard' });
  await sleep(120);
  await page.screenshot({ path: 'artifacts/shot-guard-shield.png' });
  expectGuard('shield-parry', await guardScene('sword-shield', 'parry'), { outcome: 'parry', noDamage: true, enemyState: 'stagger' });
  await sleep(120);
  await page.screenshot({ path: 'artifacts/shot-parry.png' });
  const rip = await guardScene('sword-shield', 'riposte');
  expectGuard('shield-riposte', rip, { outcome: 'parry', noDamage: true });
  if (!(rip.riposteDamage > 0)) {
    console.error('[guard] 反撃が当たっていません');
    process.exitCode = 3;
  }
  await sleep(120);
  await page.screenshot({ path: 'artifacts/shot-riposte.png' });
  expectGuard('sword-guard', await guardScene('sword', 'guard'), { outcome: 'guard' });
  await sleep(120);
  await page.screenshot({ path: 'artifacts/shot-guard-sword.png' });
  // 素手はパリィがない: 受付の時刻に押しても、ただのガードになる
  expectGuard('sword-no-parry', await guardScene('sword', 'parry'), { outcome: 'guard' });

  // 9c. 大剣: 構え（受け止め）→ パリィ（敵が弾き飛ばされて倒れる）→ 倒れて寝ている → 反撃（盾より大きな倍率）。通常の斬り（剣筋の帯が広い）
  expectGuard('greatsword-guard', await guardScene('greatsword', 'guard'), { outcome: 'guard' });
  await sleep(120);
  await page.screenshot({ path: 'artifacts/shot-guard-greatsword.png' });
  expectGuard('greatsword-parry', await guardScene('greatsword', 'parry'), { outcome: 'parry', noDamage: true, enemyState: 'down' });
  await sleep(120);
  await page.screenshot({ path: 'artifacts/shot-parry-greatsword.png' });
  // 倒れ切って寝ているところ（26f 後）
  await page.evaluate(() => {
    const g = window.__mw.game;
    for (let i = 0; i < 26; i++) {
      g.inject({ guardHeld: true });
      g.stepNow(1);
    }
    g.renderNow(5);
  });
  await sleep(120);
  await page.screenshot({ path: 'artifacts/shot-down-greatsword.png' });
  const gsRip = await guardScene('greatsword', 'riposte');
  expectGuard('greatsword-riposte', gsRip, { outcome: 'parry', noDamage: true });
  if (!(gsRip.riposteDamage >= 50)) {
    console.error(`[guard] 大剣の反撃が想定より小さい（または当たっていません）: ${gsRip.riposteDamage}`);
    process.exitCode = 3;
  }
  await sleep(120);
  await page.screenshot({ path: 'artifacts/shot-riposte-greatsword.png' });
  // 大剣の通常の斬り（1 段目）: 剣筋の帯が広い
  await page.evaluate((solo) => {
    const g = window.__mw.game;
    g.restart(solo);
    g.setLoadout('greatsword');
    g.stepNow(1);
    g.player.body.x = 0;
    g.player.body.z = 0;
    g.player.yaw = 0;
    g.enemies[0].enemy.place(0, 2.3, Math.PI);
    g.inject({ attackPressed: true });
    g.stepNow(1);
    g.stepNow(21);
    g.renderNow(5);
  }, SOLO);
  await sleep(120);
  await page.screenshot({ path: 'artifacts/shot-attack-greatsword.png' });

  // 大剣の地割り（ADR-023）: 最大まで溜めて放つ → 剣が床に当たる瞬間（衝撃の輪・砂ぼこり・ひび割れ・画面の揺れ）。敵は遠くに置く（溜めのあいだに攻撃されて中断されないように）
  const smash = await page.evaluate((solo) => {
    const g = window.__mw.game;
    g.restart(solo);
    g.setLoadout('greatsword');
    g.stepNow(1);
    g.player.body.x = 0;
    g.player.body.z = 0;
    g.player.yaw = 0;
    g.enemies[0].enemy.place(0, 9, Math.PI);
    g.inject({ attackPressed: true, attackHeld: true });
    g.stepNow(1);
    for (let i = 0; i < 160 && !(g.player.state === 'charge' && g.player.chargeLevel >= 2); i++) {
      g.inject({ attackHeld: true });
      g.stepNow(1);
    }
    const level = g.player.chargeLevel;
    g.stepNow(1); // 離す
    const id = g.player.attack ? g.player.attack.id : null;
    // 床に当たる時刻（0.3s = 18f）の少し後まで進めて、輪が広がっている絵を撮る
    g.stepNow(21);
    g.renderNow(6);
    return { level, id, impacts: g.player.impactSerial };
  }, SOLO);
  console.log(`[smash] ${JSON.stringify(smash)}`);
  if (smash.id !== 'gsSmash' || smash.impacts < 1) {
    console.error('[smash] 最大まで溜めても地割りが出ていない、または床に当たった合図が出ていません');
    process.exitCode = 3;
  }
  await sleep(120);
  await page.screenshot({ path: 'artifacts/shot-smash-greatsword.png' });

  // 10〜11. ロックオン: 敵 3 体を並べてロック（カメラが対象を向き、枠と上部の HP バーが出る）→ 右へ切替
  await page.evaluate((trio) => {
    const g = window.__mw.game;
    g.restart(trio);
    const place = [[-4.5, 7], [0.5, 8], [5, 7]];
    g.enemies.forEach((e, i) => {
      e.enemy.place(place[i][0], place[i][1], Math.PI);
      if (i === 1) e.enemy.takeHit({ attackerId: 0, targetId: e.enemy.id, damage: 30, knockback: 0, hitStop: 0, dirX: 0, dirZ: -1, x: 0, z: 0 });
    });
    g.cam.yaw = Math.PI;
    g.renderNow(20);
    g.inject({ lockPressed: true });
    g.stepNow(1);
    // カメラの向きは sim で対象へ寄るので、sim を進めてから少数回だけ描く（描画を大量に積むと SwiftShader が追いつかない）
    g.stepNow(90);
    g.renderNow(24);
  }, TRIO);
  await sleep(120);
  await page.screenshot({ path: 'artifacts/shot-lock.png' });

  await page.evaluate(() => {
    const g = window.__mw.game;
    g.inject({ lockSwitch: 1 });
    g.stepNow(1);
    g.stepNow(90);
    g.renderNow(24);
  });
  await sleep(120);
  await page.screenshot({ path: 'artifacts/shot-lock-switch.png' });

  // 暴れ猪（突進型。ADR-025）: 予備動作で向きが固定されて床の帯（突進の通り道）が濃くなった絵と、大剣のパリィで弾いて倒れた絵
  const boar = await page.evaluate((solo) => {
    const g = window.__mw.game;
    const def = { ...solo, waves: [[{ type: 'boar', offset: 0, radius: 7.5 }]], maxAttackers: 2 };
    g.restart(def);
    g.setLoadout('sword');
    g.stepNow(1);
    g.player.body.x = 0;
    g.player.body.z = 0;
    g.player.yaw = 0;
    const e = g.enemies[0].enemy;
    e.place(0, 7, Math.PI);
    g.cam.yaw = Math.PI;
    let n = 0;
    while (!(e.state === 'windup' && e.stateFrame >= 46) && n++ < 400) g.stepNow(1);
    g.renderNow(8);
    return { state: e.state, frame: e.stateFrame };
  }, SOLO);
  console.log(`[boar] windup ${JSON.stringify(boar)}`);
  if (boar.state !== 'windup') {
    console.error('[boar] 暴れ猪が予備動作に入っていません');
    process.exitCode = 3;
  }
  await sleep(120);
  await page.screenshot({ path: 'artifacts/shot-boar-lane.png' });
  const parried = await page.evaluate((solo) => {
    const g = window.__mw.game;
    g.restart({ ...solo, waves: [[{ type: 'boar', offset: 0, radius: 7.5 }]], maxAttackers: 2 });
    g.setLoadout('greatsword');
    g.stepNow(1);
    g.player.body.x = 0;
    g.player.body.z = 0;
    g.player.yaw = 0;
    const e = g.enemies[0].enemy;
    e.place(0, 7, Math.PI);
    g.cam.yaw = Math.PI;
    let n = 0;
    while (e.state !== 'attack' && n++ < 400) g.stepNow(1);
    while (e.body.z - g.player.body.z > 3.4 && n++ < 600) g.stepNow(1);
    g.inject({ guardPressed: true, guardHeld: true });
    g.stepNow(1);
    for (let i = 0; i < 30 && e.state !== 'down'; i++) {
      g.inject({ guardHeld: true });
      g.stepNow(1);
    }
    for (let i = 0; i < 26; i++) {
      g.inject({ guardHeld: true });
      g.stepNow(1);
    }
    g.renderNow(8);
    return { state: e.state, hp: g.player.health.hp };
  }, SOLO);
  console.log(`[boar] parry ${JSON.stringify(parried)}`);
  if (parried.state !== 'down' || parried.hp !== 100) {
    console.error('[boar] 大剣のパリィで突進を弾けていません（猪が倒れる・ダメージなし）');
    process.exitCode = 3;
  }
  await sleep(120);
  await page.screenshot({ path: 'artifacts/shot-boar-down.png' });

  // 提灯（遠距離型。ADR-026）: 予備動作（前に溜めた鬼火 + 床の帯）、飛んでいる鬼火、盾のパリィで水色になって撃った提灯へ戻る鬼火
  const LANTERN_SOLO = { ...SOLO, waves: [[{ type: 'lantern', offset: 0, radius: 7.5 }]], maxAttackers: 2 };
  const lanternWindup = await page.evaluate((def) => {
    const g = window.__mw.game;
    g.restart(def);
    g.setLoadout('sword');
    g.stepNow(1);
    g.player.body.x = 0;
    g.player.body.z = 0;
    g.player.yaw = 0;
    const e = g.enemies[0].enemy;
    e.place(0, 7, Math.PI);
    g.cam.yaw = Math.PI;
    let n = 0;
    while (!(e.state === 'windup' && e.stateFrame >= 38) && n++ < 400) g.stepNow(1);
    g.renderNow(8);
    return { state: e.state, frame: e.stateFrame };
  }, LANTERN_SOLO);
  console.log(`[lantern] windup ${JSON.stringify(lanternWindup)}`);
  if (lanternWindup.state !== 'windup') {
    console.error('[lantern] 提灯が予備動作に入っていません');
    process.exitCode = 3;
  }
  await sleep(120);
  await page.screenshot({ path: 'artifacts/shot-lantern-windup.png' });
  const lanternOrb = await page.evaluate(() => {
    const g = window.__mw.game;
    const e = g.enemies[0].enemy;
    let n = 0;
    const dist = () => {
      const p = g.projectiles.pool.find((q) => q.alive);
      return p ? Math.hypot(p.x - g.player.body.x, p.z - g.player.body.z) : Infinity;
    };
    while (e.fireSerial === 0 && n++ < 200) g.stepNow(1);
    while (dist() > 4.2 && n++ < 400) g.stepNow(1);
    g.renderNow(8);
    return { alive: g.projectiles.aliveCount, dist: dist() };
  });
  console.log(`[lantern] orb ${JSON.stringify(lanternOrb)}`);
  if (lanternOrb.alive !== 1) {
    console.error('[lantern] 鬼火が飛んでいません');
    process.exitCode = 3;
  }
  await sleep(120);
  await page.screenshot({ path: 'artifacts/shot-lantern-orb.png' });
  const lanternParry = await page.evaluate((def) => {
    const g = window.__mw.game;
    g.restart(def);
    g.setLoadout('sword-shield');
    g.stepNow(1);
    g.player.body.x = 0;
    g.player.body.z = 0;
    g.player.yaw = 0;
    const e = g.enemies[0].enemy;
    e.place(0, 7, Math.PI);
    g.cam.yaw = Math.PI;
    const parries0 = g.player.parrySerial;
    let n = 0;
    const orb = () => g.projectiles.pool.find((q) => q.alive);
    while (e.fireSerial === 0 && n++ < 300) g.stepNow(1);
    while (orb() && Math.hypot(orb().x - g.player.body.x, orb().z - g.player.body.z) > 1.9 && n++ < 500) g.stepNow(1);
    g.inject({ guardPressed: true, guardHeld: true });
    g.stepNow(1);
    for (let i = 0; i < 14 && g.player.parrySerial === parries0; i++) {
      g.inject({ guardHeld: true });
      g.stepNow(1);
    }
    // 弾き返した弾が離れていく少し先の絵（ヒットストップの分は実時間なので、sim をいくつか進める）
    for (let i = 0; i < 9; i++) {
      g.inject({ guardHeld: true });
      g.stepNow(1);
    }
    g.renderNow(6);
    const o = orb();
    return { parried: g.player.parrySerial - parries0, team: o ? o.team : null, hp: g.player.health.hp };
  }, LANTERN_SOLO);
  console.log(`[lantern] parry ${JSON.stringify(lanternParry)}`);
  if (lanternParry.parried < 1 || lanternParry.team !== 'player' || lanternParry.hp !== 100) {
    console.error('[lantern] 盾のパリィで鬼火を弾き返せていません（弾が player の陣営・ダメージなし）');
    process.exitCode = 3;
  }
  await sleep(120);
  await page.screenshot({ path: 'artifacts/shot-lantern-parry.png' });

  // 岩鬼（重装型。ADR-027）: ガード不能の地ならしの予備動作（床の円が内側から満ちる・頭上の「ガード不能」）、攻撃が出た瞬間（床の輪とひび）、体勢を崩して膝をついた絵（ロックして体勢バーを出す）
  const OGRE_SOLO = { ...SOLO, waves: [[{ type: 'ogre', offset: 0, radius: 7.5 }]], maxAttackers: 2 };
  const ogreWindup = await page.evaluate((def) => {
    const g = window.__mw.game;
    g.restart(def);
    g.setLoadout('sword');
    g.stepNow(1);
    g.player.body.x = 0;
    g.player.body.z = 0;
    g.player.yaw = 0;
    const e = g.enemies[0].enemy;
    e.place(0.8, 3.4, Math.PI);
    g.cam.yaw = Math.PI;
    let n = 0;
    while (!(e.state === 'windup' && e.stateFrame >= 48) && n++ < 500) g.stepNow(1);
    g.renderNow(8);
    return { state: e.state, frame: e.stateFrame };
  }, OGRE_SOLO);
  console.log(`[ogre] windup ${JSON.stringify(ogreWindup)}`);
  if (ogreWindup.state !== 'windup') {
    console.error('[ogre] 岩鬼が予備動作に入っていません');
    process.exitCode = 3;
  }
  await sleep(120);
  await page.screenshot({ path: 'artifacts/shot-ogre-circle.png' });
  const ogreSlam = await page.evaluate(() => {
    const g = window.__mw.game;
    const e = g.enemies[0].enemy;
    let n = 0;
    while (e.state !== 'attack' && n++ < 100) g.stepNow(1);
    g.stepNow(6);
    g.renderNow(5);
    return { state: e.state, frame: e.stateFrame, impacts: e.impactSerial, hp: g.player.health.hp };
  });
  console.log(`[ogre] slam ${JSON.stringify(ogreSlam)}`);
  if (ogreSlam.impacts !== 1 || ogreSlam.hp >= 100) {
    console.error('[ogre] 地ならしが出ていない、または立っていたのに当たっていません');
    process.exitCode = 3;
  }
  await sleep(120);
  await page.screenshot({ path: 'artifacts/shot-ogre-slam.png' });
  const ogreBreak = await page.evaluate((def) => {
    const g = window.__mw.game;
    g.restart(def);
    g.setLoadout('greatsword');
    g.stepNow(1);
    g.player.body.x = 0;
    g.player.body.z = 0;
    g.player.yaw = 0;
    const e = g.enemies[0].enemy;
    e.place(0.6, 3.2, Math.PI);
    g.cam.yaw = Math.PI;
    g.inject({ lockPressed: true });
    g.stepNow(1);
    // 体勢ゲージを削って（半分）から、あと一撃で崩す: 予備動作のうちに崩して攻撃を中断させる
    let n = 0;
    while (!(e.state === 'windup' && e.stateFrame >= 14) && n++ < 500) g.stepNow(1);
    e.takeHit({ attackerId: 0, targetId: e.id, damage: 50, knockback: 0, hitStop: 0, dirX: 0, dirZ: -1, x: 0, z: 0 });
    g.stepNow(2);
    g.renderNow(10);
    const mid = { ratio: e.poise.ratio, state: e.state };
    e.takeHit({ attackerId: 0, targetId: e.id, damage: 40, knockback: 0, hitStop: 0, dirX: 0, dirZ: -1, x: 0, z: 0 });
    g.stepNow(24);
    g.renderNow(10);
    return { mid, state: e.state, breaks: e.breakSerial, ratio: e.poise.ratio, hurt: g.player.health.hp };
  }, OGRE_SOLO);
  console.log(`[ogre] break ${JSON.stringify(ogreBreak)}`);
  if (ogreBreak.state !== 'stagger' || ogreBreak.breaks !== 1 || ogreBreak.hurt !== 100) {
    console.error('[ogre] 体勢を崩せていない（stagger・攻撃は中断・ダメージなし）');
    process.exitCode = 3;
  }
  await sleep(120);
  await page.screenshot({ path: 'artifacts/shot-ogre-break.png' });

  // 小蝙蝠の群れ（小型の群れ。ADR-028）: 6 体が周りを回って囲む絵と、数体が急降下で噛みつきに来る絵、大剣の薙ぎ払いで落とした絵
  const BAT_WAVE = { ...SOLO, waves: [Array.from({ length: 6 }, (_, i) => ({ type: 'bat', offset: (i - 2.5) * 0.5, radius: 8 }))], maxAttackers: 2 };
  const bats = await page.evaluate((def) => {
    const g = window.__mw.game;
    g.restart(def);
    g.setLoadout('greatsword');
    g.stepNow(1);
    g.player.body.x = 0;
    g.player.body.z = 0;
    g.player.yaw = 0;
    g.cam.yaw = Math.PI;
    let n = 0;
    const es = g.enemies.map((e) => e.enemy);
    // 囲まれて周回している絵（攻撃に入る直前まで）
    while (!es.some((e) => e.state === 'windup' && e.stateFrame >= 6) && n++ < 600) {
      g.player.health.hp = 100;
      g.stepNow(1);
    }
    g.renderNow(6);
    return { states: es.map((e) => e.state), minD: Math.min(...es.map((e) => Math.hypot(e.body.x, e.body.z))) };
  }, BAT_WAVE);
  console.log(`[bat] swarm ${JSON.stringify(bats)}`);
  if (!bats.states.includes('windup')) {
    console.error('[bat] 小蝙蝠が予備動作に入っていません');
    process.exitCode = 3;
  }
  await sleep(120);
  await page.screenshot({ path: 'artifacts/shot-bat-swarm.png' });
  const batDive = await page.evaluate(() => {
    const g = window.__mw.game;
    const es = g.enemies.map((e) => e.enemy);
    let n = 0;
    while (es.filter((e) => e.state === 'attack').length < 2 && n++ < 400) {
      g.player.health.hp = 100;
      g.stepNow(1);
    }
    g.stepNow(4);
    g.renderNow(6);
    return { attacking: es.filter((e) => e.state === 'attack').length, windup: es.filter((e) => e.state === 'windup').length };
  });
  console.log(`[bat] dive ${JSON.stringify(batDive)}`);
  await sleep(120);
  await page.screenshot({ path: 'artifacts/shot-bat-dive.png' });
  const batSweep = await page.evaluate((def) => {
    const g = window.__mw.game;
    // 新しい群れで（さっきの群れは急降下の途中で、並べ直しても飛んでいってしまう）
    g.restart(def);
    g.setLoadout('greatsword');
    g.stepNow(1);
    g.cam.yaw = Math.PI;
    const es = g.enemies.map((e) => e.enemy);
    // 蝙蝠を前方に並べて、大剣の一振り（横斬り）でまとめて落とす
    es.forEach((e, i) => e.place((i - 2.5) * 0.55, 1.3 + (i % 2) * 0.25, Math.PI));
    g.player.reset(); // 噛みつかれてひるんでいても、振れる状態から
    g.player.body.x = 0;
    g.player.body.z = 0;
    g.player.yaw = 0;
    g.inject({ attackPressed: true });
    g.stepNow(1);
    // 大剣は振りが遅い（判定が出るまで少しかかる）。誰かが落ちてから数フレーム後の絵にする
    let n = 0;
    while (!es.some((e) => e.dead) && n++ < 60) {
      g.player.health.hp = 100;
      g.stepNow(1);
    }
    g.stepNow(3);
    g.renderNow(5);
    return { dead: es.filter((e) => e.dead).length, frames: n };
  }, BAT_WAVE);
  console.log(`[bat] sweep ${JSON.stringify(batSweep)}`);
  if (batSweep.dead < 3) {
    console.error('[bat] 大剣の一振りで前方の蝙蝠を落とせていません（3 体以上）');
    process.exitCode = 3;
  }
  await sleep(120);
  await page.screenshot({ path: 'artifacts/shot-bat-sweep.png' });

  // ボス「夜行の大将」（ADR-029）: 登場（上部の HP バーと体勢バー・段階の目盛り）、鬼火の連弾（扇の 5 本の帯）、地ならし（円）、段階 1 の号令（小蝙蝠を呼ぶ）、段階 2 の鬼火の輪（8 本の帯）
  const BOSS_WAVE = { ...SOLO, waves: [[{ type: 'boss', offset: 0, radius: 9 }]], maxAttackers: 2 };
  /** ボスを段階 phaseHp（HP の割合）にして、技 id の予備動作が frame に達するまで進める（プレイヤーは死なない）。ページ側の関数 */
  const bossScene = (def, o) =>
    page.evaluate(
      ([def, o]) => {
        const g = window.__mw.game;
        g.restart(def);
        g.setLoadout(o.loadout ?? 'sword');
        g.stepNow(1);
        g.player.body.x = 0;
        g.player.body.z = 0;
        g.player.yaw = 0;
        const boss = g.enemies[0].enemy;
        boss.place(0, o.z, Math.PI);
        boss.health.hp = Math.round(boss.health.max * (o.hp ?? 1));
        g.cam.yaw = Math.PI;
        if (o.lock) {
          g.inject({ lockPressed: true });
          g.stepNow(1);
        }
        let n = 0;
        const done = () => (o.summoned ? boss.summonSerial > 0 : o.move ? boss.state === 'windup' && boss.attackDef.id === o.move && boss.stateFrame >= (o.frame ?? 30) : n >= (o.steps ?? 1));
        while (!done() && n++ < 6000) {
          g.player.health.hp = 100;
          g.stepNow(1);
        }
        if (o.after) g.stepNow(o.after);
        g.renderNow(8);
        return { found: n < 6000, move: boss.attackDef.id, state: boss.state, frame: boss.stateFrame, phase: boss.phase, bats: g.enemies.filter((e) => e.enemy.def.id === 'bat' && !e.enemy.dead).length, hp: boss.health.hp };
      },
      [def, o],
    );
  const bossIntro = await bossScene(BOSS_WAVE, { z: 9, steps: 90 });
  console.log(`[boss] intro ${JSON.stringify(bossIntro)}`);
  await sleep(120);
  await page.screenshot({ path: 'artifacts/shot-boss-intro.png' });
  const bossVolley = await bossScene(BOSS_WAVE, { z: 10, move: 'volley', frame: 42 });
  console.log(`[boss] volley ${JSON.stringify(bossVolley)}`);
  if (!bossVolley.found) {
    console.error('[boss] 鬼火の連弾の予備動作に入っていません');
    process.exitCode = 3;
  }
  await sleep(120);
  await page.screenshot({ path: 'artifacts/shot-boss-volley.png' });
  const bossPound = await bossScene(BOSS_WAVE, { z: 3.6, move: 'pound', frame: 50 });
  console.log(`[boss] pound ${JSON.stringify(bossPound)}`);
  if (!bossPound.found) {
    console.error('[boss] 地ならしの予備動作に入っていません');
    process.exitCode = 3;
  }
  await sleep(120);
  await page.screenshot({ path: 'artifacts/shot-boss-pound.png' });
  const bossSummon = await bossScene(BOSS_WAVE, { z: 11, hp: 0.6, summoned: true, after: 20, lock: true });
  console.log(`[boss] summon ${JSON.stringify(bossSummon)}`);
  if (bossSummon.bats < 1) {
    console.error('[boss] 段階 1 の号令で小蝙蝠が呼ばれていません');
    process.exitCode = 3;
  }
  await sleep(120);
  await page.screenshot({ path: 'artifacts/shot-boss-summon.png' });
  const bossRing = await bossScene(BOSS_WAVE, { z: 9, hp: 0.28, move: 'ring', frame: 46 });
  console.log(`[boss] ring ${JSON.stringify(bossRing)}`);
  if (!bossRing.found || bossRing.phase !== 2) {
    console.error('[boss] 段階 2 の鬼火の輪の予備動作に入っていません');
    process.exitCode = 3;
  }
  await sleep(120);
  await page.screenshot({ path: 'artifacts/shot-boss-ring.png' });

  // ミスティカルドッジ（ADR-030）: 暴れ猪の突進を、ロールを押す遅れを変えて試し、無敵で避けて発動した絵（画面の縁の色・残りゲージ・「MYSTICAL」・猪だけ遅い）
  const BOAR_SOLO = { ...SOLO, waves: [[{ type: 'boar', offset: 0, radius: 6 }]], maxAttackers: 2 };
  const mystic = await page.evaluate((def) => {
    const g = window.__mw.game;
    for (let d = 0; d < 40; d++) {
      g.restart(def);
      g.setLoadout('sword');
      g.stepNow(1);
      g.player.body.x = 0;
      g.player.body.z = 0;
      g.player.yaw = 0;
      g.cam.yaw = Math.PI;
      const boar = g.enemies[0].enemy;
      boar.place(0, 6, Math.PI);
      let n = 0;
      while (!(boar.state === 'attack' && boar.stateFrame >= d) && n++ < 600) g.stepNow(1);
      g.inject({ dodgePressed: true });
      g.stepNow(1);
      for (let i = 0; i < 40 && !g.mystical.active; i++) g.stepNow(1);
      if (g.mystical.active) {
        g.stepNow(20);
        g.renderNow(12);
        return { d, hp: g.player.health.hp, boar: boar.state, remaining: g.mystical.remaining };
      }
    }
    return null;
  }, BOAR_SOLO);
  console.log(`[mystical] ${JSON.stringify(mystic)}`);
  if (!mystic || mystic.hp !== 100) {
    console.error('[mystical] ロールで突進を避けてもミスティカルドッジが発動していません（または被弾しました）');
    process.exitCode = 3;
  }
  await sleep(150);
  await page.screenshot({ path: 'artifacts/shot-mystical.png' });

  // アイテム欄（ADR-030）: 薬瓶を持たせてボタンの絵 → 長押しして上へすべらせ一覧を開いた絵 → 離して選び替え → タップで使った直後（回復の数字と緑の光）
  await page.evaluate(() => {
    const g = window.__mw.game;
    g.mystical.reset();
    g.player.setMystical(false);
    g.inventory.add('potionS', 3);
    g.inventory.add('potionM', 1);
    g.player.health.hp = 55;
    g.hud.setPlayerHp(55, 100);
    g.renderNow(6);
  });
  await sleep(150);
  await page.screenshot({ path: 'artifacts/shot-item-button.png' });
  const itemBox = await page.locator('#btn-item').boundingBox();
  const icx = itemBox.x + itemBox.width / 2;
  const icy = itemBox.y + itemBox.height / 2;
  await page.mouse.move(icx, icy);
  await page.mouse.down();
  await sleep(400);
  await page.mouse.move(icx, icy - 40, { steps: 4 });
  const itemTo = slotPos(2, 1); // 薬瓶（中）= 2 個のうち 2 番目
  await page.mouse.move(icx + itemTo.x, icy + itemTo.y, { steps: 6 });
  await sleep(150);
  await page.screenshot({ path: 'artifacts/shot-item-menu.png' });
  await page.mouse.up();
  await sleep(100);
  const picked = await page.evaluate(() => window.__mw.game.inventory.selected);
  console.log(`[item] 一覧で選んだアイテム: ${picked}`);
  if (picked !== 'potionM') {
    console.error('[item] 長押し + スワイプで薬瓶（中）に選び替わっていません');
    process.exitCode = 3;
  }
  await page.mouse.move(icx, icy);
  await page.mouse.down();
  await sleep(60);
  await page.mouse.up();
  await sleep(100);
  const used = await page.evaluate(() => {
    const g = window.__mw.game;
    g.stepNow(2);
    g.renderNow(10);
    return { hp: g.player.health.hp, medium: g.inventory.count('potionM'), small: g.inventory.count('potionS') };
  });
  console.log(`[item] タップで使用 ${JSON.stringify(used)}`);
  if (used.hp <= 55 || used.medium !== 0) {
    console.error('[item] タップで薬瓶（中）が使われて体力が回復していません');
    process.exitCode = 3;
  }
  await sleep(150);
  await page.screenshot({ path: 'artifacts/shot-item-used.png' });

  // スキル欄（ADR-031）: ロックして剣技（四ツ葉）を出し、連なりの途中の絵（技名の文字・クールダウンの扇）→ 長押しして上へすべらせた一覧 → 大剣へ替えたスキルボタン
  const skill = await page.evaluate((solo) => {
    const g = window.__mw.game;
    g.restart({ ...solo, maxAttackers: 0 });
    g.setLoadout('sword');
    g.stepNow(1);
    g.player.body.x = 0;
    g.player.body.z = 0;
    g.player.yaw = 0;
    g.cam.yaw = Math.PI;
    g.enemies[0].enemy.place(0, 1.8, Math.PI);
    g.inject({ lockPressed: true });
    g.stepNow(1);
    g.inject({ skillPressed: true });
    g.stepNow(1);
    const serial = g.player.skillSerial;
    const seq = [];
    let last = null;
    for (let i = 0; i < 54; i++) {
      g.stepNow(1);
      const id = g.player.attack?.id ?? null;
      if (id !== last) {
        last = id;
        if (id) seq.push(id);
      }
    }
    g.renderNow(6);
    return { serial, seq, cd: g.skills.cooldownRatio('yotsuba') };
  }, SOLO);
  console.log(`[skill] ${JSON.stringify(skill)}`);
  if (skill.serial !== 1 || !skill.seq.includes('skQuad3') || skill.cd <= 0) {
    console.error('[skill] スキルボタンから剣技が始まっていない（連なりが自動で続いていない・クールダウンに入っていない）');
    process.exitCode = 3;
  }
  await sleep(150);
  await page.screenshot({ path: 'artifacts/shot-skill.png' });
  const skillBox = await page.locator('#btn-skill').boundingBox();
  const scx = skillBox.x + skillBox.width / 2;
  const scy = skillBox.y + skillBox.height / 2;
  await page.mouse.move(scx, scy);
  await page.mouse.down();
  await sleep(400);
  await page.mouse.move(scx, scy - 40, { steps: 4 });
  const skillTo = slotPos(3, 1); // 五月雨突き = 3 個のうち 2 番目
  await page.mouse.move(scx + skillTo.x, scy + skillTo.y, { steps: 6 });
  await sleep(150);
  await page.screenshot({ path: 'artifacts/shot-skill-menu.png' });
  await page.mouse.up();
  await sleep(100);
  const skillPicked = await page.evaluate(() => window.__mw.game.skills.selectedFor('sword').id);
  console.log(`[skill] 一覧で選んだスキル: ${skillPicked}`);
  if (skillPicked !== 'samidare') {
    console.error('[skill] 長押し + スワイプで五月雨に選び替わっていません');
    process.exitCode = 3;
  }
  const gsSkill = await page.evaluate(() => {
    const g = window.__mw.game;
    g.setLoadout('greatsword');
    g.renderNow(4);
    return g.skills.selectedFor('greatsword').id;
  });
  console.log(`[skill] 大剣のスキルボタン: ${gsSkill}`);
  if (gsSkill !== 'houzan') {
    console.error('[skill] 大剣に替えても、スキルボタンが大剣のスキルになっていません');
    process.exitCode = 3;
  }
  await sleep(150);
  await page.screenshot({ path: 'artifacts/shot-skill-greatsword.png' });

  // 大剣の剣技（崩山）: 叩きつけが地面を叩いた直後の絵（衝撃波の輪・砂ぼこり・ひび割れ・技名）と、スーパーアーマーの「ARMOR」の文字
  const slam = await page.evaluate((solo) => {
    const g = window.__mw.game;
    g.restart({ ...solo, maxAttackers: 0 });
    g.setLoadout('greatsword');
    g.stepNow(1);
    g.player.body.x = 0;
    g.player.body.z = 0;
    g.player.yaw = 0;
    g.cam.yaw = Math.PI;
    g.enemies[0].enemy.place(0, 4.2, Math.PI);
    g.enemies[0].enemy.health.hp = g.enemies[0].enemy.health.max = 9999;
    g.inject({ lockPressed: true });
    g.stepNow(1);
    g.inject({ skillPressed: true });
    g.stepNow(1);
    const seq = [];
    let last = null;
    let impact = -1;
    const impact0 = g.player.impactSerial;
    for (let i = 0; i < 90; i++) {
      g.stepNow(1);
      const id = g.player.attack?.id ?? null;
      if (id !== last) {
        last = id;
        if (id) seq.push(id);
      }
      if (impact < 0 && g.player.impactSerial > impact0) impact = i;
    }
    g.damageNumbers.spawnText(g.player.body.x, 2.1, g.player.body.z, 'ARMOR', 'armor', 0.9);
    g.renderNow(8);
    return { seq, impact, hp: g.enemies[0].enemy.health.hp };
  }, SOLO);
  console.log(`[skill] 崩山 ${JSON.stringify(slam)}`);
  if (slam.seq.join() !== 'skGsSweep1,skGsSweep2,skGsSlam' || slam.impact < 0) {
    console.error('[skill] 崩山の連なり（払い・払い・叩きつけ）が出ていない、または地面を叩いていない');
    process.exitCode = 3;
  }
  await sleep(150);
  await page.screenshot({ path: 'artifacts/shot-skill-slam.png' });

  // 剣技の進化（ADR-034）: 崩山を Lv7 にして撃つ。飛翔崩山（衝撃波が 2 重）→ 地裂（前へ走る衝撃）。地裂が地面をえぐった瞬間の絵（技名・輪・ひび割れ）
  const evo = await page.evaluate((solo) => {
    const g = window.__mw.game;
    g.growth.reset();
    g.growth.addXp(660); // Lv7 = スキルポイント 6
    for (let i = 0; i < 6; i++) g.growth.addSkill('houzan');
    g.applyGrowth(); // private だが実行時は呼べる
    g.restart({ ...solo, maxAttackers: 0 });
    g.setLoadout('greatsword');
    g.stepNow(1);
    g.player.body.x = 0;
    g.player.body.z = 0;
    g.player.yaw = 0;
    g.cam.yaw = Math.PI;
    g.enemies[0].enemy.place(0, 5.4, Math.PI);
    g.enemies[0].enemy.health.hp = g.enemies[0].enemy.health.max = 9999;
    g.inject({ lockPressed: true });
    g.stepNow(1);
    g.inject({ skillPressed: true });
    g.stepNow(1);
    const seq = [];
    let last = null;
    const impact0 = g.player.impactSerial;
    for (let i = 0; i < 400; i++) {
      g.stepNow(1);
      const id = g.player.attack?.id ?? null;
      if (id !== last) {
        last = id;
        if (id) seq.push(id);
      }
      // 3 回目の地面の演出（飛翔崩山の本体・余波の輪・地裂）で止めて撮る
      if (g.player.impactSerial - impact0 >= 3) break;
    }
    const impacts = g.player.impactSerial - impact0;
    g.renderNow(6);
    return { seq, impacts, level: g.skills.level('houzan') };
  }, SOLO);
  console.log(`[skill] 崩山 Lv7 ${JSON.stringify(evo)}`);
  if (evo.level !== 7 || evo.seq.join() !== 'skGsSweep1,skGsSweep2,skGsSlamLeap,skGsRip' || evo.impacts < 3) {
    console.error('[skill] 崩山 Lv7 の進化（飛翔崩山 → 地裂）が出ていない');
    process.exitCode = 3;
  }
  await sleep(150);
  await page.screenshot({ path: 'artifacts/shot-skill-slam-lv7.png' });
  await page.evaluate(() => {
    const g = window.__mw.game;
    g.growth.reset();
    g.applyGrowth(); // 後の撮影シーンにレベルを持ち越さない
  });

  // 操作ガイド（ADR-024）: ロックして 1 段目を出し、次段の受付が開いた絵（連携の履歴・続けられる技・受付の帯）と、右上の「技表」を開いた絵
  await page.evaluate((solo) => {
    const g = window.__mw.game;
    g.restart({ ...solo, maxAttackers: 0 });
    g.setLoadout('sword');
    g.stepNow(1);
    g.player.body.x = 0;
    g.player.body.z = 0;
    g.player.yaw = 0;
    g.enemies[0].enemy.place(0, 6, Math.PI);
    g.inject({ lockPressed: true });
    g.stepNow(1);
    g.stepNow(30);
    g.inject({ attackPressed: true });
    g.stepNow(1);
    g.stepNow(24);
    g.renderNow(5);
  }, SOLO);
  await sleep(120);
  await page.screenshot({ path: 'artifacts/shot-guide.png' });

  // 一時停止メニュー（ADR-033）: レベル 7（ステータスポイント 18・スキルポイント 6）にして開き、ステータスを振る・スキルを上げる・技表・設定を撮る。
  // 振り分けが戦闘の数値・セーブに届いていること、− が開いてから振った分までしか戻せないこと、閉じると再開することも確かめる
  await page.evaluate(() => {
    const g = window.__mw.game;
    g.growth.reset();
    g.growth.addXp(660);
    g.applyGrowth(); // private だが実行時は呼べる（レベルアップで印が付くのと同じ経路）
    g.stepNow(1);
  });
  const menuInfo0 = await page.evaluate(() => {
    const g = window.__mw.game;
    return { level: g.growth.level, sp: g.growth.statPoints, kp: g.growth.skillPoints, dot: document.querySelector('#btn-menu .menu-dot')?.classList.contains('on') };
  });
  console.log(`[menu] 開く前 ${JSON.stringify(menuInfo0)}`);
  await page.click('#btn-menu');
  await sleep(250);
  await page.screenshot({ path: 'artifacts/shot-menu-status.png' });
  const strPlus = page.locator('.st-row').nth(0).locator('.st-btn.plus');
  for (let i = 0; i < 3; i++) await strPlus.click();
  const vitPlus = page.locator('.st-row').nth(4).locator('.st-btn.plus');
  for (let i = 0; i < 5; i++) await vitPlus.click();
  await page.locator('.st-row').nth(4).locator('.st-btn').first().click(); // VIT − を 1 回（開いてから振った分）
  const dexMinusDisabled = await page.locator('.st-row').nth(1).locator('.st-btn').first().isDisabled(); // DEX は振っていないので − は押せない
  const menuInfo1 = await page.evaluate(() => {
    const g = window.__mw.game;
    return { str: g.growth.stat('str'), vit: g.growth.stat('vit'), dex: g.growth.stat('dex'), sp: g.growth.statPoints, maxHp: g.player.health.max, dmg: g.player.mods.damage };
  });
  console.log(`[menu] ステータスを振った ${JSON.stringify(menuInfo1)}`);
  if (!dexMinusDisabled || menuInfo1.str !== 8 || menuInfo1.vit !== 9 || menuInfo1.dex !== 5 || menuInfo1.sp !== 11 || menuInfo1.maxHp !== 100 + 8 || Math.abs(menuInfo1.dmg - 1.03) > 1e-9) {
    console.error('[menu] ステータスの振り分けが数値に届いていない（＋ / − / 最大体力 / ダメージ）');
    process.exitCode = 3;
  }
  await page.screenshot({ path: 'artifacts/shot-menu-status2.png' });
  await page.locator('.menu-tab').nth(1).click();
  await sleep(150);
  const kPlus = page.locator('.sk-card').nth(0).locator('.st-btn.plus');
  for (let i = 0; i < 3; i++) await kPlus.click();
  await page.locator('.sk-card').nth(3).locator('.st-btn.plus').click();
  await sleep(100);
  await page.screenshot({ path: 'artifacts/shot-menu-skills.png' });
  const menuInfo2 = await page.evaluate(() => {
    const g = window.__mw.game;
    return { yotsuba: g.growth.skillLevel('yotsuba'), houzan: g.growth.skillLevel('houzan'), kp: g.growth.skillPoints, book: g.skills.level('yotsuba') };
  });
  console.log(`[menu] スキルを上げた ${JSON.stringify(menuInfo2)}`);
  if (menuInfo2.yotsuba !== 4 || menuInfo2.houzan !== 2 || menuInfo2.kp !== 2 || menuInfo2.book !== 4) {
    console.error('[menu] スキルのレベル上げが SkillBook に届いていない');
    process.exitCode = 3;
  }
  await page.locator('.menu-tab').nth(2).click();
  await sleep(150);
  await page.screenshot({ path: 'artifacts/shot-moves.png' });
  await page.locator('.menu-tab').nth(3).click();
  await sleep(150);
  await page.screenshot({ path: 'artifacts/shot-menu-settings.png' });
  await page.click('.menu-close');
  await sleep(150);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mw.save') ?? 'null'));
  console.log(`[menu] セーブ ${JSON.stringify(saved && { level: saved.level, stats: saved.stats, skills: saved.skills.yotsuba })}`);
  if (!saved || saved.level !== 7 || saved.stats.str !== 8 || saved.skills.yotsuba !== 4) {
    console.error('[menu] 閉じたときにセーブされていない');
    process.exitCode = 3;
  }
  await page.evaluate(() => {
    const g = window.__mw.game;
    g.growth.reset();
    g.applyGrowth(); // private だが実行時は呼べる（後の撮影シーンに振り分けを持ち越さない）
  });

  // 12〜13. リザルト: 勝ち（敵を倒しきる）と負け（プレイヤーを倒す）。CSS アニメはループを止めると進まないので、止めて撮る
  await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; }' });
  await page.evaluate((solo) => {
    const g = window.__mw.game;
    g.restart(solo);
    g.stepNow(2);
    const e = g.enemies[0].enemy;
    e.takeHit({ attackerId: 0, targetId: e.id, damage: 999, knockback: 0, hitStop: 0, dirX: 0, dirZ: 1, x: 0, z: 0 });
    g.player.takeHit({ attackerId: e.id, targetId: 0, damage: 24, knockback: 0, hitStop: 0, dirX: 0, dirZ: -1, x: 0, z: 0 });
    g.player.health.hp = 76;
    g.encounter.onKill();
    g.encounter.onPlayerHit(24);
    for (let i = 0; i < 400 && !g.encounter.ended; i++) {
      g.player.health.hp = Math.max(g.player.health.hp, 1); // 勝ちの撮影: プレイヤーは倒れない
      g.stepNow(1);
    }
    g.renderNow(6);
  }, SOLO);
  await sleep(1400);
  await page.screenshot({ path: 'artifacts/shot-result-win.png' });

  await page.evaluate((solo) => {
    const g = window.__mw.game;
    g.restart(solo);
    g.stepNow(2);
    g.player.takeHit({ attackerId: 1, targetId: 0, damage: 999, knockback: 0.5, hitStop: 0, dirX: 0, dirZ: -1, x: 0, z: 0 });
    for (let i = 0; i < 400 && !g.encounter.ended; i++) g.stepNow(1);
    g.renderNow(6);
  }, SOLO);
  await sleep(1400);
  await page.screenshot({ path: 'artifacts/shot-result-lose.png' });

  const errors = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
  console.log(logs.join('\n'));
  if (errors.length) {
    console.error(`\n${errors.length} 件のエラーがあります`);
    process.exitCode = 2;
  } else {
    console.log('\nartifacts/shot-*.png を出力しました');
  }
} catch (e) {
  // finally の process.exit で例外が消えないよう、ここで表示して異常終了にする
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
  if (server) {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      server.kill();
    }
  }
  process.exit(process.exitCode ?? 0);
}
