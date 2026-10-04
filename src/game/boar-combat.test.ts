import { describe, expect, it } from 'vitest';
import { Player } from './player';
import { resolveEnemyAttacks, resolvePlayerAttack, type CombatTarget } from './combat';
import { Enemy } from '../ai/enemy';
import { ENEMIES } from '../ai/data/enemies';
import { PARRY_EFFECTS } from '../combat/data/guard';
import { createEmptyIntent, type InputIntent } from '../input/intent';
import type { HitEvent } from '../combat/hit';
import type { LoadoutId } from '../combat/data/loadouts';

/**
 * 暴れ猪（突進型。ADR-025）と本物の Player の結合テスト。Game.step と同じ順序で 1 フレームずつ進める。
 * カメラ yaw = π のとき、スティックの上は +Z、右は −X、左は +X。猪は (0, z) に置いてプレイヤー（原点）の方を向く。
 */
const DT = 1 / 60;
const CAM_YAW = Math.PI;
const ATK = ENEMIES.boar.attack;

interface Scene {
  player: Player;
  enemy: Enemy;
  hurt: HitEvent[];
  parried: HitEvent[];
  blocked: HitEvent[];
  step(over?: Partial<InputIntent>): void;
  run(n: number, over?: Partial<InputIntent>): void;
  /** 猪が予備動作の frame に達するまで進める */
  toWindup(frame: number): void;
}

function scene(z = 6.5, loadout: LoadoutId = 'sword'): Scene {
  const player = new Player();
  player.equip(loadout);
  const enemy = new Enemy(ENEMIES.boar, 1, 0, z);
  enemy.place(0, z, Math.PI);
  const sc: Scene = {
    player,
    enemy,
    hurt: [],
    parried: [],
    blocked: [],
    step(over = {}) {
      player.step(DT, { ...createEmptyIntent(), ...over }, CAM_YAW);
      enemy.step(DT, player.body.x, player.body.z, !player.dead);
      resolvePlayerAttack(player, [enemy as CombatTarget], () => undefined);
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

describe('暴れ猪（突進型）', () => {
  it('遠くから予備動作に入り、向きを固定して一直線に踏み込む（距離は lunge。通り過ぎる）', () => {
    const sc = scene(6.5);
    sc.toWindup(1);
    expect(sc.enemy.body.z).toBeGreaterThan(6.4); // 出現直後の待ちのあとすぐ（7m 以内なので歩かない）
    while (sc.enemy.state === 'windup') sc.step({ moveX: 1 }); // プレイヤーは横へ動いて避ける
    expect(sc.enemy.state).toBe('attack');
    const z0 = sc.enemy.body.z;
    const x0 = sc.enemy.body.x;
    const yaw0 = sc.enemy.yaw;
    while (sc.enemy.state === 'attack' && sc.enemy.stateFrame < ATK.startupFrames + ATK.activeFrames + 1) sc.step({ moveX: 1 });
    // 突進した距離 = lunge（6m）。向きは固定（突進のあいだ横へ動いたプレイヤーを追わない）
    const dx = sc.enemy.body.x - x0;
    const dz = sc.enemy.body.z - z0;
    expect(Math.hypot(dx, dz)).toBeGreaterThan(ATK.lunge - 0.4);
    expect(Math.hypot(dx, dz)).toBeLessThan(ATK.lunge + 0.4);
    expect(Math.atan2(dx, dz)).toBeCloseTo(yaw0, 1);
  });

  it('立ち止まっていると当たる（ダメージ 20）。1 回の突進で 1 回だけ', () => {
    const sc = scene(6.5);
    sc.run(240);
    expect(sc.hurt).toHaveLength(1);
    expect(sc.hurt[0]!.damage).toBe(ATK.damage);
    expect(sc.player.health.hp).toBe(100 - ATK.damage);
  });

  it('向きが固定されたあとに、帯（幅 2.1m）の外へ横に動けば当たらない。猪は通り過ぎて、長い硬直をさらす', () => {
    const sc = scene(6.5);
    sc.toWindup(ATK.windupTrackFrames + 1);
    // 帯の外（横へ 1.5m 以上）へ動く。走り 4.8m/s ≒ 0.08m/f なので 20f で 1.6m
    sc.run(24, { moveX: 1 });
    expect(Math.abs(sc.player.body.x)).toBeGreaterThan(1.4);
    while (sc.enemy.state !== 'chase' && sc.hurt.length === 0) sc.step();
    expect(sc.hurt).toHaveLength(0);
    // 突進のあと、猪はプレイヤーの後ろ（z < 0）まで抜けている。硬直（recoverFrames）のあいだ次の予備動作に入らない
    expect(sc.enemy.body.z).toBeLessThan(0.6);
  });

  it('ロール（無敵）でも避けられる。突進が始まって猪が近づいたところで横へ転がれば当たらない', () => {
    const near = scene(6.5);
    near.toWindup(ATK.windupFrames);
    // 突進が始まって、猪が 3m 以内に来たところでロール（無敵 3〜22f のうちに接触する）
    while (near.enemy.body.z - near.player.body.z > 3 && near.hurt.length === 0) near.step();
    near.step({ dodgePressed: true, moveX: 1 });
    near.run(40);
    expect(near.hurt).toHaveLength(0);
  });

  it('盾のパリィ: 突進が当たる瞬間に弾くと、猪は体勢を崩して止まる（ダメージなし）', () => {
    const sc = scene(6.5, 'sword-shield');
    sc.toWindup(ATK.windupFrames);
    // 突進が始まる。猪が目の前に来る少し前にガードを上げる（盾の受付 10f）
    for (let i = 0; i < 60 && sc.enemy.body.z > 2.9; i++) sc.step();
    sc.step({ guardPressed: true, guardHeld: true });
    for (let i = 0; i < 40 && sc.parried.length === 0 && sc.hurt.length === 0 && sc.blocked.length === 0; i++) sc.step({ guardHeld: true });
    expect(sc.parried).toHaveLength(1);
    expect(sc.hurt).toHaveLength(0);
    expect(sc.player.health.hp).toBe(100);
    expect(sc.enemy.state).toBe(PARRY_EFFECTS.stagger.id);
  });

  it('スーパーアーマー: 突進中は弱い攻撃で止まらない。重撃（34 以上）は割り込める', () => {
    const sc = scene(6.5);
    sc.toWindup(ATK.windupFrames);
    while (sc.enemy.state !== 'attack') sc.step({ moveX: 1 });
    sc.step({ moveX: 1 });
    const weak = { attackerId: 0, targetId: 1, damage: 12, knockback: 1, hitStop: 4, dirX: 0, dirZ: -1, x: 0, z: 0 };
    sc.enemy.takeHit(weak);
    expect(sc.enemy.state).toBe('attack');
    sc.enemy.takeHit({ ...weak, damage: 38 });
    expect(sc.enemy.state).toBe('hit');
  });
});
