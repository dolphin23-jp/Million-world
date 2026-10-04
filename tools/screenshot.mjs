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
  await page.click('#btn-moves');
  await sleep(250);
  await page.screenshot({ path: 'artifacts/shot-moves.png' });
  await page.click('.ml-close');
  await sleep(150);

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
