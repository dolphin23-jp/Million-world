import { describe, expect, it } from 'vitest';
import { Enemy, type EnemyState } from './enemy';
import { ENEMIES } from './data/enemies';
import type { HitEvent } from '../combat/hit';

const DT = 1 / 60;
const ATK = ENEMIES.imp.attack;
const hit = (over: Partial<HitEvent> = {}): HitEvent => ({
  attackerId: 0,
  targetId: 1,
  damage: 10,
  knockback: 0.6,
  hitStop: 4,
  dirX: 0,
  dirZ: 1,
  x: 0,
  z: 4.5,
  ...over,
});
/** 原点にいるプレイヤー（target）の方を向いて z = 5 に立つ敵 */
const make = (z = 5) => {
  const e = new Enemy(ENEMIES.imp, 1, 0, z);
  e.place(0, z, Math.PI);
  return e;
};
const run = (e: Enemy, frames: number, tx = 0, tz = 0, alive = true) => {
  for (let i = 0; i < frames; i++) e.step(DT, tx, tz, alive);
};
/** 状態が to になるまで進める。何フレームかかったかを返す（上限で諦める） */
const until = (e: Enemy, to: EnemyState, limit = 600, tx = 0, tz = 0): number => {
  for (let i = 0; i < limit; i++) {
    if (e.state === to) return i;
    e.step(DT, tx, tz);
  }
  throw new Error(`${to} にならなかった（いま ${e.state}）`);
};

describe('Enemy: 被弾・死亡', () => {
  it('被弾すると HP が減り、ひるみに入り、ノックバックの距離ぶん進む', () => {
    const e = make();
    const r = e.takeHit(hit({ damage: 10, knockback: 0.6, dirZ: -1 })); // プレイヤー側（-Z）へ押される
    expect(r).toEqual({ dealt: 10, killed: false });
    expect(e.health.hp).toBe(ENEMIES.imp.hp - 10);
    expect(e.state).toBe('hit');
    expect(e.hitSerial).toBe(1);
    run(e, ENEMIES.imp.knockbackFrames, 0, 0, false);
    expect(5 - e.body.z).toBeCloseTo(0.6, 6);
  });

  it('ひるみのフレームが終わると追跡に戻る', () => {
    const e = make();
    e.takeHit(hit());
    run(e, ENEMIES.imp.hitStunFrames);
    expect(e.state).toBe('hit');
    run(e, 1);
    expect(e.state).toBe('chase');
  });

  it('ひるみ中にもう一度当たると、ひるみがやり直しになる', () => {
    const e = make();
    e.takeHit(hit());
    run(e, 15);
    e.takeHit(hit());
    expect(e.stateFrame).toBe(0);
    expect(e.hitSerial).toBe(2);
    run(e, ENEMIES.imp.hitStunFrames);
    expect(e.state).toBe('hit');
  });

  it('HP が 0 になると死亡し、無敵になり、演出のあと removable になる', () => {
    const e = make();
    const r = e.takeHit(hit({ damage: 999 }));
    expect(r.killed).toBe(true);
    expect(r.dealt).toBe(ENEMIES.imp.hp);
    expect(e.dead).toBe(true);
    expect(e.body.invulnerable).toBe(true);
    run(e, ENEMIES.imp.deathFrames);
    expect(e.removable).toBe(false);
    run(e, 1);
    expect(e.removable).toBe(true);
  });

  it('死亡後の被弾はダメージにならず、状態も変わらない', () => {
    const e = make();
    e.takeHit(hit({ damage: 999 }));
    const serial = e.hitSerial;
    const r = e.takeHit(hit());
    expect(r).toEqual({ dealt: 0, killed: false });
    expect(e.hitSerial).toBe(serial);
    expect(e.dead).toBe(true);
  });
});

