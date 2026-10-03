import { describe, expect, it } from 'vitest';
import { Player } from './player';
import { resolveEnemyAttacks, resolvePlayerAttack, type CombatTarget } from './combat';
import { Enemy } from '../ai/enemy';
import { ENEMIES } from '../ai/data/enemies';
import { ATTACKS, DODGE, DODGES, HIT_STUN, PLAYER_STATS, resolveAttack } from '../combat/data/attacks';
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
  /** 攻撃を押し続けて溜めの構えに入り（段階 0 のうちに）離す。構えが整った時点で重撃が出る */
  const heavy = () => {
    step({ attackPressed: true, attackHeld: true });
    for (let i = 0; i < 60 && player.state !== 'charge'; i++) step({ attackHeld: true });
    expect(player.state).toBe('charge');
  };
  return { player, enemy, hits, step, run, heavy };
}

describe('プレイヤーの攻撃が敵に当たる（Player + Enemy の結合）', () => {
  it('1 段目: 持続フレームの中で 1 回だけ当たり、ダメージ・ひるみ・ノックバックが入る', () => {
    const { player, enemy, hits, step, run } = setup();
    step({ attackPressed: true });
    for (let i = 0; i < 80 && hits.length === 0; i++) step();
    expect(hits).toHaveLength(1);
    const fr = resolveAttack(ATTACKS.combo1!);
    // 攻撃開始のステップが frame 0。持続フレーム（開始から startup 〜 startup + active）の中で当たる
    expect(hits[0]!.frame + 1).toBeGreaterThanOrEqual(fr.startup);
    expect(hits[0]!.frame + 1).toBeLessThan(fr.startup + fr.active);
    expect(hits[0]!.result.dealt).toBe(ATTACKS.combo1!.damage);
    expect(enemy.health.hp).toBe(ENEMIES.imp.hp - ATTACKS.combo1!.damage);
    expect(enemy.state).toBe('hit');
    // ノックバックの距離ぶん奥へ押される（ひるみ中は追ってこない）
    const z0 = enemy.body.z;
    run(ENEMIES.imp.knockbackFrames);
    expect(enemy.body.z - z0).toBeCloseTo(ATTACKS.combo1!.knockback, 6);
    expect(player.state).toBe('attack');
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
    const { hits, run, heavy } = setup(1.7);
    heavy();
    run(90);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.ev.damage).toBe(ATTACKS.heavy!.damage);
  });

  it('HP が 0 になる攻撃で倒れ、そのあとの攻撃はダメージにならない', () => {
    const { enemy, hits, run, heavy } = setup(1.7);
    enemy.health.hp = 5;
    heavy();
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

/** 敵の攻撃（Enemy の FSM → resolveEnemyAttacks → Player.takeHit）。Game.step と同じ順序で進める */
describe('敵の攻撃がプレイヤーに当たる（Enemy + Player の結合）', () => {
  const ATK = ENEMIES.imp.attack;
  interface Scene {
    player: Player;
    enemy: Enemy;
    hits: Hit[];
    pHits: Hit[];
    frame: number;
    step(over?: Partial<InputIntent>): void;
    run(n: number, over?: Partial<InputIntent>): void;
    until(pred: () => boolean, limit?: number, over?: Partial<InputIntent>): number;
  }
  /** プレイヤーは原点（+Z を向く）、敵は攻撃の距離の少し内側（z = range − 0.1）でプレイヤーの方を向いている */
  function scene(enemyZ = ATK.range - 0.1): Scene {
    const player = new Player();
    const enemy = new Enemy(ENEMIES.imp, 1, 0, enemyZ);
    enemy.place(0, enemyZ, Math.PI);
    const sc: Scene = {
      player,
      enemy,
      hits: [],
      pHits: [],
      frame: 0,
      step(over = {}) {
        player.step(DT, { ...createEmptyIntent(), ...over }, CAM_YAW);
        enemy.step(DT, player.body.x, player.body.z, !player.dead);
        resolvePlayerAttack(player, [enemy as CombatTarget], (ev, _t, result) => sc.pHits.push({ frame: sc.frame, ev, result }));
        resolveEnemyAttacks([enemy], player, (ev, _e, result) => sc.hits.push({ frame: sc.frame, ev, result }));
        sc.frame++;
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

  it('敵の攻撃が当たると HP が減り、ひるみに入り、攻撃してきた側を向いて押される', () => {
    const sc = scene();
    sc.until(() => sc.hits.length > 0);
    expect(sc.hits).toHaveLength(1);
    expect(sc.hits[0]!.result.dealt).toBe(ATK.damage);
    expect(sc.player.health.hp).toBe(PLAYER_STATS.maxHp - ATK.damage);
    expect(sc.player.state).toBe('hit');
    // 敵は +Z 側。プレイヤーは敵の方（+Z）を向き、−Z へ押される
    expect(sc.player.yaw).toBeCloseTo(0, 6);
    const z0 = sc.player.body.z;
    sc.run(HIT_STUN.knockbackFrames + 1);
    expect(sc.player.body.z).toBeLessThan(z0);
    expect(z0 - sc.player.body.z).toBeGreaterThan(ATK.knockback * 0.5);
  });

  it('ひるみのあいだ操作できず、HIT_STUN.frames 後に待機に戻る', () => {
    const sc = scene();
    sc.until(() => sc.hits.length > 0);
    sc.run(HIT_STUN.frames - 2, { attackPressed: true, moveX: 1 });
    expect(sc.player.state).toBe('hit');
    sc.run(4);
    expect(sc.player.state).not.toBe('hit');
  });

  it('被弾後は HIT_STUN.invulnFrames のあいだ無敵で、同じ攻撃にも次の攻撃にも当たらない。切れたら当たる', () => {
    const sc = scene();
    sc.until(() => sc.hits.length > 0);
    expect(sc.player.body.invulnerable).toBe(true);
    // 無敵フレームの数ぶん、無敵のまま（step 後の hurtInvulnFrames は 1 ずつ減る）
    let invuln = 0;
    while (sc.player.body.invulnerable && invuln < 200) {
      sc.step();
      invuln++;
    }
    expect(invuln).toBe(HIT_STUN.invulnFrames);
    // 無敵が切れたあと、敵が次の攻撃をすれば当たる（プレイヤーが離れなければ）
    const before = sc.hits.length;
    sc.until(() => sc.hits.length > before, 400);
    expect(sc.player.health.hp).toBe(PLAYER_STATS.maxHp - 2 * ATK.damage);
  });

  it('1 回の敵の攻撃は 1 回しか当たらない（判定が出ている全フレームを通して）', () => {
    const sc = scene();
    sc.until(() => sc.enemy.state === 'attack');
    sc.until(() => sc.enemy.state !== 'attack', 200);
    expect(sc.hits).toHaveLength(1);
  });

  it('当たり続けると倒れ、そのあとは何も当たらず HP は 0 のまま。敵は待機に戻る', () => {
    const sc = scene();
    sc.until(() => sc.player.dead, 3000);
    expect(sc.player.health.hp).toBe(0);
    expect(sc.hits.length).toBe(Math.ceil(PLAYER_STATS.maxHp / ATK.damage));
    expect(sc.hits[sc.hits.length - 1]!.result.killed).toBe(true);
    const n = sc.hits.length;
    sc.run(300);
    expect(sc.hits.length).toBe(n);
    expect(sc.enemy.state).toBe('idle');
    expect(sc.player.body.invulnerable).toBe(true);
  });

  it('reset で最初の状態（HP 満タン、原点、待機）に戻る', () => {
    const sc = scene();
    sc.until(() => sc.player.dead, 3000);
    sc.player.reset();
    expect(sc.player.health.hp).toBe(PLAYER_STATS.maxHp);
    expect(sc.player.state).toBe('idle');
    expect(sc.player.dead).toBe(false);
    expect(sc.player.body.invulnerable).toBe(false);
    expect(sc.player.body.x).toBe(0);
  });

  it('回避の無敵フレーム: 敵の判定が出ているあいだに無敵なら当たらず、回避しなければ同じ位置で当たる', () => {
    // 対照: 動かなければ当たる
    const control = scene();
    control.until(() => control.hits.length > 0);
    expect(control.hits).toHaveLength(1);

    // 回避: 予備動作の残り R フレームで横へ回避する。判定（攻撃に入って startup〜）が回避の無敵 [invulnStart, invulnEnd] に収まる
    const sc = scene();
    sc.until(() => sc.enemy.state === 'windup' && sc.enemy.stateFrame >= ATK.windupFrames - 4);
    sc.step({ dodgePressed: true, moveX: 1, moveY: 0 });
    sc.run(40);
    expect(sc.hits).toHaveLength(0);
    expect(sc.enemy.state).not.toBe('windup'); // 攻撃は空振りで終わっている
  });

  it('プレイヤーの無敵フラグは回避の [invulnStart, invulnEnd] フレームだけ立つ（ロールも後ろステップも）', () => {
    // ロール = スティックを倒して回避、後ろステップ = 入力なしで回避
    for (const [kind, press] of [['roll', { dodgePressed: true, moveX: 0, moveY: 1 }], ['back', { dodgePressed: true }]] as const) {
      const d = DODGES[kind];
      const player = new Player();
      const flags: boolean[] = [];
      player.step(DT, { ...createEmptyIntent(), ...press }, CAM_YAW);
      expect(player.dodgeKind).toBe(kind);
      flags.push(player.body.invulnerable);
      for (let i = 0; i < d.frames + 2; i++) {
        player.step(DT, createEmptyIntent(), CAM_YAW);
        flags.push(player.body.invulnerable);
      }
      // 回避に入った step の後が stateFrame = 1
      const first = flags.indexOf(true) + 1;
      const last = flags.lastIndexOf(true) + 1;
      expect(first, kind).toBe(d.invulnStart);
      expect(last, kind).toBe(d.invulnEnd);
    }
  });

  it('重撃は敵の予備動作の後半（スーパーアーマー中）でも割り込み、プレイヤーは被弾しない', () => {
    const sc = scene(1.7);
    // 溜めの構えに入って待ち、敵が予備動作に入った少しあとに離す。重撃の判定は離してから数フレーム後に出るので、
    // 当たるのは予備動作の後半（armorFromFrame を過ぎている）で、敵の攻撃の判定が出る前
    sc.step({ attackPressed: true, attackHeld: true });
    sc.until(() => sc.player.state === 'charge', 60, { attackHeld: true });
    sc.until(() => sc.enemy.state === 'windup' && sc.enemy.stateFrame >= 8, 600, { attackHeld: true });
    expect(sc.player.chargeLevel).toBe(0);
    // 当たった瞬間（直前の step の終わり）の敵はスーパーアーマー中だった
    let armoredAtHit = false;
    for (let i = 0; i < 80 && sc.pHits.length === 0; i++) {
      armoredAtHit = sc.enemy.armored;
      sc.step();
    }
    expect(sc.pHits).toHaveLength(1);
    expect(armoredAtHit).toBe(true);
    expect(sc.pHits[0]!.ev.damage).toBe(ATTACKS.heavy!.damage);
    expect(sc.enemy.state).toBe('hit');
    expect(sc.enemy.attackActive).toBe(false);
    expect(sc.hits).toHaveLength(0);
    expect(sc.player.health.hp).toBe(PLAYER_STATS.maxHp);
  });

  it('弱攻撃は敵の予備動作の後半では割り込めず、敵の攻撃が当たる（攻撃し続けるか、避けるかの選択になる）', () => {
    const sc = scene(1.7);
    // 敵が予備動作の後半に入ってから 1 段目を振る。当たるのは 12〜20f 後、攻撃の判定が出る前なので、ひるまず、そのまま振り下ろされる
    sc.until(() => sc.enemy.state === 'windup' && sc.enemy.stateFrame >= ATK.armorFromFrame);
    sc.step({ attackPressed: true });
    sc.until(() => sc.pHits.length > 0, 80);
    expect(sc.enemy.armored).toBe(true);
    expect(sc.enemy.state).not.toBe('hit');
    sc.until(() => sc.hits.length > 0, 120);
    expect(sc.player.health.hp).toBe(PLAYER_STATS.maxHp - ATK.damage);
  });

  it('被弾すると攻撃（コンボ）が中断され、先行入力も消える', () => {
    const sc = scene();
    // プレイヤーが攻撃を振っている最中に敵の攻撃が当たる位置・タイミングを作るのは難しいので、攻撃中に直接 takeHit する
    sc.step({ attackPressed: true });
    sc.run(5);
    expect(sc.player.state).toBe('attack');
    sc.player.takeHit({ attackerId: 1, targetId: 0, damage: 5, knockback: 0.3, hitStop: 3, dirX: 0, dirZ: -1, x: 0, z: 0.3 });
    expect(sc.player.state).toBe('hit');
    expect(sc.player.attack).toBeNull();
    expect(sc.player.attackActive).toBe(false);
  });
});
