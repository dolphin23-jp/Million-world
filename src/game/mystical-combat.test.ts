import { describe, expect, it } from 'vitest';
import { Player } from './player';
import { resolveEnemyAttacks, resolvePlayerAttack, type CombatTarget } from './combat';
import { cutProjectiles, resolveProjectilesOnPlayer } from './projectile-combat';
import { Enemy } from '../ai/enemy';
import { ENEMIES } from '../ai/data/enemies';
import { PROJECTILES } from '../combat/data/projectiles';
import { Mystical } from '../combat/mystical';
import { MYSTICAL } from '../combat/data/mystical';
import { ProjectileSystem, type Projectile, type ProjectileEnd } from '../combat/projectile';
import { createEmptyIntent, type InputIntent } from '../input/intent';
import { HitTracker, type HitEvent, type Hurtbox } from '../combat/hit';
import type { EnemyAttackerView, DefenderView } from './combat';
import { ARENA_RADIUS } from '../world/arena';

/**
 * ミスティカルドッジ（ジャスト回避。ADR-030）と本物の Player・Enemy・弾の結合テスト。Game.step と同じ順序で進める:
 * mystical.step()（敵を進めるか）→ player.setMystical → player.step → 敵 step（進めるときだけ）→ 弾 step → 解決。
 * カメラ yaw = π のとき、スティックの上は +Z。敵は (0, z) に置いてプレイヤー（原点）の方を向く。
 */
const DT = 1 / 60;
const CAM_YAW = Math.PI;
const BOAR = ENEMIES.boar.attack;
const WISP = PROJECTILES.wisp;

interface Scene {
  player: Player;
  enemy: Enemy;
  mystical: Mystical;
  system: ProjectileSystem;
  hurt: HitEvent[];
  /** ジャスト回避の合図の数（敵の攻撃・弾） */
  just: { melee: number; shot: number };
  /** 敵を進めたステップの数 */
  enemySteps: number;
  step(over?: Partial<InputIntent>): void;
  run(n: number, over?: Partial<InputIntent>): void;
  toWindup(frame: number): void;
}

function scene(type: 'boar' | 'lantern' = 'boar', z = 6.5): Scene {
  const player = new Player();
  const enemy = new Enemy(ENEMIES[type], 1, 0, z);
  enemy.place(0, z, Math.PI);
  const mystical = new Mystical();
  const system = new ProjectileSystem();
  let seenFire = 0;
  const sc: Scene = {
    player,
    enemy,
    mystical,
    system,
    hurt: [],
    just: { melee: 0, shot: 0 },
    enemySteps: 0,
    step(over = {}) {
      const enemiesRun = mystical.step();
      player.setMystical(mystical.active);
      player.step(DT, { ...createEmptyIntent(), ...over }, CAM_YAW);
      if (enemiesRun) {
        enemy.step(DT, player.body.x, player.body.z, !player.dead);
        sc.enemySteps++;
      }
      if (enemy.fireSerial !== seenFire) {
        seenFire = enemy.fireSerial;
        const s = enemy.shot;
        system.spawn(PROJECTILES[s.projectile], enemy.id, s.x, s.z, s.dirX, s.dirZ);
      }
      if (enemiesRun) system.step(DT, ARENA_RADIUS);
      const onEnd = (_p: Projectile, _r: ProjectileEnd): void => undefined;
      resolvePlayerAttack(player, [enemy as CombatTarget], () => undefined);
      cutProjectiles(system, player, onEnd);
      resolveEnemyAttacks([enemy], player, (ev) => sc.hurt.push(ev), {
        onJustDodge: () => {
          sc.just.melee++;
          mystical.trigger();
          player.setMystical(mystical.active);
          return mystical.active;
        },
      });
      resolveProjectilesOnPlayer(system, player, () => null, {
        onHit: (ev) => sc.hurt.push(ev),
        onEnd,
        onJustDodge: () => {
          sc.just.shot++;
          mystical.trigger();
          player.setMystical(mystical.active);
        },
      });
    },
    run(n, over) {
      for (let i = 0; i < n; i++) sc.step(over);
    },
    toWindup(frame) {
      for (let i = 0; i < 400 && !(enemy.state === 'windup' && enemy.stateFrame >= frame); i++) sc.step();
      expect(enemy.state).toBe('windup');
    },
  };
  return sc;
}

/** 猪の突進の予備動作の終わり（offset が正ならその手前、負ならそのあと = 突進が始まってから）にロールを押して、そこから frames 進めた結果 */
function boarDodgeAt(offset: number, frames = 90): Scene {
  const sc = scene('boar');
  sc.toWindup(0);
  sc.run(BOAR.windupFrames - offset);
  sc.step({ dodgePressed: true });
  sc.run(frames);
  return sc;
}

