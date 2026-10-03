import { describe, expect, it } from 'vitest';
import { Player } from './player';
import { resolvePlayerAttack, type CombatTarget } from './combat';
import { Enemy } from '../ai/enemy';
import { ENEMIES } from '../ai/data/enemies';
import { ATTACKS, DODGE, resolveAttack } from '../combat/data/attacks';
import { createEmptyIntent, type InputIntent } from '../input/intent';
import type { DamageResult } from '../combat/health';
import type { HitEvent } from '../combat/hit';

/**
 * プレイヤー（本物の Player の sim）と敵（本物の Enemy の sim）を組み合わせ、Game.step と同じ順序で 1 フレームずつ進める。
 * 見た目（GLB）は無くても sim は動く。カメラの yaw = π のとき、スティックの上は +Z 方向。
 */

const DT = 1 / 60;
const CAM_YAW = Math.PI;

interface Hit {
  frame: number;
  ev: HitEvent;
  result: DamageResult;
}

function setup(enemyZ = 1.6) {
  const player = new Player();
  const enemy = new Enemy(ENEMIES.imp, 1, 0, enemyZ);
  enemy.place(0, enemyZ, Math.PI);
  const hits: Hit[] = [];
  let frame = 0;
  const step = (over: Partial<InputIntent> = {}) => {
    const intent = { ...createEmptyIntent(), ...over };
    player.step(DT, intent, CAM_YAW);
    enemy.step(DT, player.body.x, player.body.z);
    resolvePlayerAttack(player, [enemy as CombatTarget], (ev, _t, result) => hits.push({ frame, ev, result }));
    frame++;
  };
  const run = (n: number, over: Partial<InputIntent> = {}) => {
    for (let i = 0; i < n; i++) step(over);
  };
  return { player, enemy, hits, step, run };
}

describe('プレイヤーの攻撃が敵に当たる（Player + Enemy の結合）', () => {
  it('1 段目: 持続フレームの中で 1 回だけ当たり、ダメージ・ひるみ・ノックバックが入る', () => {
    const { player, enemy, hits, step, run } = setup();
    step({ attackPressed: true });
    run(80);
    expect(hits).toHaveLength(1);
    const fr = resolveAttack(ATTACKS.combo1!);
    // 攻撃開始のステップが frame 0。持続フレーム（開始から startup 〜 startup + active）の中で当たる
    expect(hits[0]!.frame + 1).toBeGreaterThanOrEqual(fr.startup);
    expect(hits[0]!.frame + 1).toBeLessThan(fr.startup + fr.active);
    expect(hits[0]!.result.dealt).toBe(ATTACKS.combo1!.damage);
    expect(enemy.health.hp).toBe(ENEMIES.imp.hp - ATTACKS.combo1!.damage);
    expect(enemy.body.z).toBeGreaterThan(1.6); // 奥へ押された
    expect(player.state).toBe('idle');
  });

  it('持続フレームが 1 つ以上あっても 1 つの攻撃は 1 回しか当たらない（全フレームを通して）', () => {
    const { hits, step, run } = setup();
    step({ attackPressed: true });
    run(80);
    const total = hits.filter((h) => h.ev.damage === ATTACKS.combo1!.damage).length;
    expect(total).toBe(1);
  });

  it('届かない距離の敵には当たらない', () => {
    const { hits, enemy, step, run } = setup(6);
    step({ attackPressed: true });
    run(80);
    expect(hits).toHaveLength(0);
    expect(enemy.health.hp).toBe(ENEMIES.imp.hp);
  });

  it('背後の敵には当たらない', () => {
    const { hits, step, run } = setup(-1.6);
    step({ attackPressed: true });
    run(80);
    expect(hits).toHaveLength(0);
  });

  it('3 連コンボの各段がそれぞれ 1 回ずつ当たる（段が変わると記録がリセットされる）', () => {
    const { player, enemy, hits, step, run } = setup(1.5);
    step({ attackPressed: true });
    // 各段の受付フレームに先行入力して次段へつなぐ。敵はノックバックで離れるので、毎フレームスティックで前へ詰める代わりに、
    // 敵を元の距離へ戻して 3 段とも当たる条件にそろえる（当たり判定の「段ごとのリセット」を見るテスト）
    const seen: string[] = [];
    for (let i = 0; i < 200 && hits.length < 3; i++) {
      const id = player.attack?.id;
      if (id && seen[seen.length - 1] !== id) seen.push(id);
      // 受付に入ったら次を押す。敵が離れていたら寄せ直す
      const fr = player.attackFrames;
      const press = fr !== null && player.stateFrame >= fr.cancelFrame;
      if (enemy.body.z - player.body.z > 1.8) enemy.body.z = player.body.z + 1.5;
      step(press ? { attackPressed: true } : {});
    }
    run(80);
    expect(seen).toEqual(['combo1', 'combo2', 'combo3']);
    expect(hits.map((h) => h.ev.damage)).toEqual([ATTACKS.combo1!.damage, ATTACKS.combo2!.damage, ATTACKS.combo3!.damage]);
  });

  it('重撃は大きなダメージを与える', () => {
    const { hits, step, run } = setup(1.7);
    step({ heavyPressed: true });
    run(90);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.ev.damage).toBe(ATTACKS.heavy!.damage);
  });

  it('HP が 0 になる攻撃で倒れ、そのあとの攻撃はダメージにならない', () => {
    const { enemy, hits, step, run } = setup(1.7);
    enemy.health.hp = 5;
    step({ heavyPressed: true });
    run(90);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.result.killed).toBe(true);
    expect(enemy.dead).toBe(true);
    expect(enemy.health.hp).toBe(0);
  });

  it('回避中は攻撃の判定を出さない', () => {
    const { player, hits, step, run } = setup(1.2);
    step({ dodgePressed: true, moveX: 0, moveY: 1 });
    expect(player.state).toBe('dodge');
    run(DODGE.frames + 5);
    expect(hits).toHaveLength(0);
  });

  it('持続フレームの前後（発生前・硬直中）は判定が出ない', () => {
    const { player, step } = setup();
    step({ attackPressed: true });
    const fr = player.attackFrames!;
    const flags: boolean[] = [];
    for (let i = 0; i < fr.total + 2; i++) {
      step();
      flags.push(player.attackActive);
    }
    const first = flags.indexOf(true);
    const last = flags.lastIndexOf(true);
    // 「step 後の stateFrame」が startup 以上 startup + active 未満のあいだだけ true
    expect(last - first + 1).toBe(fr.active);
    expect(flags.slice(0, first).every((f) => !f)).toBe(true);
  });
});
