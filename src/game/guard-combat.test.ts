import { describe, expect, it } from 'vitest';
import { Player } from './player';
import { resolveEnemyAttacks, resolvePlayerAttack, type CombatTarget } from './combat';
import { Enemy } from '../ai/enemy';
import { ENEMIES } from '../ai/data/enemies';
import { ATTACKS, PLAYER_STATS } from '../combat/data/attacks';
import { GUARDS, PARRY } from '../combat/data/guard';
import { createEmptyIntent, type InputIntent } from '../input/intent';
import type { HitEvent } from '../combat/hit';
import type { DamageResult } from '../combat/health';

/**
 * ガード・パリィ・反撃（ADR-020）の結合テスト: 本物の Player と Enemy を Game.step と同じ順序で 1 フレームずつ進める。
 * カメラ yaw = π のとき、スティックの上は +Z。敵は +Z 側（既定 1.7m）でプレイヤーのほうを向く。
 */
const DT = 1 / 60;
const CAM_YAW = Math.PI;
const ATK = ENEMIES.imp.attack;

interface Scene {
  player: Player;
  enemy: Enemy;
  blocked: { ev: HitEvent; result: DamageResult }[];
  parried: HitEvent[];
  hurt: HitEvent[];
  /** プレイヤーの攻撃が当たった（riposte = 弾かれた敵への反撃） */
  dealt: { ev: HitEvent; result: DamageResult; riposte: boolean }[];
  step(over?: Partial<InputIntent>): void;
  run(n: number, over?: Partial<InputIntent>): void;
  until(pred: () => boolean, limit?: number, over?: Partial<InputIntent>): number;
}

function scene(loadout: 'sword' | 'sword-shield', enemyZ = 1.7, enemyYaw = Math.PI): Scene {
  const player = new Player();
  player.equip(loadout);
  const enemy = new Enemy(ENEMIES.imp, 1, 0, enemyZ);
  enemy.place(0, enemyZ, enemyYaw);
  const sc: Scene = {
    player,
    enemy,
    blocked: [],
    parried: [],
    hurt: [],
    dealt: [],
    step(over = {}) {
      player.step(DT, { ...createEmptyIntent(), ...over }, CAM_YAW);
      enemy.step(DT, player.body.x, player.body.z, !player.dead);
      resolvePlayerAttack(player, [enemy as CombatTarget], (ev, _t, result, riposte) => sc.dealt.push({ ev, result, riposte }));
      resolveEnemyAttacks([enemy], player, (ev) => sc.hurt.push(ev), {
        onGuard: (ev, _e, result) => sc.blocked.push({ ev, result }),
        onParry: (ev) => sc.parried.push(ev),
      });
    },
    run(n, over) {
      for (let i = 0; i < n; i++) sc.step(over);
    },
    until(pred, limit = 600, over) {
      for (let i = 0; i < limit; i++) {
        if (pred()) return i;
        sc.step(over);
      }
      throw new Error('条件が満たされなかった');
    },
  };
  return sc;
}

/** 敵の予備動作が stateFrame に達するまで進めて、ガードを押す（以降は押し続ける） */
function guardAt(sc: Scene, windupFrame: number): void {
  sc.until(() => sc.enemy.state === 'windup' && sc.enemy.stateFrame >= windupFrame);
  sc.step({ guardPressed: true, guardHeld: true });
}

describe('ガードで受け止める', () => {
  it('盾: 構えを早めに上げておくと、攻撃は受け止められる（削りだけ通る）。敵は体勢を崩さず、攻撃を続ける', () => {
    const sc = scene('sword-shield');
    guardAt(sc, 8);
    sc.until(() => sc.blocked.length > 0, 120, { guardHeld: true });
    expect(sc.blocked).toHaveLength(1);
    expect(sc.blocked[0]!.result.dealt).toBe(2);
    expect(sc.player.health.hp).toBe(PLAYER_STATS.maxHp - 2);
    expect(sc.hurt).toHaveLength(0);
    expect(sc.parried).toHaveLength(0);
    expect(sc.player.state).toBe('guard');
    expect(sc.enemy.state).toBe('attack');
    // 1 回の攻撃は 1 回しか当たらない（持続のあいだ受け止め続けない）
    sc.run(60, { guardHeld: true });
    expect(sc.blocked).toHaveLength(1);
    expect(sc.player.guardHitSerial).toBe(1);
  });

  it('素手: 剣で受ける。軽減は盾より小さく、パリィの受付の時刻に押してもただのガード（敵は崩れない）', () => {
    const sc = scene('sword');
    guardAt(sc, 35);
    sc.until(() => sc.blocked.length > 0 || sc.parried.length > 0, 120, { guardHeld: true });
    expect(sc.parried).toHaveLength(0);
    expect(sc.blocked).toHaveLength(1);
    expect(sc.blocked[0]!.result.dealt).toBe(Math.round(ATK.damage * (1 - GUARDS.sword.damageReduction)));
    expect(sc.player.health.hp).toBe(PLAYER_STATS.maxHp - 6);
    expect(sc.enemy.state).toBe('attack');
    expect(sc.enemy.vulnerable).toBe(false);
  });

  it('構えの外（背後）から来る攻撃は防げず、通常の被弾になる', () => {
    // 敵はプレイヤーの背後（−Z）。プレイヤーは +Z を向いて構えている
    const sc = scene('sword-shield', -1.7, 0);
    sc.player.setAim(null);
    sc.until(() => sc.enemy.state === 'windup' && sc.enemy.stateFrame >= 8);
    sc.step({ guardPressed: true, guardHeld: true });
    sc.until(() => sc.hurt.length > 0 || sc.blocked.length > 0, 200, { guardHeld: true });
    expect(sc.blocked).toHaveLength(0);
    expect(sc.hurt).toHaveLength(1);
    expect(sc.player.health.hp).toBe(PLAYER_STATS.maxHp - ATK.damage);
    expect(sc.player.state).toBe('hit');
    expect(sc.player.guard).toBeNull();
  });

  it('構えていなければ、これまでどおり被弾する', () => {
    const sc = scene('sword-shield');
    sc.until(() => sc.hurt.length > 0, 200);
    expect(sc.hurt).toHaveLength(1);
    expect(sc.player.health.hp).toBe(PLAYER_STATS.maxHp - ATK.damage);
  });
});

