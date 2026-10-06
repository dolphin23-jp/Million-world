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

  // ---- 杖のシーン（ADR-048。関数にしてあるのは、SHOT_ONLY=staff で杖のシーンだけを撮れるようにするため。通常は下の呼び出しで全部の撮影の途中で走る）
  async function staffScenes() {
  // 杖（魔法。ADR-048）: 杖を構えると、ガード・スキル欄・操作ガイドが隠れ、6 つの魔法ボタンが並列に出る。通常攻撃は魔弾（12 ダメージ）、魔法は
  // 落雷（予告の輪 → 着弾）・吹雪（扇に刻み）・火炎放射（帯に刻み）・爆発・再生（体力が増える）・旋風（同心円）。クールダウンは魔法を放った瞬間から。
  // 詠唱が潰されたら（放つ前の被弾）クールダウンに入らない。数値と UI を確かめ、各魔法の見せ場を撮る
  const STAFF_TRIO = { waves: [[{ type: 'imp', offset: -0.3, radius: 5.5 }, { type: 'imp', offset: 0, radius: 6 }, { type: 'imp', offset: 0.3, radius: 5.5 }]], waveGapFrames: 100, victoryDelayFrames: 75, defeatDelayFrames: 150, maxAttackers: 2 };
  const staffSetup = (spec) =>
    page.evaluate((spec) => {
      const g = window.__mw.game;
      g.loop.stop();
      g.restart(spec.trio);
      // 装備は restart のあと（戦闘中の状態では替えられない。restart でプレイヤーが立った状態に戻る）
      g.setLoadout('staff');
      g.critRng = () => 1;
      g.stepNow(30);
      g.player.body.x = 0;
      g.player.body.z = 0;
      g.player.yaw = 0;
      const es = g.enemies.map((e) => e.enemy);
      es[0].place(-1.6, 4.5, Math.PI);
      es[1].place(0, 4.8, Math.PI);
      es[2].place(1.7, 4.4, Math.PI);
      for (const e of es) e.health.hp = e.health.max = 9999;
      g.player.health.hp = Math.round(g.player.health.max * 0.5);
      g.renderNow(45);
    }, spec);
  /** 魔法を押して n ステップ進める（プレイヤーの位置を固定し、敵に攻撃させない = 検証を決定的にする）。敵の HP の合計の減りと、ボタン・クールダウンの状態を返す */
  const staffRun = (kind, n) =>
    page.evaluate(({ kind, n }) => {
      const g = window.__mw.game;
      const es = g.enemies.map((e) => e.enemy);
      const hp0 = es.map((e) => e.health.hp);
      const php0 = g.player.health.hp;
      g.inject(kind.attack ? { attackPressed: true } : { spellPressed: kind.index });
      for (let i = 0; i < n; i++) {
        g.player.body.x = 0;
        g.player.body.z = 0;
        for (const e of es) e.cooldown = 999;
        g.stepNow(1);
      }
      g.renderNow(2);
      return {
        dealt: es.map((e, i) => hp0[i] - e.health.hp),
        cast: g.player.castSerial,
        cd: kind.id ? g.skills.cooldownRatio(kind.id) : 0,
        heal: g.player.health.hp - php0,
        state: g.player.state,
        atk: g.player.attack ? g.player.attack.id : null,
      };
    }, { kind, n });
  {
    await staffSetup({ trio: STAFF_TRIO });
    const ui = await page.evaluate(() => {
      const vis = (sel) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el).display !== 'none' : false;
      };
      return {
        weapon: document.getElementById('touch-layer')?.dataset.weapon,
        spells: [...document.querySelectorAll('#spell-grid .spell-btn')].map((b) => b.querySelector('.spell-label')?.textContent),
        grid: vis('#spell-grid'),
        guard: vis('#btn-guard'),
        skill: vis('#btn-skill'),
        guide: vis('#move-guide'),
        item: vis('#btn-item'),
      };
    });
    console.log(`[staff] UI ${JSON.stringify(ui)}`);
    if (ui.weapon !== 'staff' || ui.spells.join() !== '落雷,吹雪,火炎,爆発,再生,旋風' || !ui.grid || ui.guard || ui.skill || ui.guide || !ui.item) {
      console.error('[staff] 杖を構えると、魔法ボタン 6 つ（落雷・吹雪・火炎・爆発・再生・旋風）が出て、ガード・スキル欄・操作ガイドが隠れ、アイテム欄は残るはず');
      process.exitCode = 3;
    }
    await page.screenshot({ path: 'artifacts/shot-staff-idle.png' });

    // 魔弾（通常攻撃）: 撃った弾が正面の敵に当たる（12）。弾が飛んでいる絵
    await staffSetup({ trio: STAFF_TRIO });
    const boltFly = await staffRun({ attack: true }, 24);
    await page.screenshot({ path: 'artifacts/shot-staff-bolt.png' });
    const boltHit = await staffRun({ attack: false, index: -1 }, 6);
    console.log(`[staff] 魔弾 飛行 ${JSON.stringify(boltFly)} 命中後 ${JSON.stringify(boltHit)}`);
    const boltTotal = await page.evaluate(() => window.__mw.game.enemies.map((e) => e.enemy.health.max - e.enemy.health.hp));
    if (boltTotal.reduce((a, b) => a + b, 0) !== 12) {
      console.error(`[staff] 魔弾 1 発の当たりは 12 ダメージ（正面の敵 1 体だけ）のはず: ${JSON.stringify(boltTotal)}`);
      process.exitCode = 3;
    }

    // 魔法 6 種: [名前, ボタンの番号, スキル id, 見せ場までのステップ, 検証]
    const spellScenes = [
      ['thunder', 0, 'thunder', 57 + 28, (r) => r.cd > 0.9 && r.dealt.every((d) => d > 0) && r.dealt.reduce((a, b) => a + b, 0) >= 150],
      ['blizzard', 1, 'blizzard', 36 + 30, (r) => r.cd > 0.9 && r.dealt.every((d) => d >= 16 * 3)],
      ['flame', 2, 'flame', 36 + 50, (r) => r.cd > 0.9 && r.dealt[1] >= 7 * 6 && r.state === 'attack'],
      ['explosion', 3, 'explosion', 63 + 34, (r) => r.cd > 0.9 && r.dealt.every((d) => d >= 60)],
      ['regen', 4, 'regen', 36 + 90, (r) => r.cd > 0.9 && r.heal >= 4],
      ['hurricane', 5, 'hurricane', 51 + 42, (r) => r.cd > 0.9 && r.dealt.every((d) => d > 0)],
    ];
    for (const [name, index, id, steps, ok] of spellScenes) {
      await staffSetup({ trio: STAFF_TRIO });
      const r = await staffRun({ attack: false, index, id }, steps);
      console.log(`[staff] ${name} ${JSON.stringify(r)}`);
      if (!ok(r)) {
        console.error(`[staff] ${name}: 魔法を放った瞬間からクールダウンに入り、敵に当たる（再生は体力が増える）はず`);
        process.exitCode = 3;
      }
      await page.screenshot({ path: `artifacts/shot-staff-${name}.png` });
    }

    // 詠唱が潰されたら（放つ前の被弾）クールダウンに入らず、魔法は放たれない
    await staffSetup({ trio: STAFF_TRIO });
    const broken = await page.evaluate(() => {
      const g = window.__mw.game;
      const cast0 = g.player.castSerial;
      g.inject({ spellPressed: 0 });
      g.stepNow(10);
      g.player.takeHit({ attackerId: 1, targetId: 0, damage: 3, knockback: 0.5, hitStop: 0, dirX: 0, dirZ: -1, x: 0, z: 0 });
      g.stepNow(120);
      return { cast: g.player.castSerial - cast0, cd: g.skills.cooldownRatio('thunder'), strikes: g.spells.strikes.length };
    });
    console.log(`[staff] 詠唱の中断 ${JSON.stringify(broken)}`);
    if (broken.cast !== 0 || broken.cd !== 0 || broken.strikes !== 0) {
      console.error('[staff] 詠唱を放つ前に被弾したら、魔法は放たれず、クールダウンにも入らないはず');
      process.exitCode = 3;
    }

    // 杖の一時停止メニュー: スキルタブに「杖（魔法）」の 6 本、技表に魔法の一覧
    await page.click('#btn-menu');
    await sleep(200);
    await page.locator('.menu-tab').nth(1).click();
    await sleep(200);
    const menu = await page.evaluate(() => {
      const titles = [...document.querySelectorAll('.sk-fam b')].map((b) => b.textContent);
      const names = [...document.querySelectorAll('.sk-card .sk-name b')].map((b) => b.textContent);
      return { titles, names };
    });
    console.log(`[staff] メニュー ${JSON.stringify(menu)}`);
    if (!menu.titles.includes('杖（魔法）') || !['落雷', '吹雪', '火炎放射', '爆発', '再生', '旋風'].every((n) => menu.names.includes(n))) {
      console.error('[staff] スキルタブに「杖（魔法）」の魔法 6 本が並ぶはず');
      process.exitCode = 3;
    }
    await page.screenshot({ path: 'artifacts/shot-staff-menu.png' });
    // 開いたタブは次に開くときも残るので、ステータスのタブへ戻してから閉じる（このあとのメニューの撮影はステータスのタブから始まる）
    await page.locator('.menu-tab').nth(0).click();
    await page.click('.menu-close');
    await sleep(100);
    // 装備を戻す（以降の撮影は片手剣）
    await page.evaluate(() => {
      const g = window.__mw.game;
      g.setLoadout('sword');
      g.loop.stop();
    });
  }
  }

  // ---- 槍のシーン（ADR-049。関数にしてあるのは、SHOT_ONLY=spear で槍のシーンだけを撮れるようにするため。通常は最後に走る）
  async function spearScenes() {
  // 槍: 両手持ち・右手が前。通常攻撃は突き（11）→ 二段突き → 薙ぎ払い。穂先の利（間合いの先端 = 中心どうしの距離 2.65m 以上の命中は ×1.3）。
  // 槍技 3 種（乱れ突き 6 連・風車 2 周・穿ち）。ガード（槍を横にして受ける。パリィは受付 8f）。数値と UI を確かめ、見せ場を撮る
  const spearSetup = (z) =>
    page.evaluate((z) => {
      const g = window.__mw.game;
      g.loop.stop();
      g.restart({ waves: [[{ type: 'imp', offset: 0, radius: 6 }]], waveGapFrames: 100, victoryDelayFrames: 75, defeatDelayFrames: 150, maxAttackers: 2 });
      g.setLoadout('spear');
      g.critRng = () => 1;
      g.stepNow(30);
      g.player.body.x = 0;
      g.player.body.z = 0;
      g.player.yaw = 0;
      const e = g.enemies[0].enemy;
      e.place(0, z, Math.PI);
      e.health.hp = e.health.max = 9999;
      g.renderNow(45);
    }, z);
  /** 入力を 1 回押して n ステップ進める（プレイヤーの位置は動かさない。敵に攻撃させない）。敵の HP の減りと攻撃 id の遷移を返す */
  const spearRun = (input, n, opts = {}) =>
    page.evaluate(({ input, n, opts }) => {
      const g = window.__mw.game;
      const e = g.enemies[0].enemy;
      const hp0 = e.health.hp;
      const ids = [];
      g.inject(input);
      for (let i = 0; i < n; i++) {
        e.cooldown = 999;
        g.stepNow(1);
        const id = g.player.attack ? g.player.attack.id : null;
        if (id && ids[ids.length - 1] !== id) ids.push(id);
      }
      g.renderNow(2);
      return { dealt: hp0 - e.health.hp, ids, z: g.player.body.z, state: g.player.state };
    }, { input, n, opts });
  {
    await spearSetup(1.6);
    const ui = await page.evaluate(() => {
      const vis = (sel) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el).display !== 'none' : false;
      };
      return {
        weapon: document.getElementById('touch-layer')?.dataset.weapon,
        grid: vis('#spell-grid'),
        guard: vis('#btn-guard'),
        skill: vis('#btn-skill'),
        guide: vis('#move-guide'),
        skills: window.__mw.game.skills.available('spear').map((d) => d.short),
      };
    });
    console.log(`[spear] UI ${JSON.stringify(ui)}`);
    if (ui.weapon !== 'spear' || ui.grid || !ui.guard || !ui.skill || !ui.guide || ui.skills.join() !== '乱れ,風車,穿ち') {
      console.error('[spear] 槍を構えると、ガード・スキル欄・操作ガイドが出て（魔法ボタンは出ない）、槍技は 乱れ・風車・穿ち の 3 つのはず');
      process.exitCode = 3;
    }
    await page.screenshot({ path: 'artifacts/shot-spear-idle.png' });

    // 1 段目の突き: 近い的は 11、間合いの先端（2.9m）の的は ×1.3 = 14。ダメージ数字は穂先の利の色
    await spearSetup(1.6);
    const near = await spearRun({ attackPressed: true }, 30);
    await spearSetup(3.1);
    const far = await spearRun({ attackPressed: true }, 30);
    console.log(`[spear] 突き 近 ${JSON.stringify(near)} 先端 ${JSON.stringify(far)}`);
    if (near.dealt !== 11 || far.dealt !== 14) {
      console.error(`[spear] 突きは近い的に 11、間合いの先端の的に 14（穂先の利 ×1.3）のはず: ${near.dealt} / ${far.dealt}`);
      process.exitCode = 3;
    }
    await spearSetup(3.1);
    await spearRun({ attackPressed: true }, 14);
    await page.screenshot({ path: 'artifacts/shot-spear-thrust.png' });

    // 連携: 突き → 二段突き → 薙ぎ払い（押しっぱなしの連打）
    await spearSetup(2.4);
    const chain = await page.evaluate(() => {
      const g = window.__mw.game;
      const e = g.enemies[0].enemy;
      const ids = [];
      for (let i = 0; i < 150; i++) {
        e.cooldown = 999;
        g.inject({ attackPressed: i % 6 === 0 });
        g.stepNow(1);
        const id = g.player.attack ? g.player.attack.id : null;
        if (id && ids[ids.length - 1] !== id) ids.push(id);
      }
      return ids;
    });
    console.log(`[spear] 連携 ${JSON.stringify(chain)}`);
    if (chain.slice(0, 3).join() !== 'sp1,sp2,sp3') {
      console.error('[spear] 連打で 突き → 二段突き → 薙ぎ払い と続くはず');
      process.exitCode = 3;
    }

    // 溜め突き: 長押し → 離す（威力は段階で上がる）
    await spearSetup(5.0);
    const heavy = await page.evaluate(() => {
      const g = window.__mw.game;
      const e = g.enemies[0].enemy;
      const hp0 = e.health.hp;
      for (let i = 0; i < 120; i++) {
        e.cooldown = 999;
        g.inject(i === 0 ? { attackPressed: true, attackHeld: true } : { attackHeld: true });
        g.stepNow(1);
        if (g.player.chargeLevel >= 2) break;
      }
      const level = g.player.chargeLevel;
      g.renderNow(2);
      return { level, ids: null, hp0 };
    });
    await page.screenshot({ path: 'artifacts/shot-spear-charge.png' });
    const heavyHit = await spearRun({ attackHeld: false }, 40);
    console.log(`[spear] 溜め突き 段階 ${heavy.level} ${JSON.stringify(heavyHit)}`);
    if (heavy.level < 2 || !heavyHit.ids.includes('spHeavy')) {
      console.error('[spear] 長押しで最大の段階まで溜まり、離すと溜め突き（spHeavy）を放つはず');
      process.exitCode = 3;
    }
    await page.screenshot({ path: 'artifacts/shot-spear-heavy.png' });

    // 槍技: 乱れ突き（6 連）・風車（2 周）・穿ち（1 突き）
    const skillScenes = [
      ['midare', 'skSpFlurry', 2.0, 90, (r) => r.dealt >= 5 * 6],
      ['fusha', 'skSpWhirl', 1.4, 110, (r) => r.dealt >= 2 * 8],
      ['ugachi', 'skSpBore', 3.2, 80, (r) => r.dealt >= 20],
    ];
    for (const [id, atk, z, steps, ok] of skillScenes) {
      await spearSetup(z);
      await page.evaluate((id) => window.__mw.game.skills.select(id), id);
      const r = await spearRun({ skillPressed: true }, steps);
      console.log(`[spear] ${id} ${JSON.stringify(r)}`);
      if (!r.ids.includes(atk) || !ok(r)) {
        console.error(`[spear] ${id}: ${atk} が出て、敵に当たるはず`);
        process.exitCode = 3;
      }
      // 見せ場の絵（もう一度、途中まで）
      await spearSetup(z);
      await page.evaluate((id) => window.__mw.game.skills.select(id), id);
      await spearRun({ skillPressed: true }, id === 'fusha' ? 40 : id === 'midare' ? 36 : 26);
      await page.screenshot({ path: `artifacts/shot-spear-${id}.png` });
    }

    // ガード: 構える（受け止めると軽減 70%）。槍を横にして体の前をふさぐ絵
    await spearSetup(3.0);
    await page.evaluate(() => {
      const g = window.__mw.game;
      g.inject({ guardPressed: true, guardHeld: true });
      g.stepNow(1);
      for (let i = 0; i < 12; i++) {
        g.inject({ guardHeld: true });
        g.stepNow(1);
      }
      g.renderNow(2);
    });
    const gst = await page.evaluate(() => ({ state: window.__mw.game.player.state, guard: window.__mw.game.player.guard?.id }));
    console.log(`[spear] ガード ${JSON.stringify(gst)}`);
    if (gst.state !== 'guard' || gst.guard !== 'spear') {
      console.error('[spear] ガードボタンで槍の構えに入るはず');
      process.exitCode = 3;
    }
    await page.screenshot({ path: 'artifacts/shot-spear-guard.png' });

    // 一時停止メニュー: スキルタブに「槍」の 3 本
    await page.evaluate(() => window.__mw.game.loop.stop());
    await page.click('#btn-menu');
    await sleep(200);
    await page.locator('.menu-tab').nth(1).click();
    await sleep(200);
    const menu = await page.evaluate(() => ({
      titles: [...document.querySelectorAll('.sk-fam b')].map((b) => b.textContent),
      names: [...document.querySelectorAll('.sk-card .sk-name b')].map((b) => b.textContent),
    }));
    console.log(`[spear] メニュー ${JSON.stringify({ titles: menu.titles })}`);
    if (!menu.titles.includes('槍') || !['乱れ突き', '風車', '穿ち'].every((n) => menu.names.includes(n))) {
      console.error('[spear] スキルタブに「槍」の槍技 3 本が並ぶはず');
      process.exitCode = 3;
    }
    await page.screenshot({ path: 'artifacts/shot-spear-menu.png' });
    await page.locator('.menu-tab').nth(0).click();
    await page.click('.menu-close');
    await sleep(100);
    await page.evaluate(() => {
      const g = window.__mw.game;
      g.setLoadout('sword');
      g.loop.stop();
    });
  }
  }

  if (process.env.SHOT_ONLY === 'staff' || process.env.SHOT_ONLY === 'spear') {
    if (process.env.SHOT_ONLY === 'staff') await staffScenes();
    else await spearScenes();
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
  const skillTo = slotPos(5, 1); // 五月雨突き = 内側の輪の 5 個のうち 2 番目（片手剣のスキルは 6 個: 5 個が内側、6 個目 = 疾風連斬 が外側の輪。ADR-038）
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

  // 剣技の第 2 弾（ADR-038）: 6 本を Lv7 にして撃ち、それぞれの見せ場の絵を撮る（居合の袈裟・十字斬りの 3 つ目の突き立て・疾風連斬の駆け抜け・大渦の回転・剣山の輪・飛竜落としの着地）
  const EX = [
    { id: 'iai', loadout: 'sword', attack: 'skIai7', dist: 4.2, frames: 62, stopImpacts: 0 },
    { id: 'juji', loadout: 'sword', attack: 'skCross3', dist: 1.7, frames: 190, stopImpacts: 3 },
    { id: 'hayate', loadout: 'sword', attack: 'skGale8', dist: 2.4, frames: 70, stopImpacts: 0 },
    { id: 'ouzu', loadout: 'greatsword', attack: 'skOuzu4', dist: 1.5, frames: 80, stopImpacts: 0 },
    { id: 'kenzan', loadout: 'greatsword', attack: 'skKenzan5', dist: 1.5, frames: 200, stopImpacts: 3 },
    { id: 'hiryu', loadout: 'greatsword', attack: 'skHiryu7', dist: 2.8, frames: 200, stopImpacts: 2 },
  ];
  for (const ex of EX) {
    const r = await page.evaluate(
      ({ solo, e }) => {
        const g = window.__mw.game;
        g.growth.reset();
        g.growth.addXp(660); // Lv7 = スキルポイント 6
        for (let i = 0; i < 6; i++) g.growth.addSkill(e.id);
        g.applyGrowth(); // private だが実行時は呼べる
        g.restart({ ...solo, maxAttackers: 0 });
        g.setLoadout(e.loadout);
        g.skills.select(e.id);
        g.stepNow(1);
        g.player.body.x = 0;
        g.player.body.z = 0;
        g.player.yaw = 0;
        g.cam.yaw = Math.PI;
        const en = g.enemies[0].enemy;
        en.place(0, e.dist, Math.PI);
        en.health.hp = en.health.max = 99999;
        g.inject({ lockPressed: true });
        g.stepNow(1);
        g.inject({ skillPressed: true });
        g.stepNow(1);
        const seq = [];
        let last = null;
        const impact0 = g.player.impactSerial;
        for (let i = 0; i < e.frames; i++) {
          g.stepNow(1);
          const id = g.player.attack?.id ?? null;
          if (id !== last) {
            last = id;
            if (id) seq.push(id);
          }
          if (e.stopImpacts > 0 && g.player.impactSerial - impact0 >= e.stopImpacts) break;
        }
        g.renderNow(6);
        return { seq, level: g.skills.level(e.id), impacts: g.player.impactSerial - impact0, dmg: 99999 - en.health.hp };
      },
      { solo: SOLO, e: ex },
    );
    console.log(`[skill-ex] ${ex.id} ${JSON.stringify(r)}`);
    if (r.level !== 7 || r.seq.join() !== ex.attack || r.dmg <= 0 || r.impacts < ex.stopImpacts) {
      console.error(`[skill-ex] ${ex.id} Lv7 が出ていない（${ex.attack} の連なり・当たり・地面の演出）`);
      process.exitCode = 3;
    }
    await sleep(150);
    await page.screenshot({ path: `artifacts/shot-skill-ex-${ex.id}.png` });
  }
  await page.evaluate(() => {
    const g = window.__mw.game;
    g.growth.reset();
    g.applyGrowth(); // 後の撮影シーンにレベルを持ち越さない
  });

  // 世界の障害物（M7-1。ADR-039）: 俯瞰で闘技場の柱・岩・壁・箱を撮り、(1) 体が柱にぶつかって止まる (2) 柱の陰の弾は消える (3) 低い岩の上を弾が通る、を確かめる
  const worldInfo = await page.evaluate((solo) => {
    const g = window.__mw.game;
    g.restart({ ...solo, maxAttackers: 0 });
    g.setLoadout('sword');
    g.stepNow(1);
    const w = g.world;
    const col = w.obstacles.find((o) => o.kind === 'circle' && o.top === 3.2); // 折れた柱（斜めの 4 本のうち最初）
    const rock = w.obstacles.find((o) => o.kind === 'circle' && o.top < 1);
    // (1) 柱へ向かって走る: 柱の中心の真横から押し込んでも、中心から（柱の半径 + 体の半径）より近づかない
    g.player.body.x = col.x - 3;
    g.player.body.z = col.z + 0.3;
    g.player.yaw = Math.PI / 2;
    g.cam.yaw = Math.PI;
    g.enemies[0].enemy.place(0, -9, 0);
    // 画面の右がワールドの +X か −X かは向きの約束次第なので、まず 10 フレーム動かして柱へ近づく向きの符号を決める
    let dirSign = 1;
    {
      const x0 = g.player.body.x;
      for (let i = 0; i < 10; i++) {
        g.inject({ moveX: 1, moveY: 0 });
        g.stepNow(1);
      }
      if (g.player.body.x < x0) dirSign = -1;
      g.player.body.x = col.x - 3;
      g.player.body.z = col.z + 0.3;
    }
    const trail = [];
    for (let i = 0; i < 90; i++) {
      g.inject({ moveX: dirSign, moveY: 0 });
      g.stepNow(1);
      if (i % 15 === 14) trail.push(Number(Math.hypot(g.player.body.x - col.x, g.player.body.z - col.z).toFixed(2)));
    }
    const d1 = Math.hypot(g.player.body.x - col.x, g.player.body.z - col.z);
    const need = col.r + g.player.body.r;
    // (2) 柱の向こう側へ鬼火を撃つ（弾の高さ 1.1 < 柱の上面 3.2）: 柱の手前で消える。(3) 低い岩（上面 0.85）の上は通る
    const ends = [];
    const hit = { t: 0, x: 0, z: 0, nx: 0, nz: 0, index: -1 };
    const blocked = w.raycast(col.x - 3, col.z, col.x + 3, col.z, 1.1, hit);
    const overRock = w.raycast(rock.x - 3, rock.z, rock.x + 3, rock.z, 1.1, hit);
    const cb = (_p, r) => ends.push(r);
    // 弾のデータ（鬼火と同じ形。数値は撃ち方だけに効く）
    const wisp = { id: 'wisp', speed: 8, damage: 1, knockback: 0, hitStop: 0, lifetimeFrames: 600, radius: 0.3, reflect: { damage: 1, speedScale: 1, knockback: 0, hitStop: 0, lifetimeFrames: 60 } };
    const p1 = g.projectiles.spawn(wisp, 1, col.x - 3, col.z, 1, 0);
    const p2 = g.projectiles.spawn(wisp, 1, rock.x - 3, rock.z, 1, 0);
    for (let i = 0; i < 90; i++) g.projectiles.step(1 / 60, g.world, cb);
    return { d1, trail, need, blocked, overRock, ends, p1x: p1.x, p1alive: p1.alive, p2alive: p2.alive, p2x: p2.x, colX: col.x, rockX: rock.x, props: w.obstacles.length };
  }, SOLO);
  console.log(`[world] ${JSON.stringify(worldInfo)}`);
  const nearest = Math.min(...worldInfo.trail); // 柱へ走り込み、ぴったり接して（= 半径の和）、柱の脇へ滑って抜ける
  if (nearest < worldInfo.need - 1e-6 || nearest > worldInfo.need + 0.05 || !worldInfo.blocked || worldInfo.overRock || worldInfo.p1alive || worldInfo.p1x > worldInfo.colX - 0.7 || worldInfo.ends[0] !== 'wall') {
    console.error('[world] 柱にめり込んでいる（または柱まで届いていない）・柱が弾を遮っていない・低い岩が弾を遮っている');
    process.exitCode = 3;
  }
  await page.evaluate(() => {
    const g = window.__mw.game;
    g.player.body.x = 0;
    g.player.body.z = -2;
    g.player.yaw = 0;
    g.cam.yaw = Math.PI;
    g.cam.pitch = 0.95;
    g.cam.distance = 21;
    g.stepNow(1);
    g.renderNow(10);
  });
  await sleep(200);
  await page.screenshot({ path: 'artifacts/shot-world-overview.png' });
  await page.evaluate(() => {
    const g = window.__mw.game;
    g.cam.pitch = 0.2;
    g.cam.distance = 4.9;
  });

  // ジャンプ（M7-2。ADR-040）: 低い岩（上面 0.85）へ走って跳び乗る。空中・岩の上の絵と、数値（頂点・乗れたか・箱には乗れないか）
  const jumpA = await page.evaluate((solo) => {
    const g = window.__mw.game;
    g.restart({ ...solo, maxAttackers: 0 });
    g.setLoadout('sword');
    g.stepNow(1);
    for (const e of g.enemies) e.enemy.place(0, -12, 0); // 敵は遠く（岩へ跳ぶ邪魔をしない）
    const rock = g.world.obstacles.find((o) => o.kind === 'circle' && o.top < 1);
    const p = g.player;
    g.cam.yaw = Math.PI; // スティックの上 = +Z
    g.cam.pitch = 0.2;
    g.cam.distance = 6.5;
    // 岩の手前 2.6m から +Z へ走り、助走ののちに跳ぶ。頂点（上昇が止まる）まで進めて、その絵を撮る
    p.body.x = rock.x;
    p.body.z = rock.z - 2.6;
    p.yaw = 0;
    p.velX = p.velZ = 0;
    g.stepNow(1);
    for (let i = 0; i < 12; i++) { g.inject({ moveY: 1 }); g.stepNow(1); }
    g.inject({ moveY: 1, jumpPressed: true });
    g.stepNow(1);
    let peak = 0;
    for (let i = 0; i < 60; i++) {
      g.inject({ moveY: 1 });
      g.stepNow(1);
      peak = Math.max(peak, p.y);
      if (p.velY < 0 && !p.grounded) break;
    }
    // 絵は横から（走ってきた向きが画面の左右になる）。走り終えたあとなので、カメラの向きを変えても sim には響かない
    g.cam.yaw = Math.PI * 0.5;
    g.renderNow(8);
    return { peak, y: p.y, state: p.state, rockX: rock.x, rockZ: rock.z, rockTop: rock.top };
  }, SOLO);
  await sleep(150);
  await page.screenshot({ path: 'artifacts/shot-jump-air.png' });
  const jumpB = await page.evaluate((a) => {
    const g = window.__mw.game;
    const p = g.player;
    let peak = a.peak;
    for (let i = 0; i < 60 && !(p.grounded && p.y > 0.5); i++) { g.inject({ moveY: 1 }); g.stepNow(1); peak = Math.max(peak, p.y); }
    g.stepNow(2);
    g.renderNow(10);
    return { peak, y: p.y, grounded: p.grounded, dist: Math.hypot(p.body.x - a.rockX, p.body.z - a.rockZ), state: p.state };
  }, jumpA);
  await sleep(150);
  await page.screenshot({ path: 'artifacts/shot-jump-rock.png' });
  // 石の箱（上面 1.5）は、立ったままの跳躍では乗れない
  const jumpC = await page.evaluate(() => {
    const g = window.__mw.game;
    const p = g.player;
    const b = g.world.obstacles.find((o) => o.kind === 'box' && o.top > 1.4);
    p.body.x = b.x;
    p.body.z = b.z - 3.2;
    p.y = 0;
    p.velX = p.velZ = 0;
    p.yaw = 0;
    g.stepNow(30);
    for (let i = 0; i < 10; i++) { g.inject({ moveY: 1 }); g.stepNow(1); }
    g.inject({ moveY: 1, jumpPressed: true });
    g.stepNow(1);
    let blockPeak = 0;
    for (let i = 0; i < 70; i++) { g.inject({ moveY: 1 }); g.stepNow(1); blockPeak = Math.max(blockPeak, p.y); }
    return { blockTop: b.top, blockPeak, blockFinalY: p.y };
  });
  console.log(`[jump] ${JSON.stringify({ peak: jumpB.peak, air: { y: jumpA.y, state: jumpA.state }, onRock: { y: jumpB.y, grounded: jumpB.grounded, dist: jumpB.dist, rockTop: jumpA.rockTop }, ...jumpC })}`);
  if (jumpB.peak < 1.2 || jumpB.peak > 1.4 || !jumpB.grounded || Math.abs(jumpB.y - jumpA.rockTop) > 1e-6 || jumpC.blockFinalY !== 0) {
    console.error('[jump] 頂点が想定（約 1.33m）と違う・低い岩に乗れない・石の箱に乗れてしまう');
    process.exitCode = 3;
  }

  // 乗り上がり・乗り越え（M7-3。ADR-041）: 低い岩（上面 0.85）へ走り込んで乗り上がる / 低くて薄い壁（上面 0.9・厚み 0.6）へ走り込んで乗り越える。
  // 始まり（種別）・終わり（岩の上に立つ / 壁の向こうへ着地して走り続ける）と、最中の絵
  const travInit = (kind) => page.evaluate(([solo, kind]) => {
    const g = window.__mw.game;
    g.restart({ ...solo, maxAttackers: 0 });
    g.setLoadout('sword');
    g.stepNow(1);
    for (const e of g.enemies) e.enemy.place(0, -12, 0);
    const o = g.world.obstacles.find((b) =>
      kind === 'mantle' ? b.kind === 'circle' && b.top < 1
      : kind === 'vault' ? b.kind === 'box' && b.top < 1 && b.hz < 0.5
      : kind === 'climb' ? b.climbable && b.top < 2 // 石の箱（1.5）
      : b.climbable && b.top > 2); // 石の壇（2.2）
    // 障害物の中心 → 闘技場の中心の向き（面の正面）から、3m 手前で向かい合う
    const len = Math.hypot(o.x, o.z);
    const dir = { x: -o.x / len, z: -o.z / len }; // 中心 → 障害物と逆。走る向きは障害物へ（外向き）: 下で反転
    const run = { x: -dir.x, z: -dir.z };
    const p = g.player;
    p.body.x = o.x - run.x * 3.3;
    p.body.z = o.z - run.z * 3.3;
    p.yaw = Math.atan2(run.x, run.z);
    p.velX = p.velZ = 0;
    g.stepNow(2);
    g.__trav = { run, top: o.top, ox: o.x, oz: o.z };
    return { run, top: o.top };
  }, [SOLO, kind]);
  const travRun = (frames, stopWhen, midAfter = 14) => page.evaluate(([frames, stopWhen, midAfter]) => {
    const g = window.__mw.game;
    const p = g.player;
    const { run } = g.__trav;
    const yaw = g.cam.yaw;
    // スティック: 世界の向き run を、カメラの向きに合わせて倒す（前 = (−sin yaw, −cos yaw)、右 = (cos yaw, −sin yaw)）
    const stick = { moveX: run.x * Math.cos(yaw) - run.z * Math.sin(yaw), moveY: -run.x * Math.sin(yaw) - run.z * Math.cos(yaw) };
    let started = null;
    for (let i = 0; i < frames; i++) {
      g.inject(stick);
      g.stepNow(1);
      if (!started && p.state === 'traverse') started = { frame: i, kind: p.traverseClip.spec.kind, name: p.traverseClip.name };
      if (stopWhen === 'traverse-mid' && started && i - started.frame >= midAfter) break;
      if (stopWhen === 'done' && started && p.state !== 'traverse') break;
    }
    return { started, state: p.state, y: p.y, grounded: p.grounded, x: p.body.x, z: p.body.z, speed: Math.hypot(p.velX, p.velZ), landSerial: p.landSerial };
  }, [frames, stopWhen, midAfter]);
  const travCam = (flip = false) => page.evaluate((flip) => {
    const g = window.__mw.game;
    const { run } = g.__trav;
    // 走る向きを画面の横にする（flip = 反対側から。壁は闘技場の縁にあり、外側のカメラは柱にめり込むので、内側から撮る）
    g.cam.yaw = Math.atan2(-run.z, run.x) + (flip ? Math.PI : 0);
    g.cam.pitch = 0.22;
    g.cam.distance = 5.5;
    g.renderNow(8);
  }, flip);
  await travInit('mantle');
  const mantleMid = await travRun(120, 'traverse-mid');
  await travCam();
  await sleep(150);
  await page.screenshot({ path: 'artifacts/shot-traverse-mantle.png' });
  const mantleEnd = await travRun(120, 'done');
  console.log(`[traverse] mantle ${JSON.stringify({ started: mantleMid.started, endState: mantleEnd.state, y: mantleEnd.y, grounded: mantleEnd.grounded, land: mantleEnd.landSerial })}`);
  await travInit('vault');
  const vaultMid = await travRun(120, 'traverse-mid');
  await travCam(true);
  await sleep(150);
  await page.screenshot({ path: 'artifacts/shot-traverse-vault.png' });
  const vaultEnd = await travRun(120, 'done');
  const vaultAfter = await page.evaluate(() => {
    const g = window.__mw.game;
    const p = g.player;
    const o = g.__trav;
    // 壁の向こう側（障害物の中心から面の正面と逆の向きへ）にいるか
    const beyond = (p.body.x - o.ox) * o.run.x + (p.body.z - o.oz) * o.run.z;
    return { beyond, y: p.y, state: p.state };
  });
  console.log(`[traverse] vault ${JSON.stringify({ started: vaultMid.started, endState: vaultEnd.state, y: vaultEnd.y, speed: vaultEnd.speed, ...vaultAfter })}`);
  // 掴んで登る（M7-3b。ADR-042）: 登れる縁の石の箱（上面 1.5）と壇（上面 2.2）。縁にぶら下がった瞬間（始まりから 26 フレーム）の絵と、登り切って上に立つ終わり
  const climbShot = async (kind, file) => {
    await travInit(kind);
    const mid = await travRun(160, 'traverse-mid', 26);
    await page.evaluate(() => {
      const g = window.__mw.game;
      const { run } = g.__trav;
      const p = g.player;
      // 走る向きを画面の横にして、カメラの視線（プレイヤーからカメラまで）が障害物に遮られない向きを探す
      // （カメラはまだ障害物を避けない = M7-4。撮影では、めり込まない向きを選ぶ）。横向き（±90°）に近い順に試す
      const side = Math.atan2(-run.z, run.x);
      const dist = 5.0;
      let best = side;
      for (const off of [0, Math.PI, 0.5, -0.5, Math.PI + 0.5, Math.PI - 0.5, 1, -1, Math.PI + 1, Math.PI - 1]) {
        const yaw = side + off;
        if (g.world.lineOfSight(p.body.x, p.body.z, p.body.x + Math.sin(yaw) * dist * 1.1, p.body.z + Math.cos(yaw) * dist * 1.1, 0.5)) {
          best = yaw;
          break;
        }
      }
      g.cam.yaw = best;
      g.cam.pitch = 0.12;
      g.cam.distance = dist;
      g.renderNow(40);
    });
    await sleep(150);
    await page.screenshot({ path: file });
    const end = await travRun(160, 'done');
    const top = await page.evaluate(() => {
      const g = window.__mw.game;
      const { ox, oz, run } = g.__trav;
      const p = g.player;
      // 上面の上（面から奥へ入った位置）にいるか: 障害物の中心からの、面の正面方向の距離
      return { depthIn: -((p.body.x - ox) * run.x + (p.body.z - oz) * run.z), y: p.y };
    });
    console.log(`[traverse] ${kind} ${JSON.stringify({ started: mid.started, midY: mid.y, endState: end.state, y: end.y, grounded: end.grounded, ...top })}`);
    return { mid, end, top };
  };
  const climbA = await climbShot('climb', 'artifacts/shot-traverse-climb-block.png');
  const climbB = await climbShot('climbHigh', 'artifacts/shot-traverse-climb-terrace.png');
  if (
    climbA.mid.started?.kind !== 'climb' || !climbA.end.grounded || Math.abs(climbA.end.y - 1.5) > 1e-6 || climbA.end.state !== 'idle' || climbA.mid.y < 0.2 ||
    climbB.mid.started?.kind !== 'climb' || !climbB.end.grounded || Math.abs(climbB.end.y - 2.2) > 1e-6 || climbB.end.state !== 'idle' || climbB.mid.y < 0.5
  ) {
    console.error('[traverse] 登れる縁（石の箱 1.5・壇 2.2）を掴んで登れない（種別・ぶら下がりの高さ・終点の高さ）');
    process.exitCode = 3;
  }
  if (
    mantleMid.started?.kind !== 'mantle' || !mantleEnd.grounded || Math.abs(mantleEnd.y - 0.85) > 1e-6 || mantleEnd.state !== 'idle' ||
    vaultMid.started?.kind !== 'vault' || vaultEnd.y !== 0 || vaultEnd.state !== 'run' || vaultAfter.beyond < 0.5
  ) {
    console.error('[traverse] 低い岩に乗り上がれない・薄い壁を乗り越えられない（種別・終点の高さ・向こう側への着地・走り続け）');
    process.exitCode = 3;
  }

  // 敵の迂回とカメラの衝突（M7-4a。ADR-043）: 斜めの柱（折れた柱。45°・半径 9m）を挟んで敵とプレイヤーが向かい合う。敵は柱を回り込んで届く。
  // カメラは縁の柱の手前までしか引かれない（柱の陰に入らない）
  const steer = await page.evaluate((solo) => {
    const g = window.__mw.game;
    g.restart({ ...solo, maxAttackers: 0 });
    g.setLoadout('sword');
    g.stepNow(1);
    const col = g.world.obstacles.find((o) => o.kind === 'circle' && o.top > 3 && o.top < 4 && Math.abs(o.x - o.z) < 1e-6 && o.x > 0);
    const len = Math.hypot(col.x, col.z);
    // 柱を通る、中心への接線の向き。柱の両側 3.2m に、敵とプレイヤーを置く
    const tx = -col.z / len;
    const tz = col.x / len;
    const e = g.enemies[0].enemy;
    const p = g.player;
    p.body.x = col.x + tx * 3.2;
    p.body.z = col.z + tz * 3.2;
    p.yaw = Math.atan2(-tx, -tz);
    e.place(col.x - tx * 3.2, col.z - tz * 3.2, Math.atan2(tx, tz));
    g.stepNow(2);
    const start = { x: e.body.x, z: e.body.z };
    const px = p.body.x;
    const pz = p.body.z;
    // まっすぐな線（敵 → プレイヤー）からの、敵の横ずれの最大
    const ax = px - start.x;
    const az = pz - start.z;
    const alen = Math.hypot(ax, az);
    let maxOff = 0;
    let reached = -1;
    let shotAt = -1;
    for (let i = 0; i < 60 * 14; i++) {
      g.stepNow(1);
      const off = Math.abs(((e.body.x - start.x) * az - (e.body.z - start.z) * ax) / alen);
      maxOff = Math.max(maxOff, off);
      if (shotAt < 0 && off > 1.1) shotAt = i; // 柱の脇を通るあたり（横ずれが最大に近い）
      if (shotAt >= 0 && i === shotAt + 8) break;
    }
    // 上から見る: 敵 → プレイヤーの向きを画面の横に
    g.cam.yaw = Math.atan2(-az, ax) + Math.PI / 2;
    g.cam.pitch = 0.95;
    g.cam.distance = 9;
    g.renderNow(14);
    return { maxOff, shotAt, startDist: alen, col: { x: col.x, z: col.z } };
  }, SOLO);
  await sleep(150);
  await page.screenshot({ path: 'artifacts/shot-steering.png' });
  const steerEnd = await page.evaluate(() => {
    const g = window.__mw.game;
    const e = g.enemies[0].enemy;
    const p = g.player;
    // 続きを進めて、プレイヤーのそばまで来るか
    let reached = -1;
    for (let i = 0; i < 60 * 14; i++) {
      g.stepNow(1);
      if (Math.hypot(e.body.x - p.body.x, e.body.z - p.body.z) <= e.def.stopDistance + 0.3) {
        reached = i;
        break;
      }
    }
    return { reached, dist: Math.hypot(e.body.x - p.body.x, e.body.z - p.body.z) };
  });
  console.log(`[steering] ${JSON.stringify({ ...steer, ...steerEnd })}`);
  if (steer.maxOff < 0.9 || steerEnd.reached < 0) {
    console.error('[steering] 柱を挟んだ敵が、柱を回り込めない（横ずれ・到達）');
    process.exitCode = 3;
  }
  const camShot = await page.evaluate((solo) => {
    const g = window.__mw.game;
    g.restart({ ...solo, maxAttackers: 0 });
    g.setLoadout('sword');
    g.stepNow(1);
    for (const e of g.enemies) e.enemy.place(0, -12, 0);
    // 縁の柱（上面 4.5。縁から 1.6m 内側）の内側 1.5m に立ち、カメラを柱の外側へ向ける（背後が柱）
    const pillar = g.world.obstacles.find((o) => o.kind === 'circle' && o.top > 4);
    const len = Math.hypot(pillar.x, pillar.z);
    const rx = pillar.x / len;
    const rz = pillar.z / len;
    const p = g.player;
    p.body.x = pillar.x - rx * 1.8;
    p.body.z = pillar.z - rz * 1.8;
    p.yaw = Math.atan2(-rx, -rz);
    g.stepNow(2);
    g.cam.yaw = Math.atan2(rx, rz); // カメラは柱のある外側に付く（プレイヤー → カメラの向き = 外向き）
    g.cam.pitch = 0.3;
    g.cam.distance = 4.9;
    g.renderNow(14);
    const c = g.cam.camera.position;
    return { camFromPlayer: Math.hypot(c.x - p.body.x, c.z - p.body.z), pillarFromPlayer: 1.8, full: 4.9 * Math.cos(0.3) };
  }, SOLO);
  await sleep(150);
  await page.screenshot({ path: 'artifacts/shot-camera-collision.png' });
  console.log(`[camera] ${JSON.stringify(camShot)}`);
  if (camShot.camFromPlayer > camShot.pillarFromPlayer) {
    console.error('[camera] 柱の陰にカメラが入っている（柱の手前で止まらない）');
    process.exitCode = 3;
  }

  // 高さと視線（M7-4b。ADR-044）: (1) 石の壇（2.2m）の上のプレイヤーに、地面の子鬼は構えず（届かない）、背の高い岩鬼は届く
  // (2) 折れた柱の陰のプレイヤーに、提灯は見える位置まで回り込んでから撃つ (3) 柱の陰の敵はロックできない
  const oneEnemy = (type) => ({ waves: [[{ type, offset: 0, radius: 6 }]], waveGapFrames: 100, victoryDelayFrames: 75, defeatDelayFrames: 150, maxAttackers: 2 });
  const onTerrace = (type) => page.evaluate(([cfg, type]) => {
    const g = window.__mw.game;
    g.restart(cfg);
    g.setLoadout('sword');
    g.stepNow(1);
    const t = g.world.obstacles.find((o) => o.kind === 'box' && o.top > 2 && o.climbable);
    const len = Math.hypot(t.x, t.z);
    const ux = t.x / len; // 壇の中心 → 外向き
    const uz = t.z / len;
    const p = g.player;
    p.body.x = t.x;
    p.body.z = t.z;
    p.y = t.top;
    p.grounded = true;
    p.velY = 0;
    p.yaw = Math.atan2(-ux, -uz);
    const e = g.enemies[0].enemy;
    // 敵は壇の内側の面（壇の奥行き 1m + 体の半径 + すき間）に、プレイヤーの方を向いて立つ
    const d = t.hz + e.def.radius + 0.4;
    e.place(t.x - ux * d, t.z - uz * d, Math.atan2(ux, uz));
    g.stepNow(2);
    let attacked = false;
    let hits = 0;
    const hp0 = p.health.hp;
    for (let i = 0; i < 60 * 5; i++) {
      g.stepNow(1);
      if (e.state === 'windup' || e.state === 'attack') attacked = true;
      hits = hp0 - p.health.hp;
    }
    g.cam.yaw = Math.atan2(uz, -ux) + 0.4;
    g.cam.pitch = 0.2;
    g.cam.distance = 6.5;
    g.renderNow(14);
    return { attacked, hpLost: hits, y: p.y, grounded: p.grounded, state: e.state };
  }, [oneEnemy(type), type]);
  const safeImp = await onTerrace('imp');
  await sleep(150);
  await page.screenshot({ path: 'artifacts/shot-terrace-safe.png' });
  const safeOgre = await onTerrace('ogre');
  console.log(`[reach] terrace imp ${JSON.stringify(safeImp)} ogre ${JSON.stringify(safeOgre)}`);
  if (safeImp.attacked || safeImp.hpLost > 0 || Math.abs(safeImp.y - 2.2) > 1e-6 || !safeOgre.attacked) {
    console.error('[reach] 壇の上のプレイヤーに、地面の子鬼が構える・当たる／背の高い岩鬼が構えない（縦の届き）');
    process.exitCode = 3;
  }

  const lanternHidden = await page.evaluate((cfg) => {
    const g = window.__mw.game;
    g.restart(cfg);
    g.setLoadout('sword');
    g.stepNow(1);
    const col = g.world.obstacles.find((o) => o.kind === 'circle' && o.top > 3 && o.top < 4 && Math.abs(o.x - o.z) < 1e-6 && o.x > 0);
    const len = Math.hypot(col.x, col.z);
    const ux = col.x / len;
    const uz = col.z / len;
    const p = g.player;
    p.body.x = col.x - ux * 2.2;
    p.body.z = col.z - uz * 2.2;
    p.yaw = Math.atan2(ux, uz);
    const e = g.enemies[0].enemy;
    e.place(col.x + ux * 3, col.z + uz * 3, Math.atan2(-ux, -uz));
    g.stepNow(2);
    const sightAtStart = e.sight;
    // 柱の陰のまま鬼火を撃っていないか: 予備動作に入るまで進めて、そのときの位置と視線を調べる
    let windupAt = -1;
    for (let i = 0; i < 60 * 15 && windupAt < 0; i++) {
      g.stepNow(1);
      if (e.state === 'windup') windupAt = i;
    }
    const offLine = Math.abs((e.body.x - col.x) * -uz + (e.body.z - col.z) * ux); // 柱を通る径からの横ずれ
    const sightAtWindup = e.sight;
    // ロック: 柱の陰の敵はロックできない
    e.place(col.x + ux * 3, col.z + uz * 3, 0);
    for (let k = 0; k < 4; k++) g.stepNow(1);
    g.inject({ lockPressed: true });
    g.stepNow(1);
    const lockedBehind = g.lockOn.locked;
    // 上から、柱・プレイヤー・提灯が収まるように（注視点を固定する。撮ったあとに外す）
    g.cam.pin((p.body.x + e.body.x) / 2, 0.5, (p.body.z + e.body.z) / 2);
    g.cam.yaw = Math.atan2(-uz, ux) + Math.PI / 2;
    g.cam.pitch = 1.0;
    g.cam.distance = 12;
    g.renderNow(14);
    return { sightAtStart, windupAt, sightAtWindup, offLine, lockedBehind };
  }, oneEnemy('lantern'));
  await sleep(150);
  await page.screenshot({ path: 'artifacts/shot-sight-lantern.png' });
  const lockOpen = await page.evaluate(() => {
    const g = window.__mw.game;
    g.cam.unpin();
    const e = g.enemies[0].enemy;
    // 柱の陰から出して、ロックできるか
    e.place(e.body.x, e.body.z, 0);
    const p = g.player;
    e.place(p.body.x + 3, p.body.z - 3, 0);
    g.stepNow(2);
    g.inject({ lockPressed: true });
    g.stepNow(1);
    return { locked: g.lockOn.locked };
  });
  console.log(`[sight] ${JSON.stringify({ ...lanternHidden, lockOpen: lockOpen.locked })}`);
  if (lanternHidden.sightAtStart || lanternHidden.windupAt < 0 || !lanternHidden.sightAtWindup || lanternHidden.offLine < 1 || lanternHidden.lockedBehind) {
    console.error('[sight] 柱の陰の提灯が回り込まずに撃つ・視線の外で構える／柱の陰の敵をロックできてしまう');
    process.exitCode = 3;
  }

  // 突進の激突（M7-4c。ADR-045）: 猪が、プレイヤーの先（背後）の柱に突進して激突する。猪は自分にダメージを受け、体勢を崩して動けない。反撃の窓のあいだ、プレイヤーの攻撃は大きなダメージになる
  const crashRun = await page.evaluate((cfg) => {
    const g = window.__mw.game;
    g.restart(cfg);
    g.setLoadout('sword');
    g.stepNow(1);
    const col = g.world.obstacles.find((o) => o.kind === 'circle' && o.top > 3 && o.top < 4 && Math.abs(o.x - o.z) < 1e-6 && o.x > 0);
    const len = Math.hypot(col.x, col.z);
    const ux = col.x / len; // 中心 → 柱の外向き
    const uz = col.z / len;
    const p = g.player;
    const e = g.enemies[0].enemy;
    // 柱の手前（中心側）に猪、そのさらに外側（柱の少し手前）にプレイヤー。猪は柱へ向かって突進する（プレイヤーの方 = 柱の方）
    e.place(col.x - ux * 7.2, col.z - uz * 7.2, Math.atan2(ux, uz));
    p.body.x = col.x - ux * 3.2;
    p.body.z = col.z - uz * 3.2;
    p.yaw = Math.atan2(-ux, -uz);
    g.stepNow(2);
    const hp0 = e.health.hp;
    // プレイヤーは突進をかわす: 猪が突進に入ったら、通り道の脇へ寄る（スティックの代わりに位置を動かす）
    let crashed = -1;
    let dodged = false;
    for (let i = 0; i < 60 * 12 && crashed < 0; i++) {
      g.stepNow(1);
      if (!dodged && e.state === 'attack') {
        p.body.x += -uz * 2.2; // 通り道の脇へ（当たらない位置）
        p.body.z += ux * 2.2;
        dodged = true;
      }
      if (e.crashSerial > 0) crashed = i;
    }
    // 激突の少し後の絵: 猪が柱のそばで動けない
    g.stepNow(18);
    g.cam.yaw = Math.atan2(-uz, ux) + 0.5;
    g.cam.pitch = 0.45;
    g.cam.distance = 8;
    g.renderNow(14);
    return { crashed, dodged, state: e.state, hpLost: hp0 - e.health.hp, hp: e.health.hp, riposte: e.riposte !== null, dist: Math.hypot(e.body.x - col.x, e.body.z - col.z) };
  }, { waves: [[{ type: 'boar', offset: 0, radius: 6 }]], waveGapFrames: 100, victoryDelayFrames: 75, defeatDelayFrames: 150, maxAttackers: 2 });
  await sleep(150);
  await page.screenshot({ path: 'artifacts/shot-crash.png' });
  console.log(`[crash] ${JSON.stringify(crashRun)}`);
  if (crashRun.crashed < 0 || crashRun.state !== 'stagger' || crashRun.hpLost <= 0 || !crashRun.riposte || crashRun.dist < 1.4) {
    console.error('[crash] 猪が柱に激突しない・体勢を崩さない・自分にダメージを受けない・柱にめり込む');
    process.exitCode = 3;
  }

  // 壊せる物・床の危険地帯（M7-4d / M7-4e。ADR-046）: (1) 木箱を叩いて壊す（世界から消え、通り抜けられる） (2) 猪の突進が木箱を突き破る（激突しない）
  // (3) 炎の床に立つと燃える・跳べば避けられる・敵も燃えて倒れる
  const oneBoar = { waves: [[{ type: 'boar', offset: 0, radius: 6 }]], waveGapFrames: 100, victoryDelayFrames: 75, defeatDelayFrames: 150, maxAttackers: 2 };
  const breakRun = await page.evaluate((cfg) => {
    const g = window.__mw.game;
    g.restart(cfg);
    g.setLoadout('sword');
    g.stepNow(1);
    for (const e of g.enemies) e.enemy.place(0, -13, 0); // 敵は遠くへ（撮影の邪魔をしない）
    const crates = g.breakables.filter((b) => g.world.obstacles[b.index].kind === 'box');
    const target = crates[0];
    const o = g.world.obstacles[target.index];
    const p = g.player;
    // 木箱の中心 → 闘技場の中心の向きに 1.3m 離れて立ち、木箱の方を向く
    const len = Math.hypot(o.x, o.z);
    const ux = o.x / len;
    const uz = o.z / len;
    p.body.x = o.x - ux * 1.3;
    p.body.z = o.z - uz * 1.3;
    p.yaw = Math.atan2(ux, uz);
    g.stepNow(2);
    const cam = () => {
      g.cam.yaw = Math.atan2(-uz, ux) + 0.5;
      g.cam.pitch = 0.3;
      g.cam.distance = 5.5;
    };
    let hits = 0;
    let brokeAt = -1;
    for (let i = 0; i < 60 * 8 && brokeAt < 0; i++) {
      if (i % 30 === 0) g.inject({ attackPressed: true });
      g.stepNow(1);
      if (!g.world.isActive(target.index)) brokeAt = i;
      else hits = target.max - target.hp;
    }
    // 壊れたあとの場所: 通り抜けられる（押し出されない）
    const probe = { x: o.x, z: o.z, r: 0.38 };
    const pushed = g.world.moveCircle(probe, 0);
    const others = crates.filter((b) => b !== target && g.world.isActive(b.index)).length;
    cam();
    g.renderNow(14);
    return { brokeAt, hits, active: g.world.isActive(target.index), broken: target.broken, pushed, othersIntact: others, total: crates.length, potions: g.inventory.count('potionS') };
  }, oneBoar);
  await sleep(150);
  await page.screenshot({ path: 'artifacts/shot-breakable.png' });
  console.log(`[break] ${JSON.stringify(breakRun)}`);
  if (breakRun.brokeAt < 0 || breakRun.active || !breakRun.broken || breakRun.pushed || breakRun.othersIntact !== breakRun.total - 1) {
    console.error('[break] 木箱を叩いて壊せない・壊れても世界に残る・ほかの木箱まで壊れる');
    process.exitCode = 3;
  }

  const smashRun = await page.evaluate((cfg) => {
    const g = window.__mw.game;
    g.restart(cfg);
    g.setLoadout('sword');
    g.stepNow(1);
    const crate = g.breakables.find((b) => g.world.obstacles[b.index].kind === 'box');
    const o = g.world.obstacles[crate.index];
    const len = Math.hypot(o.x, o.z);
    const ux = o.x / len;
    const uz = o.z / len;
    const e = g.enemies[0].enemy;
    const p = g.player;
    // 猪 → プレイヤー → 木箱 が一直線（中心から外向き）。プレイヤーは突進をかわす
    e.place(o.x - ux * 7.5, o.z - uz * 7.5, Math.atan2(ux, uz));
    p.body.x = o.x - ux * 3.6;
    p.body.z = o.z - uz * 3.6;
    p.yaw = Math.atan2(-ux, -uz);
    g.stepNow(2);
    let dodged = false;
    let smashedAt = -1;
    for (let i = 0; i < 60 * 12 && smashedAt < 0; i++) {
      g.stepNow(1);
      if (!dodged && e.state === 'attack') {
        p.body.x += -uz * 2.2;
        p.body.z += ux * 2.2;
        dodged = true;
      }
      if (!g.world.isActive(crate.index)) smashedAt = i;
    }
    g.stepNow(10);
    g.cam.yaw = Math.atan2(-uz, ux) + 0.6;
    g.cam.pitch = 0.4;
    g.cam.distance = 7;
    g.renderNow(14);
    return { smashedAt, dodged, crashed: e.crashSerial, state: e.state, dist: Math.hypot(e.body.x - o.x, e.body.z - o.z) };
  }, oneBoar);
  await sleep(150);
  await page.screenshot({ path: 'artifacts/shot-smash.png' });
  console.log(`[smash] ${JSON.stringify(smashRun)}`);
  if (smashRun.smashedAt < 0 || smashRun.crashed !== 0) {
    console.error('[smash] 猪が木箱を突き破れない（壊れない）・突き破るのに激突してしまう');
    process.exitCode = 3;
  }

  const fireRun = await page.evaluate((cfg) => {
    const g = window.__mw.game;
    g.restart(cfg);
    g.setLoadout('sword');
    g.stepNow(1);
    for (const e of g.enemies) e.enemy.place(0, -13, 0);
    const h = g.world.hazards[0];
    const p = g.player;
    p.body.x = h.x;
    p.body.z = h.z;
    p.yaw = 0;
    g.stepNow(2);
    const hp0 = p.health.hp;
    g.stepNow(70); // 1 秒あまり立ち続ける（2 回燃える）
    const stood = hp0 - p.health.hp;
    // 跳んでいる（足が高い）あいだは燃えない: 足の高さを持ち上げた状態で同じ時間
    const hp1 = p.health.hp;
    p.y = 1.0;
    p.velY = 0;
    p.grounded = false;
    for (let i = 0; i < 20; i++) {
      p.y = 1.0;
      p.velY = 0;
      g.stepNow(1);
    }
    const airborne = hp1 - p.health.hp;
    // 見た目: 炎の床に立つ絵
    p.y = 0;
    p.grounded = true;
    g.cam.yaw = 0.4;
    g.cam.pitch = 0.4;
    g.cam.distance = 6;
    g.renderNow(14);
    return { stood, airborne };
  }, oneBoar);
  await sleep(150);
  await page.screenshot({ path: 'artifacts/shot-fire.png' });
  const burnEnemy = await page.evaluate((cfg) => {
    const g = window.__mw.game;
    g.restart(cfg);
    g.setLoadout('sword');
    g.stepNow(1);
    const h = g.world.hazards[0];
    const e = g.enemies[0].enemy;
    g.player.body.x = -h.x;
    g.player.body.z = -h.z;
    e.place(h.x, h.z, 0);
    const hp0 = e.health.hp;
    // 炎の中で待つ（子鬼のような小さな敵が燃え尽きるまで。猪は体力が多いので、体力を減らしておく）
    e.health.hp = 20;
    g.stepNow(2);
    const hp1 = e.health.hp;
    let died = -1;
    for (let i = 0; i < 60 * 6 && died < 0; i++) {
      e.place(h.x, h.z, 0); // 炎の中に留める
      g.stepNow(1);
      if (e.dead) died = i;
    }
    return { hp0, hp1, died, dead: e.dead, kills: g.encounter.kills };
  }, oneBoar);
  console.log(`[fire] ${JSON.stringify({ ...fireRun, burn: burnEnemy })}`);
  if (fireRun.stood <= 0 || fireRun.airborne !== 0 || !burnEnemy.dead) {
    console.error('[fire] 炎の床で燃えない・跳んでいても燃える・炎の中の敵が燃え尽きない');
    process.exitCode = 3;
  }

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

  // 連携の拡充（ADR-047）: 前へ倒しながら連打して、片手剣は 7 連・大剣は 5 連まで出し切る。7 連の最後（燕返し）の絵に、ガイドの履歴（直近 5 件。前は「…」）が出る。
  // 連携の履歴が最長まで届かない・履歴が幅に収まらないときは異常終了（process.exitCode = 3）
  for (const [loadout, ids, file] of [
    // 後続の場面（メニュー・パッシブ）は片手剣を前提にしているので、装備は片手剣で終える
    ['greatsword', ['gs1', 'gs2', 'gsDrop', 'gsBounce', 'gsCrush'], 'artifacts/shot-chain5-greatsword.png'],
    ['sword', ['combo1', 'combo2', 'combo3', 'comboUpper', 'comboSlam', 'slamRip', 'swallow'], 'artifacts/shot-chain7.png'],
  ]) {
    const chain = await page.evaluate(([solo, loadout, ids]) => {
      const g = window.__mw.game;
      g.restart({ ...solo, maxAttackers: 0 });
      g.setLoadout(loadout);
      g.stepNow(1);
      g.player.body.x = 0;
      g.player.body.z = 0;
      g.player.yaw = 0;
      g.enemies[0].enemy.place(0, 1.6, Math.PI);
      const seen = [];
      g.inject({ attackPressed: true });
      g.stepNow(1);
      for (let i = 0; i < 400 && g.player.state === 'attack'; i++) {
        const id = g.player.attack ? g.player.attack.id : null;
        if (id && seen[seen.length - 1] !== id) seen.push(id);
        // 最後の技まで来たら、その途中（2 つ目の当たりのころ）で止めて絵を撮る
        if (seen.length === ids.length && g.player.stateFrame >= 14) break;
        // 受付が開いたら、前へ倒して押す（連携の続き）。敵は体の前に置き続ける
        g.enemies[0].enemy.place(0, g.player.body.z + 1.6, Math.PI);
        if (g.player.stateFrame >= g.player.attackFrames.cancelFrame) g.inject({ attackPressed: true, moveX: 0, moveY: 1 });
        g.stepNow(1);
      }
      g.renderNow(5);
      return { seen, chain: [...g.player.chain] };
    }, [SOLO, loadout, ids]);
    console.log(`[chain] ${loadout} ${JSON.stringify(chain)}`);
    if (JSON.stringify(chain.seen) !== JSON.stringify(ids) || chain.chain.length !== ids.length) {
      console.error(`[chain] ${loadout}: 連携が最長（${ids.length} 連）まで出ていません`);
      process.exitCode = 3;
    }
    await sleep(120);
    await page.screenshot({ path: file });
  }

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
  await page.locator('.sk-card').nth(6).locator('.st-btn.plus').click(); // 6 番目 = 大剣の最初（崩山）。片手剣のスキルが 6 個（ADR-038）
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
  // パッシブ（ADR-037）: スキルタブの下に 12 本。未習得で前提が満たされないものは暗く、＋が押せない。剣術習熟に 1 ポイント振ると習得され、片手剣のダメージに +4% が足される
  const pa0 = await page.evaluate(() => ({
    cards: document.querySelectorAll('.pa-card').length,
    locked: [...document.querySelectorAll('.pa-card.locked')].map((c) => c.querySelector('b')?.textContent),
    plusDisabled: [...document.querySelectorAll('.pa-card')].filter((c) => c.querySelector('.st-btn.plus').disabled).length,
    kp: window.__mw.game.growth.skillPoints,
    dmg: window.__mw.game.player.mods.damage,
  }));
  console.log(`[passive-ui] 前 ${JSON.stringify(pa0)}`);
  await page.locator('.pa-card').nth(0).locator('.st-btn.plus').click(); // 剣術習熟
  await sleep(100);
  const pa1 = await page.evaluate(() => ({
    kp: window.__mw.game.growth.skillPoints,
    lv: window.__mw.game.growth.passiveLevel('swordMastery'),
    dmg: window.__mw.game.player.mods.damage,
    learned: document.querySelectorAll('.pa-card.learned').length,
    text: document.querySelector('.pa-card .pa-now')?.textContent ?? '',
  }));
  console.log(`[passive-ui] 後 ${JSON.stringify(pa1)}`);
  if (pa0.cards !== 12 || pa0.locked.length !== 4 || pa0.kp !== 2 || pa1.kp !== 1 || pa1.lv !== 1 || Math.abs(pa1.dmg - 1.07) > 1e-9 || pa1.learned !== 1) {
    console.error('[passive-ui] パッシブの一覧（12 本・前提で暗いものが 4 本）・習得（ポイント −1・ダメージ +4%）が想定どおりでない');
    process.exitCode = 3;
  }
  await page.evaluate(() => document.querySelector('.sk-passive-title')?.scrollIntoView({ block: 'start' }));
  await sleep(150);
  await page.screenshot({ path: 'artifacts/shot-menu-passives.png' });
  await page.locator('.menu-tab').nth(2).click();
  await sleep(150);
  await page.screenshot({ path: 'artifacts/shot-moves.png' });
  // 段階（敵の色違い。ADR-036）: 何もクリアしていないので段階 1 だけ。2 以降は「？？？」で、選べない
  await page.locator('.menu-tab').nth(3).click();
  await sleep(150);
  await page.screenshot({ path: 'artifacts/shot-menu-tier.png' });
  const tierTab = await page.evaluate(() => ({
    cards: document.querySelectorAll('.tr-card').length,
    locked: document.querySelectorAll('.tr-card.locked').length,
    selected: document.querySelectorAll('.tr-card.selected').length,
    picks: [...document.querySelectorAll('.tr-pick')].map((b) => b.disabled || b.hidden),
  }));
  console.log(`[tier-tab] ${JSON.stringify(tierTab)}`);
  if (tierTab.cards !== 4 || tierTab.locked !== 3 || tierTab.selected !== 1 || tierTab.picks.some((x) => !x)) {
    console.error('[tier-tab] 段階のタブが想定どおりでない（4 枚・解放済み 1・選択中 1・押せるボタンなし）');
    process.exitCode = 3;
  }
  await page.locator('.menu-tab').nth(4).click();
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

  // 敵の段階（色違いの強化版。ADR-036）: 種類 × 段階の一覧。段が上がるほど色が替わり（紅・蒼・黒）ひと回り大きくなる。小型 4 種と大型 2 種を 2 枚に分けて撮る
  const tierSheet = async (kinds, file, xs, zs) => {
    const info = await page.evaluate(
      ({ solo, kinds, xs, zs }) => {
        const g = window.__mw.game;
        g.restart({ ...solo, waves: [[]], maxAttackers: 0 });
        g.player.body.x = 0;
        g.player.body.z = 0;
        g.player.yaw = 0;
        g.cam.yaw = Math.PI;
        g.damageNumbers.clear();
        const rows = [];
        kinds.forEach((kind, ki) => {
          for (let tier = 1; tier <= 4; tier++) {
            const e = g.spawnEnemy(kind, xs[tier - 1], zs[ki], tier);
            rows.push({ kind, tier, name: e.def.name, hp: e.health.max, tierDef: e.def.tier ?? 1 });
          }
        });
        g.renderNow(20);
        return rows;
      },
      { solo: SOLO, kinds, xs, zs },
    );
    await sleep(150);
    await page.screenshot({ path: file });
    return info;
  };
  const small = await tierSheet(['imp', 'boar', 'lantern', 'bat'], 'artifacts/shot-tiers-small.png', [-4.5, -1.5, 1.5, 4.5], [4.5, 7.5, 10.5, 13.5]);
  const large = await tierSheet(['ogre', 'boss'], 'artifacts/shot-tiers-large.png', [-8, -3, 3, 8], [8, 17]);
  console.log(`[tiers] ${small.concat(large).map((r) => `${r.name}:${r.hp}`).join(' ')}`);
  if (small.concat(large).some((r, i) => r.tierDef !== (i % 4) + 1) || small.concat(large).length !== 24) {
    console.error('[tiers] 段階ごとの敵が出ていない（名前・段階）');
    process.exitCode = 3;
  }

  // パッシブの発動（ADR-037）: 受け流し Lv2（パリィ成功で体力 +4）と、闘気（敵を倒すと攻撃力が重なる。連撃の心得 Lv2 が前提）
  const passiveRun = await page.evaluate((solo) => {
    const g = window.__mw.game;
    g.growth.reset();
    g.growth.addXp(660); // Lv7 = スキルポイント 6
    g.growth.addPassive('evasion');
    g.growth.addPassive('parryArt');
    g.growth.addPassive('parryArt');
    g.growth.addPassive('comboArt');
    g.growth.addPassive('comboArt');
    g.growth.addPassive('momentum');
    g.applyGrowth(); // private だが実行時は呼べる

    // (1) パリィに成功すると体力が回復する（盾。予備動作の途中で構える）
    g.restart({ ...solo, maxAttackers: 2 });
    g.setLoadout('sword-shield');
    g.stepNow(1);
    const e = g.enemies[0].enemy;
    e.place(0, 2.4, Math.PI);
    for (let i = 0; i < 400 && !(e.state === 'windup' && e.stateFrame >= 35); i++) g.stepNow(1);
    g.player.health.hp = 60;
    g.inject({ guardPressed: true, guardHeld: true });
    g.stepNow(1);
    const pr0 = g.player.parrySerial;
    let parried = false;
    for (let i = 0; i < 60 && !parried; i++) {
      g.inject({ guardHeld: true });
      g.stepNow(1);
      parried = g.player.parrySerial !== pr0;
    }
    const heal = { parried, hp: g.player.health.hp, mods: g.player.mods.parryHeal, parryFrames: g.player.mods.parryFrames };

    // (2) 敵を倒すと闘気が重なる（HP 1 の敵を 1 発で倒す）。倒したあと、攻撃力に闘気が足される
    g.restart(solo);
    g.setLoadout('sword');
    g.stepNow(1);
    g.player.body.x = 0;
    g.player.body.z = 0;
    g.player.yaw = 0;
    const t = g.enemies[0].enemy;
    t.place(0, 1.9, Math.PI);
    t.health.hp = 1;
    g.inject({ attackPressed: true });
    g.stepNow(1);
    for (let i = 0; i < 80 && !t.dead; i++) g.stepNow(1);
    g.stepNow(2);
    g.renderNow(4);
    const buff = {
      killed: t.dead,
      stacks: g.killBuff.stacks,
      perStack: g.player.mods.killBuff,
      bonus: g.player.buffBonus,
      dmg: g.player.damageMul,
      base: g.player.mods.damage,
      badge: document.querySelector('.buff-badge')?.classList.contains('on') ?? false,
      text: document.querySelector('.buff-text')?.textContent ?? '',
    };
    return { heal, buff };
  }, SOLO);
  console.log(`[passive-run] ${JSON.stringify(passiveRun)}`);
  const { heal: ph, buff: pb } = passiveRun;
  if (!ph.parried || ph.hp !== 60 + 4 || ph.mods !== 4 || ph.parryFrames !== 2) {
    console.error('[passive-run] 受け流し Lv2: パリィ成功で体力 +4（60 → 64）・パリィ受付 +2f になっていない');
    process.exitCode = 3;
  }
  if (!pb.killed || pb.stacks !== 1 || Math.abs(pb.perStack - 0.02) > 1e-9 || Math.abs(pb.bonus - 0.02) > 1e-9 || Math.abs(pb.dmg - (pb.base + 0.02)) > 1e-9 || !pb.badge || !pb.text.includes('闘気 ×1')) {
    console.error('[passive-run] 闘気: 倒すと 1 重なり、攻撃力 +2%・HUD の印が出ているはず');
    process.exitCode = 3;
  }
  await sleep(120);
  await page.screenshot({ path: 'artifacts/shot-passive-buff.png' });
  await page.evaluate(() => {
    const g = window.__mw.game;
    g.growth.reset();
    g.applyGrowth(); // 後の撮影シーンに振り分けを持ち越さない
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
  // 勝つと次の段階が解放され、リザルトに「次の段階が解放されました」と「次の段階へ」が出る。押すと段階 2 の敵で最初から始まる（ADR-036）
  const win = await page.evaluate(() => {
    const g = window.__mw.game;
    return {
      cleared: g.progress.cleared,
      unlocked: g.progress.unlocked,
      note: document.querySelector('.result-unlock')?.textContent ?? '',
      noteHidden: document.querySelector('.result-unlock')?.classList.contains('hidden') ?? true,
      nextHidden: document.getElementById('result-next')?.classList.contains('hidden') ?? true,
      nextText: document.getElementById('result-next')?.textContent ?? '',
      tierText: document.querySelector('.result-tier')?.textContent ?? '',
      saved: JSON.parse(localStorage.getItem('mw.save') ?? 'null')?.progress ?? null,
    };
  });
  console.log(`[tier-win] ${JSON.stringify(win)}`);
  if (win.cleared !== 1 || win.unlocked !== 2 || win.noteHidden || win.nextHidden || !win.nextText.includes('弐') || win.saved?.cleared !== 1) {
    console.error('[tier-win] 勝って次の段階が解放され、リザルトに「次の段階へ」が出て、セーブされているはず');
    process.exitCode = 3;
  }
  await page.evaluate(() => document.getElementById('result-next')?.classList.add('armed'));
  await page.dispatchEvent('#result-next', 'pointerdown');
  const next = await page.evaluate(() => {
    const g = window.__mw.game;
    g.stepNow(2);
    g.renderNow(3);
    return { tier: g.progress.tier, encTier: g.encounter.tier, enemyTier: g.enemies[0]?.enemy.def.tier ?? 1, enemyName: g.enemies[0]?.enemy.def.name ?? '', badge: document.querySelector('.tier-badge')?.textContent ?? '' };
  });
  console.log(`[tier-next] ${JSON.stringify(next)}`);
  if (next.tier !== 2 || next.encTier !== 2) {
    console.error('[tier-next] 「次の段階へ」で段階 2 の戦闘が始まっていない');
    process.exitCode = 3;
  }

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

  // 開始画面の段階の選択（ADR-036）: 段階 2 までクリア済みのセーブ → 段階 3 まで選べて、4 は「？？？」。3 を選ぶとセーブされ、始めると段階 3 の敵が出る
  {
    const p2 = await browser.newPage({ viewport: { width: 1194, height: 834 }, deviceScaleFactor: 1 });
    p2.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
    p2.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
    await p2.addInitScript(() => {
      localStorage.setItem('mw.save', JSON.stringify({ version: 2, level: 12, xp: 0, statPoints: 0, skillPoints: 0, stats: { str: 5, dex: 5, agi: 5, int: 5, vit: 5 }, skills: {}, selected: {}, progress: { cleared: 2, tier: 2 } }));
    });
    await p2.goto(`http://127.0.0.1:${port}${BASE}?adaptive=0`, { waitUntil: 'load' });
    await p2.waitForFunction(() => Boolean(window.__mw?.game?.ready), null, { timeout: 60000 });
    await sleep(800);
    const chips = await p2.evaluate(() => [...document.querySelectorAll('.tier-chip')].map((c) => ({ tier: c.dataset.tier, text: c.textContent, locked: c.classList.contains('locked'), selected: c.classList.contains('selected') })));
    console.log(`[tier-start] ${JSON.stringify(chips)}`);
    if (chips.length !== 4 || chips.map((c) => c.locked).join() !== 'false,false,false,true' || chips[1]?.selected !== true) {
      console.error('[tier-start] 開始画面の段階: 4 つ・4 つ目だけ未解放・保存した段階 2 が選ばれているはず');
      process.exitCode = 3;
    }
    await p2.screenshot({ path: 'artifacts/shot-start-tier.png' });
    await p2.dispatchEvent('.tier-chip[data-tier="3"]', 'pointerdown');
    await p2.dispatchEvent('.tier-chip[data-tier="4"]', 'pointerdown'); // 未解放: 何も起きない
    const picked = await p2.evaluate(() => ({ tier: window.__mw.game.progress.tier, saved: JSON.parse(localStorage.getItem('mw.save') ?? 'null')?.progress ?? null }));
    await p2.dispatchEvent('#start-overlay', 'pointerdown');
    await sleep(600);
    const started = await p2.evaluate(() => {
      const g = window.__mw.game;
      g.loop.stop();
      g.stepNow(3);
      return { encTier: g.encounter.tier, enemy: g.enemies[0]?.enemy.def.name ?? null, badge: document.querySelector('.tier-badge')?.textContent ?? '' };
    });
    console.log(`[tier-start] 選んだ ${JSON.stringify(picked)} / 始めた ${JSON.stringify(started)}`);
    if (picked.tier !== 3 || picked.saved?.tier !== 3 || picked.saved?.cleared !== 2 || started.encTier !== 3 || started.enemy !== '蒼の子鬼') {
      console.error('[tier-start] 段階 3 を選んで始めると、段階 3 の敵（蒼の子鬼）の戦闘が始まり、選択がセーブされているはず');
      process.exitCode = 3;
    }
    await p2.evaluate(() => window.__mw.game.renderNow(10));
    await p2.screenshot({ path: 'artifacts/shot-start-tier-fight.png' });
    await p2.close();
  }

  // 杖（ADR-048）は最後に撮る（装備・メニューのタブなどの状態を、ほかのシーンへ持ち込まないため）
  await staffScenes();
  await spearScenes();

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