describe('Enemy: 追跡', () => {
  it('出現直後は spawnIdleFrames のあいだ待ち、プレイヤーの方へ向き直る（旋回速度で）', () => {
    const e = make();
    e.place(0, 5, 0); // 背を向けている
    run(e, 1);
    expect(Math.abs(e.yaw)).toBeCloseTo(ENEMIES.imp.turnSpeed * DT, 6);
    expect(e.state).toBe('idle');
    run(e, ENEMIES.imp.spawnIdleFrames - 1);
    expect(e.state).toBe('idle');
    run(e, 1);
    expect(e.state).toBe('chase');
  });

  it('追跡は moveSpeed でプレイヤーへ近づき、stopDistance で止まる', () => {
    const e = make();
    until(e, 'chase');
    const z0 = e.body.z;
    run(e, 60);
    // 向き直りが済んでいるので、1 秒でほぼ moveSpeed ぶん進む
    expect(z0 - e.body.z).toBeGreaterThan(ENEMIES.imp.moveSpeed * 0.9);
    expect(z0 - e.body.z).toBeLessThanOrEqual(ENEMIES.imp.moveSpeed + 1e-6);
    // 十分長く追っても、攻撃（踏み込み）を除けば stopDistance より近づかない
    const e2 = make(3);
    until(e2, 'chase');
    run(e2, 10);
    expect(e2.body.z).toBeGreaterThanOrEqual(ENEMIES.imp.stopDistance - 1e-6);
  });

  it('プレイヤーが aggroRange の外にいるあいだは追わない', () => {
    const e = make(ENEMIES.imp.aggroRange + 5);
    run(e, ENEMIES.imp.spawnIdleFrames + 60);
    expect(e.state).toBe('idle');
  });

  it('プレイヤーが倒れたら、追跡も予備動作もやめて待機に戻る', () => {
    const e = make();
    until(e, 'chase');
    run(e, 5, 0, 0, false);
    expect(e.state).toBe('idle');
    const z = e.body.z;
    run(e, 120, 0, 0, false);
    expect(e.state).toBe('idle');
    expect(e.body.z).toBeCloseTo(z, 6);
  });
});