describe('パリィで弾く', () => {
  it('盾: 攻撃の直前に押すとパリィ。ダメージなし、敵は体勢を崩し（stagger）、押し戻される', () => {
    const sc = scene('sword-shield');
    guardAt(sc, 35);
    const z0 = sc.enemy.body.z;
    sc.until(() => sc.parried.length > 0 || sc.blocked.length > 0 || sc.hurt.length > 0, 120, { guardHeld: true });
    expect(sc.parried).toHaveLength(1);
    expect(sc.blocked).toHaveLength(0);
    expect(sc.hurt).toHaveLength(0);
    expect(sc.player.health.hp).toBe(PLAYER_STATS.maxHp);
    expect(sc.player.parrySerial).toBe(1);
    expect(sc.enemy.state).toBe('stagger');
    expect(sc.enemy.vulnerable).toBe(true);
    expect(sc.enemy.attackActive).toBe(false);
    expect(sc.enemy.parrySerial).toBe(1);
    sc.run(14, { guardHeld: true });
    expect(sc.enemy.body.z).toBeGreaterThan(z0); // プレイヤーから離れる向きへ
    // 弾いたあとも構えのまま。攻撃は 1 回しか数えない
    expect(sc.player.state).toBe('guard');
    expect(sc.parried).toHaveLength(1);
  });

  it('早すぎる・遅すぎる押下では弾けない（受付は parryFrames）。早い押下はガード、攻撃が先に当たれば被弾', () => {
    // 早すぎ: 受付が終わってから攻撃が来る → ガード
    const early = scene('sword-shield');
    guardAt(early, 20);
    early.until(() => early.parried.length + early.blocked.length + early.hurt.length > 0, 120, { guardHeld: true });
    expect(early.parried).toHaveLength(0);
    expect(early.blocked).toHaveLength(1);
    // 遅すぎ: 攻撃が当たってから押す → 被弾
    const late = scene('sword-shield');
    late.until(() => late.hurt.length > 0, 200);
    late.step({ guardPressed: true, guardHeld: true });
    expect(late.parried).toHaveLength(0);
    expect(late.hurt).toHaveLength(1);
  });

  it('パリィの受付の境界: 攻撃が当たる step が構えに入ってから parryFrames 目までなら弾け、次の step ならガード', () => {
    // 敵の攻撃が当たる step を先に調べ、その step の parryFrames 前（= 受付の最後）と 1 つ前に押した場合を比べる
    const probe = scene('sword-shield');
    let hitStep = -1;
    for (let i = 0; i < 400 && hitStep < 0; i++) {
      probe.step();
      if (probe.hurt.length > 0) hitStep = i;
    }
    expect(hitStep).toBeGreaterThan(PARRY.staggerFrames * 0);
    const g = GUARDS.shield;
    const outcomeWhenPressedAt = (pressStep: number) => {
      const sc = scene('sword-shield');
      sc.run(pressStep);
      sc.step({ guardPressed: true, guardHeld: true });
      sc.until(() => sc.parried.length + sc.blocked.length + sc.hurt.length > 0, 120, { guardHeld: true });
      return sc.parried.length ? 'parry' : sc.blocked.length ? 'guard' : 'hurt';
    };
    // 押した step が frame 1。当たる step が frame parryFrames なら、押した step = hitStep − (parryFrames − 1)
    expect(outcomeWhenPressedAt(hitStep - (g.parryFrames - 1))).toBe('parry');
    expect(outcomeWhenPressedAt(hitStep - g.parryFrames)).toBe('guard');
  });

  it('弾かれた敵は PARRY.staggerFrames のあいだ動けず、そのあと追い始める。すぐには攻撃してこない', () => {
    const sc = scene('sword-shield');
    guardAt(sc, 35);
    sc.until(() => sc.parried.length > 0, 120, { guardHeld: true });
    const frames = sc.enemy.stateFrame;
    sc.run(PARRY.staggerFrames - frames - 1, { guardHeld: true });
    expect(sc.enemy.state).toBe('stagger');
    sc.run(2, { guardHeld: true });
    expect(sc.enemy.state).toBe('chase');
    // 立て直してから recoverCooldownFrames は予備動作に入らない
    for (let i = 0; i < PARRY.recoverCooldownFrames - 1; i++) {
      sc.step({ guardHeld: true });
      expect(sc.enemy.state, `+${i}`).not.toBe('windup');
    }
  });

  it('回避の無敵のあいだは敵の攻撃が当たらず、防御の判定（ガード・パリィ）にも入らない', () => {
    const sc = scene('sword-shield');
    sc.until(() => sc.enemy.state === 'windup' && sc.enemy.stateFrame >= 30);
    sc.step({ dodgePressed: true, moveX: -1, moveY: 0 }); // ロール（無敵つき）
    sc.until(() => sc.enemy.state !== 'windup' && sc.enemy.state !== 'attack', 120);
    expect(sc.hurt).toHaveLength(0);
    expect(sc.parried).toHaveLength(0);
    expect(sc.blocked).toHaveLength(0);
  });
});