describe('ジャスト回避: 近接', () => {
  it('ロールの無敵で突進を避けるとミスティカルドッジが発動し、被弾しない', () => {
    // ロールを押す早さを少しずつずらして、無敵が突進の判定に重なる区間を探す
    const ok: number[] = [];
    for (let k = -40; k <= 60; k++) {
      const sc = boarDodgeAt(k, 40);
      if (sc.just.melee > 0) {
        ok.push(k);
        expect(sc.hurt.length).toBe(0);
        expect(sc.mystical.active || sc.mystical.cooldown > 0).toBe(true);
      }
    }
    // 十分に広い（人の指で押せる）受付がある
    expect(ok.length).toBeGreaterThanOrEqual(4);
  });

  it('早すぎる・遅すぎるロールは普通に被弾し、発動しない', () => {
    const sc = boarDodgeAt(60, 150);
    // 無敵が切れてから突進が来る: 被弾する（または別の形で当たる）か、少なくとも発動はしない
    expect(sc.just.melee).toBe(0);
    expect(sc.mystical.cooldown).toBe(0);
  });

  it('発動すると、そのあいだプレイヤーは無敵で、敵だけが遅くなる', () => {
    let sc: Scene | null = null;
    for (let k = -40; k <= 60 && !sc; k++) {
      const t = boarDodgeAt(k, 5);
      if (t.just.melee > 0) sc = t;
    }
    expect(sc).not.toBeNull();
    const s = sc!;
    expect(s.mystical.active).toBe(true);
    expect(s.player.invulnerable).toBe(true);
    expect(s.player.body.invulnerable).toBe(true);
    const before = s.enemySteps;
    const frame0 = s.enemy.stateFrame;
    s.run(100);
    // 100 ステップのうち、敵が進んだのは enemyScale の割合（5 回に 1 回）
    expect(s.enemySteps - before).toBe(Math.round(100 * MYSTICAL.enemyScale));
    expect(s.enemy.stateFrame - frame0).toBeLessThanOrEqual(Math.round(100 * MYSTICAL.enemyScale));
    // 無敵のあいだは被弾しない
    expect(s.hurt.length).toBe(0);
  });

  it('ミスティカルのあいだもプレイヤーは等倍で動ける（敵だけが遅い）', () => {
    const sc = scene('boar', 20);
    sc.mystical.trigger();
    sc.player.setMystical(true);
    sc.run(60, { moveY: 1 });
    // 60 ステップ（1 秒）走ると、加速を含めても 3m 以上進む
    expect(Math.hypot(sc.player.body.x, sc.player.body.z)).toBeGreaterThan(3);
    expect(sc.enemySteps).toBe(Math.round(60 * MYSTICAL.enemyScale));
  });

  it('避けた攻撃は記録され、ミスティカルが切れたあとに刺さらない', () => {
    let sc: Scene | null = null;
    for (let k = -40; k <= 60 && !sc; k++) {
      const t = boarDodgeAt(k, 5);
      if (t.just.melee > 0) sc = t;
    }
    const s = sc!;
    // 敵はまだ避けられた攻撃の最中（遅い時間で止まっている）。切れるまで進める
    expect(s.enemy.state).toBe('attack');
    s.run(MYSTICAL.durationFrames);
    expect(s.mystical.active).toBe(false);
    // 切れたあと、その攻撃が終わるまで立ったまま進める。持続が残っていても刺さらない（次の突進は別の攻撃）
    for (let i = 0; i < 200 && s.enemy.state === 'attack'; i++) s.step();
    expect(s.enemy.state).not.toBe('attack');
    expect(s.hurt.length).toBe(0);
  });

  it('クールダウン中は、同じロールでも発動しない（避けた攻撃は記録されず、普通のロールの無敵だけ）', () => {
    let tried = 0;
    for (let k = -40; k <= 60; k++) {
      const sc = scene('boar');
      sc.mystical.cooldown = 99999; // クールダウンが残っている
      sc.toWindup(0);
      sc.run(BOAR.windupFrames - k);
      sc.step({ dodgePressed: true });
      sc.run(40);
      if (sc.just.melee > 0) tried++;
      expect(sc.mystical.active).toBe(false);
      expect(sc.enemySteps).toBeGreaterThan(0);
    }
    // 避けるタイミング自体はあった（合図は出たが、発動は断られた）
    expect(tried).toBeGreaterThanOrEqual(4);
  });

  it('被弾後の無敵・ミスティカル中は dodging が false（ロールの無敵が避けさせているときだけ true）', () => {
    const p = new Player();
    expect(p.dodging).toBe(false);
    p.step(DT, { ...createEmptyIntent(), dodgePressed: true }, CAM_YAW);
    // 無敵フレームに入るまで進める
    let inWindow = false;
    for (let i = 0; i < 30; i++) {
      p.step(DT, createEmptyIntent(), CAM_YAW);
      if (p.dodging) inWindow = true;
    }
    expect(inWindow).toBe(true);
    const q = new Player();
    q.setMystical(true);
    q.step(DT, { ...createEmptyIntent(), dodgePressed: true }, CAM_YAW);
    for (let i = 0; i < 30; i++) {
      q.step(DT, createEmptyIntent(), CAM_YAW);
      expect(q.dodging).toBe(false);
      expect(q.invulnerable).toBe(true);
    }
  });
});