describe('Enemy: 攻撃（予備動作 → 攻撃 → 硬直）', () => {
  /** 攻撃の距離（range）に入った位置から始める */
  const inRange = () => {
    const e = make(ATK.range - 0.1);
    e.place(0, ATK.range - 0.1, Math.PI);
    until(e, 'windup');
    return e;
  };

  it('攻撃の距離に入ると予備動作（windup）に入り、windupFrames のあと攻撃に移る', () => {
    const e = inRange();
    expect(e.stateFrame).toBe(1);
    const n = until(e, 'attack');
    // windup の描画フレームは stateFrame 1〜windupFrames の windupFrames 枚。入った step のあと windupFrames 回の step で attack に移る
    expect(n).toBe(ATK.windupFrames);
  });

  it('予備動作の前半はプレイヤーを追って向き、後半は向きを固定する（横へ動けば当たらない）', () => {
    const e = inRange();
    // プレイヤーが敵の真後ろ（半周ぶん）へ回り込む。旋回は 5rad/s なので、固定のしきい（20f）まででは向き直りきらない
    const px = 0;
    const pz = e.body.z + 3;
    const half = Math.PI / (ENEMIES.imp.turnSpeed / 60);
    expect(half).toBeGreaterThan(ATK.windupTrackFrames + 8); // 固定のしきいのあとも回り続けるはずの配置（固定しなければ向きが変わる）
    let prev = e.yaw;
    // 固定前: 毎フレーム向きが変わる
    while (e.stateFrame < ATK.windupTrackFrames - 1) {
      e.step(DT, px, pz);
      expect(e.yaw).not.toBeCloseTo(prev, 9);
      prev = e.yaw;
    }
    // しきいを越えたら、攻撃に入るまで向きは動かない
    e.step(DT, px, pz);
    e.step(DT, px, pz);
    const locked = e.yaw;
    while (e.state === 'windup') {
      e.step(DT, px, pz);
      if (e.state === 'windup') expect(e.yaw).toBeCloseTo(locked, 9);
    }
    expect(e.state).toBe('attack');
    expect(e.yaw).toBeCloseTo(locked, 9);
  });

  it('攻撃に入ってから startup のあと active フレームだけ判定が出る（attackActive）', () => {
    const e = inRange();
    until(e, 'attack');
    const flags: boolean[] = [];
    for (let i = 0; i < ATK.startupFrames + ATK.activeFrames + ATK.recoverFrames + 2; i++) {
      flags.push(e.attackActive);
      e.step(DT, 0, 0);
    }
    // attack に入った直後（step 後）が stateFrame = 1。判定は stateFrame が startup 以上 startup + active 未満
    const first = flags.indexOf(true);
    expect(flags.filter(Boolean).length).toBe(ATK.activeFrames);
    expect(first).toBe(ATK.startupFrames - 1);
  });

  it('判定が出ているあいだ、向いている方向へ lunge ぶん踏み込む', () => {
    const e = inRange();
    until(e, 'attack');
    const z0 = e.body.z;
    run(e, ATK.startupFrames + ATK.activeFrames + ATK.recoverFrames);
    // 踏み込んだ分だけ前進（-Z 向き）。硬直中は止まり、ノックバックは無い
    expect(z0 - e.body.z).toBeCloseTo(ATK.lunge, 6);
  });

  it('攻撃が終わると cooldownFrames のあいだ次の予備動作に入らない', () => {
    const e = inRange();
    until(e, 'attack');
    until(e, 'chase');
    // プレイヤーが近いまま。待ちが明けるまで windup に入らない
    let waited = 0;
    while (e.state === 'chase' && waited < 200) {
      e.step(DT, 0, e.body.z - 1.2);
      waited++;
    }
    expect(e.state).toBe('windup');
    expect(waited).toBeGreaterThanOrEqual(ATK.cooldownFrames - 1);
  });

  it('予備動作の前半（armorFromFrame 前）で被弾すると中断され、ひるみになる（そのあと追跡へ）', () => {
    const e = inRange();
    run(e, 5);
    expect(e.state).toBe('windup');
    expect(e.stateFrame).toBeLessThan(ATK.armorFromFrame);
    expect(e.armored).toBe(false);
    e.takeHit(hit({ damage: 1, knockback: 0 }));
    expect(e.state).toBe('hit');
    expect(e.attackActive).toBe(false);
    until(e, 'chase');
  });

  it('スーパーアーマー: 予備動作の後半と攻撃中は、弱い攻撃でひるまず（ダメージは通る）、ノックバックは小さい', () => {
    const e = inRange();
    run(e, ATK.armorFromFrame); // stateFrame = armorFromFrame + 1 になる
    expect(e.state).toBe('windup');
    expect(e.armored).toBe(true);
    const z0 = e.body.z;
    const r = e.takeHit(hit({ damage: 10, knockback: 1, dirZ: 1 }));
    expect(r.dealt).toBe(10);
    expect(e.state).toBe('windup'); // 中断されない
    expect(e.hitSerial).toBe(1); // 見た目のフラッシュは出る
    run(e, ENEMIES.imp.knockbackFrames);
    expect(e.body.z - z0).toBeCloseTo(1 * ENEMIES.imp.knockbackScale * ATK.armorKnockbackScale, 6);
    // 攻撃中も同じ
    until(e, 'attack');
    expect(e.armored).toBe(true);
    e.takeHit(hit({ damage: 10, knockback: 0 }));
    expect(e.state).toBe('attack');
    expect(e.attackActive || e.stateFrame < ATK.startupFrames).toBe(true);
  });

  it('重撃（armorBreakDamage 以上）はスーパーアーマーを割って、予備動作でも攻撃中でも中断してひるませる', () => {
    const e = inRange();
    run(e, ATK.armorFromFrame + 2);
    expect(e.armored).toBe(true);
    e.takeHit(hit({ damage: ATK.armorBreakDamage, knockback: 0 }));
    expect(e.state).toBe('hit');

    const f = inRange();
    until(f, 'attack');
    f.takeHit(hit({ damage: ATK.armorBreakDamage + 4, knockback: 0 }));
    expect(f.state).toBe('hit');
    expect(f.attackActive).toBe(false);
  });

  it('スーパーアーマー中でも、HP が 0 になる攻撃では倒れる', () => {
    const e = inRange();
    until(e, 'attack');
    e.health.hp = 5;
    const r = e.takeHit(hit({ damage: 10, knockback: 0 }));
    expect(r.killed).toBe(true);
    expect(e.dead).toBe(true);
  });

  it('攻撃に入るたびに命中の記録（hitTracker）がリセットされる', () => {
    const e = inRange();
    e.hitTracker.add(0);
    until(e, 'attack');
    expect(e.hitTracker.has(0)).toBe(false);
  });
});
