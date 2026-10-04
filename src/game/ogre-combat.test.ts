import { describe, expect, it } from 'vitest';
import { Player } from './player';
import { resolveEnemyAttacks, resolvePlayerAttack, type CombatTarget } from './combat';
import { Enemy } from '../ai/enemy';
import { ENEMIES } from '../ai/data/enemies';
import { POISE_BREAK } from '../combat/data/poise';
import { createEmptyIntent, type InputIntent } from '../input/intent';
import type { HitEvent } from '../combat/hit';
import type { LoadoutId } from '../combat/data/loadouts';

/**
 * 岩鬼（重装型。ADR-027）と本物の Player の結合テスト。Game.step と同じ順序で 1 フレームずつ進める。
 * カメラ yaw = π のとき、スティックの上は +Z、右は −X、左は +X。岩鬼は (0, z) に置いてプレイヤー（原点）の方を向く。
 */
const DT = 1 / 60;
const CAM_YAW = Math.PI;
const DEF = ENEMIES.ogre;
const ATK = DEF.attack;

interface Scene {
  player: Player;
  enemy: Enemy;
  hurt: HitEvent[];
  parried: HitEvent[];
  blocked: HitEvent[];
  /** プレイヤーの攻撃が当たったときのダメージ（反撃の倍率が掛かった値）と、反撃だったか */
  dealt: { damage: number; base: number; riposte: boolean }[];
  step(over?: Partial<InputIntent>): void;
  run(n: number, over?: Partial<InputIntent>): void;
  toWindup(frame: number): void;
}