describe('ジャスト回避: 飛び道具', () => {
  it('ロールの無敵で鬼火を避けると発動し、弾は消えずにすり抜ける', () => {
    const lantern = ENEMIES.lantern.attack;
    let hit = false;
    for (let k = 0; k <= 80 && !hit; k++) {
      const sc = scene('lantern', 6.5);
      // 撃たれる直前まで進める
      for (let i = 0; i < 600 && sc.enemy.fireSerial === 0; i++) sc.step();
      // 撃たれたあと、弾が来るまでの間の k フレーム目にロールを押す（弾の速さと距離で、重なる押し始めがある）
      sc.run(k);
      sc.step({ dodgePressed: true });
      sc.run(40);
      if (sc.just.shot > 0) {
        hit = true;
        expect(sc.hurt.length).toBe(0);
        expect(sc.mystical.cooldown).toBeGreaterThan(0);
      }
    }
    expect(lantern.windupFrames).toBeGreaterThan(0);
    expect(WISP.speed).toBeGreaterThan(0);
    expect(hit).toBe(true);
  });

  it('弾の動きも遅くなる: 発動中は弾が enemyScale の割合でしか進まない', () => {
    const sc = scene('lantern', 6.5);
    for (let i = 0; i < 600 && sc.enemy.fireSerial === 0; i++) sc.step();
    const p = sc.system.pool.find((q) => q.alive)!;
    expect(p).toBeTruthy();
    sc.mystical.trigger();
    sc.player.setMystical(true);
    // 向きに沿った進み具合: 50 ステップで 10 ステップ分だけ進む
    const d0 = Math.hypot(p.x, p.z);
    sc.run(50);
    const d1 = Math.hypot(p.x, p.z);
    const per = (WISP.speed / 60) * 10;
    // 弾は前へ（プレイヤー向き）進んでいる。進んだ距離は 10 ステップぶん ± 1 ステップ
    expect(Math.abs(d0 - d1)).toBeLessThanOrEqual(per + (WISP.speed / 60) * 1.01);
    expect(Math.abs(d0 - d1)).toBeGreaterThan(per - (WISP.speed / 60) * 1.01);
  });
});

describe('ミスティカル中に重なった攻撃', () => {
  it('無敵の間に重なった攻撃は記録され、無敵が切れてもその攻撃は当たらない（ハンドラが true を返したとき）', () => {
    const tracker = new HitTracker();
    const attacker: EnemyAttackerView = { id: 7, attackActive: true, attackDef: ENEMIES.boar.attack, body: { x: 0, z: 1, r: 0.7 }, yaw: Math.PI, hitTracker: tracker };
    const body: Hurtbox = { id: 0, x: 0, z: 0, r: 0.4, invulnerable: true };
    const hits: HitEvent[] = [];
    const victim: DefenderView = { body, evading: true, takeHit: (ev) => (hits.push(ev), { dealt: 10, killed: false }) };
    let calls = 0;
    const handlers = { onJustDodge: () => (calls++, true) };
    resolveEnemyAttacks([attacker], victim, () => undefined, handlers);
    expect(calls).toBe(1);
    expect(tracker.has(0)).toBe(true);
    // 無敵が切れる。持続が残っていても、避けた攻撃には当たらない
    body.invulnerable = false;
    expect(resolveEnemyAttacks([attacker], victim, () => undefined, handlers)).toBe(0);
    expect(hits.length).toBe(0);
  });

  it('ハンドラが false（クールダウン中）なら記録されず、無敵が切れて持続が残っていれば当たる（従来どおり）', () => {
    const tracker = new HitTracker();
    const attacker: EnemyAttackerView = { id: 7, attackActive: true, attackDef: ENEMIES.boar.attack, body: { x: 0, z: 1, r: 0.7 }, yaw: Math.PI, hitTracker: tracker };
    const body: Hurtbox = { id: 0, x: 0, z: 0, r: 0.4, invulnerable: true };
    const hits: HitEvent[] = [];
    const victim: DefenderView = { body, dodging: true, takeHit: (ev) => (hits.push(ev), { dealt: 10, killed: false }) };
    const handlers = { onJustDodge: () => false };
    resolveEnemyAttacks([attacker], victim, () => undefined, handlers);
    expect(tracker.has(0)).toBe(false);
    body.invulnerable = false;
    resolveEnemyAttacks([attacker], victim, () => undefined, handlers);
    expect(hits.length).toBe(1);
  });

  it('回避もミスティカルでもない無敵（被弾後）では合図を出さない', () => {
    const attacker: EnemyAttackerView = { id: 7, attackActive: true, attackDef: ENEMIES.boar.attack, body: { x: 0, z: 1, r: 0.7 }, yaw: Math.PI, hitTracker: new HitTracker() };
    const body: Hurtbox = { id: 0, x: 0, z: 0, r: 0.4, invulnerable: true };
    const victim: DefenderView = { body, takeHit: () => ({ dealt: 0, killed: false }) };
    let calls = 0;
    resolveEnemyAttacks([attacker], victim, () => undefined, { onJustDodge: () => (calls++, true) });
    expect(calls).toBe(0);
  });
});