describe('反撃（弾かれた敵への攻撃）', () => {
  /** 盾でパリィして、構えのまま 1 段目を出す準備ができた状態 */
  function parried(): Scene {
    const sc = scene('sword-shield');
    guardAt(sc, 35);
    sc.until(() => sc.parried.length > 0, 120, { guardHeld: true });
    return sc;
  }
  const combo1 = ATTACKS.combo1!;

  it('弾かれて体勢を崩しているあいだに当てた攻撃は、ダメージが倍率で増え、ノックバックは減る', () => {
    const sc = parried();
    sc.run(GUARDS.shield.cancelFrame, { guardHeld: true });
    sc.step({ guardHeld: true, attackPressed: true });
    expect(sc.player.state).toBe('attack');
    // 敵は離れているので、距離を詰めてから当てる
    sc.enemy.body.z = sc.player.body.z + 1.4;
    sc.until(() => sc.dealt.length > 0, 60);
    const d = sc.dealt[0]!;
    expect(d.riposte).toBe(true);
    expect(d.ev.damage).toBe(Math.round(combo1.damage * PARRY.riposteDamageScale));
    expect(d.ev.knockback).toBeCloseTo(combo1.knockback * PARRY.riposteKnockbackScale, 9);
    expect(d.result.dealt).toBe(d.ev.damage);
    expect(sc.enemy.health.hp).toBe(ENEMIES.imp.hp - d.ev.damage);
  });

  it('反撃が当たっても敵は崩れたまま（ひるみに上書きされない）。続けて当てた次の攻撃も反撃になる', () => {
    const sc = parried();
    sc.run(GUARDS.shield.cancelFrame, { guardHeld: true });
    sc.step({ guardHeld: true, attackPressed: true });
    sc.enemy.body.z = sc.player.body.z + 1.4;
    sc.until(() => sc.dealt.length > 0, 60);
    expect(sc.enemy.state).toBe('stagger');
    // 2 段目: 受付に入ったら次を押す
    sc.until(() => sc.player.attackFrames !== null && sc.player.stateFrame >= sc.player.attackFrames.cancelFrame, 60);
    sc.step({ attackPressed: true });
    sc.enemy.body.z = sc.player.body.z + 1.4;
    sc.until(() => sc.dealt.length > 1, 60);
    expect(sc.dealt[1]!.riposte).toBe(true);
    expect(sc.dealt[1]!.ev.damage).toBe(Math.round(ATTACKS.combo2!.damage * PARRY.riposteDamageScale));
  });

  it('崩れていない敵（ふつうのひるみ・攻撃前）への攻撃は反撃にならない', () => {
    const sc = scene('sword-shield', 1.5);
    sc.step({ attackPressed: true });
    sc.until(() => sc.dealt.length > 0, 60);
    expect(sc.dealt[0]!.riposte).toBe(false);
    expect(sc.dealt[0]!.ev.damage).toBe(combo1.damage);
    expect(sc.enemy.state).toBe('hit');
  });

  it('体勢が戻ったあとの攻撃は、ふつうのダメージに戻る', () => {
    const sc = parried();
    sc.run(PARRY.staggerFrames + 2, { guardHeld: true });
    expect(sc.enemy.vulnerable).toBe(false);
    sc.enemy.body.z = sc.player.body.z + 1.4;
    sc.step({ guardHeld: true, attackPressed: true });
    sc.enemy.body.z = sc.player.body.z + 1.4;
    sc.until(() => sc.dealt.length > 0, 60);
    expect(sc.dealt[0]!.riposte).toBe(false);
    expect(sc.dealt[0]!.ev.damage).toBe(combo1.damage);
  });
});