function scene(loadout: LoadoutId = 'sword', z = 3, x = 0): Scene {
  const player = new Player();
  player.equip(loadout);
  const enemy = new Enemy(DEF, 1, x, z);
  enemy.place(x, z, Math.atan2(-x, -z));
  const sc: Scene = {
    player,
    enemy,
    hurt: [],
    parried: [],
    blocked: [],
    dealt: [],
    step(over = {}) {
      player.step(DT, { ...createEmptyIntent(), ...over }, CAM_YAW);
      enemy.step(DT, player.body.x, player.body.z, !player.dead);
      resolvePlayerAttack(player, [enemy as CombatTarget], (ev, _t, _r, riposte) => sc.dealt.push({ damage: ev.damage, base: player.attack?.damage ?? 0, riposte }));
      resolveEnemyAttacks([enemy], player, (ev) => sc.hurt.push(ev), {
        onGuard: (ev) => sc.blocked.push(ev),
        onParry: (ev) => sc.parried.push(ev),
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

const hit = (damage: number, over: Partial<HitEvent> = {}): HitEvent => ({ attackerId: 0, targetId: 1, damage, knockback: 1, hitStop: 4, dirX: 0, dirZ: 1, x: 0, z: 0, ...over });

describe('岩鬼: 常時スーパーアーマーと体勢ゲージ', () => {
  it('追跡中・予備動作中・攻撃中のどれでも、ひるまない（ダメージと体勢だけが減る。ノックバックは小さい）', () => {
    const e = new Enemy(DEF, 1, 0, 8);
    e.place(0, 8, Math.PI);
    for (let i = 0; i < DEF.spawnIdleFrames + 2; i++) e.step(DT, 0, 0);
    expect(e.state).toBe('chase');
    const hp = e.health.hp;
    e.takeHit(hit(12));
    expect(e.state).toBe('chase');
    expect(e.health.hp).toBe(hp - 12);
    expect(e.poise!.value).toBe(DEF.poise.max - 12);
    expect(e.knockback.velZ).toBeLessThan(0.5);
    // 予備動作・攻撃中も同じ
    const sc = scene();
    sc.toWindup(10);
    sc.enemy.takeHit(hit(12));
    expect(sc.enemy.state).toBe('windup');
    while (sc.enemy.state !== 'attack') sc.step({ dodgePressed: false });
    sc.enemy.takeHit(hit(12));
    expect(sc.enemy.state).toBe('attack');
  });

  it('体勢が 0 になると、予備動作を中断して動けなくなる（stagger）。体勢崩しの回数は breakSerial、効果は POISE_BREAK', () => {
    const sc = scene();
    sc.toWindup(20);
    const e = sc.enemy;
    e.takeHit(hit(60));
    expect(e.state).toBe('windup');
    expect(e.breakSerial).toBe(0);
    e.takeHit(hit(20));
    expect(e.state).toBe('stagger');
    expect(e.breakSerial).toBe(1);
    expect(e.parryEffect).toBe(POISE_BREAK);
    expect(e.poise!.value).toBe(0);
    // 中断された: 予備動作が終わる時刻を過ぎても攻撃しない
    sc.run(ATK.windupFrames + ATK.startupFrames + 30);
    expect(sc.hurt).toHaveLength(0);
    expect(e.impactSerial).toBe(0);
  });

  it('崩れているあいだは何度当てても崩れ直さず、状態も変わらない。反撃の倍率（1.8）が掛かる', () => {
    const sc = scene();
    const e = sc.enemy;
    e.takeHit(hit(80));
    expect(e.state).toBe('stagger');
    expect(e.riposte).toBe(POISE_BREAK);
    e.takeHit(hit(30));
    expect(e.state).toBe('stagger');
    expect(e.breakSerial).toBe(1);
    // 本物のプレイヤーの攻撃: 反撃のダメージ倍率
    const lone = scene('sword', 1.8);
    lone.enemy.takeHit(hit(80));
    lone.step({ attackPressed: true });
    for (let i = 0; i < 40 && lone.dealt.length === 0; i++) lone.step();
    expect(lone.dealt).toHaveLength(1);
    expect(lone.dealt[0]!.riposte).toBe(true);
    // 攻撃の元のダメージ × 1.8
    expect(lone.dealt[0]!.damage).toBe(Math.round(lone.dealt[0]!.base * POISE_BREAK.riposteDamageScale));
    expect(lone.dealt[0]!.base).toBeGreaterThan(0);
  });

  it('崩れて 100f 経つと立て直し、体勢ゲージは満タンに戻って、すぐには攻撃しない（待ち 40f）', () => {
    const sc = scene('sword', 9);
    const e = sc.enemy;
    e.takeHit(hit(80));
    for (let i = 0; i < POISE_BREAK.frames; i++) e.step(DT, 0, 0);
    expect(e.state).toBe('stagger');
    e.step(DT, 0, 0);
    expect(e.state).toBe('chase');
    expect(e.poise!.value).toBe(DEF.poise.max);
  });

  it('当てるのをやめると、150f 後から体勢ゲージが戻っていく', () => {
    const e = new Enemy(DEF, 1, 0, 9);
    e.place(0, 9, Math.PI);
    e.takeHit(hit(50));
    for (let i = 0; i < DEF.poise.regenDelayFrames; i++) e.step(DT, 0, 0);
    expect(e.poise!.value).toBe(30);
    for (let i = 0; i < 100; i++) e.step(DT, 0, 0);
    expect(e.poise!.value).toBeGreaterThan(30 + 30);
  });

  it('とどめの一撃では崩れない（死ぬ）', () => {
    const e = new Enemy(DEF, 1, 0, 9);
    e.place(0, 9, Math.PI);
    const r = e.takeHit(hit(DEF.hp + 10));
    expect(r.killed).toBe(true);
    expect(e.state).toBe('dead');
    expect(e.breakSerial).toBe(0);
  });

  it('子鬼・猪・提灯は体勢ゲージを持たない', () => {
    for (const d of [ENEMIES.imp, ENEMIES.boar, ENEMIES.lantern]) expect(new Enemy(d, 1, 0, 5).poise).toBeNull();
  });
});

describe('岩鬼: 地ならし（全周・ガード不能）', () => {
  it('予備動作 64f のあと、立っていると当たる（ダメージ 32）。1 回の攻撃で 1 回だけ。床の演出の合図は 1 回', () => {
    const sc = scene();
    sc.run(ATK.windupFrames + DEF.spawnIdleFrames + ATK.startupFrames + ATK.activeFrames + 30);
    expect(sc.hurt).toHaveLength(1);
    expect(sc.hurt[0]!.damage).toBe(ATK.damage);
    expect(sc.enemy.impactSerial).toBe(1);
  });

  it('ガード不能: 盾で構えていても被弾する（ガード・パリィにならない）', () => {
    const sc = scene('sword-shield');
    sc.toWindup(ATK.windupFrames - 6);
    sc.step({ guardPressed: true, guardHeld: true });
    for (let i = 0; i < 60 && sc.hurt.length === 0; i++) sc.step({ guardHeld: true });
    expect(sc.hurt).toHaveLength(1);
    expect(sc.blocked).toHaveLength(0);
    expect(sc.parried).toHaveLength(0);
    expect(sc.player.health.hp).toBe(100 - ATK.damage);
  });

  it('ガード不能: パリィの受付の瞬間に当たっても弾けない（大剣でも）', () => {
    const sc = scene('greatsword');
    sc.toWindup(ATK.windupFrames - 2);
    sc.step({ guardPressed: true, guardHeld: true });
    for (let i = 0; i < 30 && sc.hurt.length === 0; i++) sc.step({ guardHeld: true });
    expect(sc.hurt).toHaveLength(1);
    expect(sc.parried).toHaveLength(0);
    expect(sc.enemy.state).not.toBe('stagger');
  });

  it('全周: 背中側（岩鬼の後ろ）にいても、届く距離（3.0m + 体の半径）なら当たる。外なら当たらない', () => {
    // 岩鬼は (0, 3) でプレイヤーの方（−Z）を向く。プレイヤーを岩鬼の後ろ（+Z 側）へ置く
    const inside = scene();
    inside.toWindup(ATK.windupFrames - 4);
    inside.player.body.z = 3 + 2.8;
    inside.run(40);
    expect(inside.hurt).toHaveLength(1);
    const outside = scene();
    outside.toWindup(ATK.windupFrames - 4);
    outside.player.body.z = 3 + 3.6;
    outside.player.yaw = 0;
    outside.run(40);
    expect(outside.hurt).toHaveLength(0);
  });

  it('円の外へ出れば避けられる（予備動作の前半に 1 秒歩いて離れる）', () => {
    const sc = scene();
    sc.toWindup(1);
    // スティック下（−Z）へ走って、岩鬼（+Z 側）から離れる。プレイヤーは岩鬼から 4m 以上になる
    sc.run(ATK.windupFrames - 1, { moveY: -1 });
    sc.run(40);
    expect(sc.hurt).toHaveLength(0);
    expect(sc.enemy.impactSerial).toBe(1); // 攻撃は空振りで出ている
  });

  it('ロール（無敵）でも避けられる。攻撃が始まる瞬間にロールすれば当たらない', () => {
    const sc = scene();
    sc.toWindup(ATK.windupFrames - 3);
    sc.step({ dodgePressed: true, moveY: -1 });
    sc.run(40);
    expect(sc.hurt).toHaveLength(0);
  });

  it('攻撃のあとは長い硬直（70f）。その間に当てれば、体勢が崩れる', () => {
    const sc = scene('greatsword', 1.9);
    // 先に一度、地ならしを誘う（ロールで避ける）
    sc.toWindup(ATK.windupFrames - 3);
    sc.step({ dodgePressed: true, moveY: -1 });
    while (sc.enemy.state !== 'chase' && sc.enemy.impactSerial < 1) sc.step();
    sc.enemy.takeHit(hit(75)); // 大剣の通常の斬り 2 発ぶんの体勢ダメージ
    expect(sc.enemy.poise!.value).toBeLessThanOrEqual(5);
    sc.enemy.takeHit(hit(10));
    expect(sc.enemy.state).toBe('stagger');
  });
});
