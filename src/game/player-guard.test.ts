import { describe, expect, it } from 'vitest';
import { Player } from './player';
import { createEmptyIntent, type InputIntent } from '../input/intent';
import { CHARGES, DODGES, MOVE } from '../combat/data/attacks';
import { GUARDS } from '../combat/data/guard';
import { LOADOUTS } from '../combat/data/loadouts';
import { wrapAngle } from '../core/math';
import type { HitEvent } from '../combat/hit';

/**
 * ガードの状態機械と装備（ADR-020）の Player 結合テスト。カメラ yaw = π のとき、スティックの上は +Z、左は +X。
 * プレイヤーは原点で +Z（yaw 0）を向き、敵は +Z 側にいるものとして、正面からの攻撃は dir = (0, −1)。
 */
const DT = 1 / 60;
const CAM_YAW = Math.PI;
const step = (p: Player, over: Partial<InputIntent> = {}, n = 1) => {
  for (let i = 0; i < n; i++) p.step(DT, { ...createEmptyIntent(), ...over }, CAM_YAW);
};
/** ガードボタンを押し続ける */
const hold = (p: Player, n = 1, over: Partial<InputIntent> = {}) => step(p, { guardHeld: true, ...over }, n);
const press = (p: Player, over: Partial<InputIntent> = {}) => step(p, { guardPressed: true, guardHeld: true, ...over });
const near = (a: number, b: number, eps = 1e-6) => Math.abs(wrapAngle(a - b)) < eps;
const hit = (over: Partial<HitEvent> = {}): HitEvent => ({ attackerId: 1, targetId: 0, damage: 12, knockback: 0.9, hitStop: 6, dirX: 0, dirZ: -1, x: 0, z: 0.4, ...over });
const shieldPlayer = () => {
  const p = new Player();
  p.equip('sword-shield');
  return p;
};

describe('構え（ガード）', () => {
  it('ガードボタンで構えに入る。構えのあいだは動けず、向きだけ変わる', () => {
    const p = shieldPlayer();
    press(p);
    expect(p.state).toBe('guard');
    expect(p.guarding).toBe(true);
    expect(p.guard).toBe(GUARDS.shield);
    hold(p, 40, { moveX: -1, moveY: 0 }); // 画面の左 = +X へ倒す
    expect(p.state).toBe('guard');
    expect(p.body.x).toBeCloseTo(0, 6);
    expect(p.body.z).toBeCloseTo(0, 6);
    expect(near(p.yaw, Math.PI / 2, 1e-3)).toBe(true);
  });

  it('走っている途中からでも、構えに入った step で止まる（慣性で滑らない）', () => {
    const p = shieldPlayer();
    step(p, { moveX: 0, moveY: 1 }, 30);
    expect(p.state).toBe('run');
    press(p, { moveX: 0, moveY: 1 });
    expect(p.state).toBe('guard');
    const z = p.body.z;
    hold(p, 10);
    expect(p.body.z).toBeCloseTo(z, 6);
  });

  it('ロック中は対象のほうへ向き直る（スティックより照準が優先）', () => {
    const p = shieldPlayer();
    p.setAim({ x: 6, z: 0 }); // 対象は +X
    press(p);
    hold(p, 40, { moveX: 1, moveY: 0 });
    expect(near(p.yaw, Math.PI / 2, 1e-3)).toBe(true);
  });

  it('離すと解ける。ただし構えに入って minHoldFrames までは解けない（一瞬のタップでも最短の構え）', () => {
    const g = GUARDS.shield;
    const p = shieldPlayer();
    press(p);
    step(p, {}, g.minHoldFrames - 2); // 離している
    expect(p.state).toBe('guard');
    step(p, {}, 3);
    expect(p.state).not.toBe('guard');
    expect(p.guard).toBeNull();
  });

  it('押したまま（一瞬しか触れなかった tap でも）構えに入る: guardPressed だけ立ち guardHeld が立たない step でも構える', () => {
    const p = shieldPlayer();
    step(p, { guardPressed: true });
    expect(p.state).toBe('guard');
  });

  it('構えを解いてから lockFrames のあいだは構え直せない（押しても、明けたら構える）', () => {
    const g = GUARDS.shield;
    const p = shieldPlayer();
    press(p);
    step(p, {}, g.minHoldFrames);
    expect(p.state).not.toBe('guard');
    press(p);
    expect(p.state).not.toBe('guard'); // 待ちの間
    let n = 0;
    while (p.state !== 'guard' && n < 40) {
      hold(p);
      n++;
    }
    expect(p.state).toBe('guard');
    expect(n).toBeGreaterThan(2);
    expect(n).toBeLessThanOrEqual(g.lockFrames + 1);
  });

  it('先行入力: 攻撃の持続が終わる少し前に押すと、持続が終わった step で構えに入る。持続の前には構えない', () => {
    const p = shieldPlayer();
    step(p, { attackPressed: true });
    expect(p.state).toBe('attack');
    const fr = p.attackFrames!;
    const activeEnd = fr.startup + fr.active;
    step(p, {}, 1);
    press(p); // 早押し（すぐ先行入力の期限が切れる距離）
    step(p, {}, 4);
    expect(p.state).toBe('attack');
    // 持続の終わりの少し前に押す
    const q = shieldPlayer();
    step(q, { attackPressed: true });
    while (q.stateFrame < activeEnd - 3) step(q);
    press(q);
    let n = 0;
    while (q.state === 'attack' && n < 20) {
      hold(q);
      n++;
    }
    expect(q.state).toBe('guard');
    expect(q.attack).toBeNull();
    expect(q.attackActive).toBe(false);
  });

  it('溜めの構えからも、回避と同じフレーム以降は構えへ移れる', () => {
    const c = CHARGES.sword!;
    const p = shieldPlayer();
    step(p, { attackPressed: true, attackHeld: true });
    let n = 0;
    while (p.state !== 'charge' && n < 40) {
      step(p, { attackHeld: true });
      n++;
    }
    expect(p.state).toBe('charge');
    step(p, { attackHeld: true, guardPressed: true, guardHeld: true }); // 早すぎる
    expect(p.state).toBe('charge');
    while (p.stateFrame < c.dodgeCancelFrame) step(p, { attackHeld: true });
    press(p);
    expect(p.state).toBe('guard');
    expect(p.charge).toBeNull();
    expect(p.chargeLevel).toBe(0);
  });

  it('回避の途中（キャンセル可能になってから）に押すと構えに入る', () => {
    const p = shieldPlayer();
    step(p, { dodgePressed: true, moveX: 0, moveY: 1 });
    expect(p.state).toBe('dodge');
    const def = DODGES[p.dodgeKind];
    press(p);
    expect(p.state).toBe('dodge'); // 早すぎる（先行入力は残る）
    while (p.stateFrame < def.cancelFrame - 3) step(p);
    press(p);
    let n = 0;
    while (p.state === 'dodge' && n < 20) {
      hold(p);
      n++;
    }
    expect(p.state).toBe('guard');
  });
});

describe('構えからのキャンセル（弾いたあとの反撃はここから）', () => {
  it('cancelFrame 以降は攻撃で技が出る。スティックを倒していれば踏み込み突き。出る前は構えのまま', () => {
    const g = GUARDS.shield;
    const a = shieldPlayer();
    press(a);
    step(a, { guardHeld: true, attackPressed: true }); // frame 2: cancelFrame 前
    expect(a.state).toBe('guard');
    hold(a, g.cancelFrame);
    expect(a.state).toBe('attack');
    expect(a.attack!.id).toBe('combo1');
    expect(a.guard).toBeNull();

    const b = shieldPlayer();
    press(b);
    hold(b, g.cancelFrame + 1);
    step(b, { guardHeld: true, attackPressed: true, moveX: 0, moveY: 1 });
    expect(b.state).toBe('attack');
    expect(b.attack!.id).toBe('lunge');
  });

  it('cancelFrame 以降は回避でもキャンセルできる', () => {
    const g = GUARDS.shield;
    const p = shieldPlayer();
    press(p);
    hold(p, 1, { dodgePressed: true });
    expect(p.state).toBe('guard');
    hold(p, g.cancelFrame);
    step(p, { guardHeld: true, dodgePressed: true, moveX: -1, moveY: 0 });
    expect(p.state).toBe('dodge');
    expect(p.dodgeKind).toBe('roll');
    expect(p.guard).toBeNull();
  });

  it('構えへ入る前から溜まっていた攻撃の先行入力は、構えに入ったときに捨てられる（勝手に反撃しない）', () => {
    const p = shieldPlayer();
    step(p, { attackPressed: true });
    while (p.attack && p.stateFrame < p.attackFrames!.startup + p.attackFrames!.active) step(p);
    // 持続が終わった step で構えへ。そこへ届く前に押していた攻撃は、構えのあいだの反撃にならない
    step(p, { attackPressed: true, guardPressed: true, guardHeld: true });
    expect(p.state).toBe('guard');
    hold(p, 20);
    expect(p.state).toBe('guard');
  });
});

describe('ガードで受ける・弾く', () => {
  it('guardOutcome: 構えていなければ none。構えに入った step から parryFrames のあいだパリィ、そのあとガード。正面の外は none', () => {
    const g = GUARDS.shield;
    const p = shieldPlayer();
    expect(p.guardOutcome(hit())).toBe('none');
    press(p);
    for (let f = 1; f <= g.parryFrames; f++) {
      expect(p.stateFrame).toBe(f);
      expect(p.guardOutcome(hit()), `f${f}`).toBe('parry');
      expect(p.parryWindow, `f${f}`).toBe(true);
      hold(p);
    }
    expect(p.guardOutcome(hit())).toBe('guard');
    expect(p.parryWindow).toBe(false);
    expect(p.guardOutcome(hit({ dirX: 0, dirZ: 1 }))).toBe('none'); // 背後
    expect(p.guardOutcome(hit({ dirX: -1, dirZ: 0 }))).toBe('none'); // 真横
  });

  it('素手の剣のガードは、パリィの受付がない（構えた直後でもガード）', () => {
    const p = new Player();
    expect(p.loadout.guard).toBe(GUARDS.sword);
    press(p);
    expect(p.guardOutcome(hit())).toBe('guard');
    expect(p.parryWindow).toBe(false);
  });

  it('guardBlock: 軽減したダメージだけ通り、構えは保ち、硬直に入り、少し押される。向きは変わらない', () => {
    const g = GUARDS.shield;
    const p = shieldPlayer();
    press(p);
    hold(p, g.parryFrames + 2);
    const hp = p.health.hp;
    const serial = p.guardHitSerial;
    const yaw = p.yaw;
    const r = p.guardBlock(hit());
    expect(r.dealt).toBe(2);
    expect(r.killed).toBe(false);
    expect(p.health.hp).toBe(hp - 2);
    expect(p.guardHitSerial).toBe(serial + 1);
    expect(p.state).toBe('guard');
    expect(p.guardStun).toBe(g.hitStunFrames);
    expect(p.yaw).toBe(yaw);
    // 押される: knockback × knockbackScale（0.9 × 0.3 = 0.27m）だけ後ろ（−Z）へ
    const z0 = p.body.z;
    hold(p, 14);
    expect(z0 - p.body.z).toBeCloseTo(0.9 * g.knockbackScale, 1);
  });

  it('硬直（guardStun）のあいだは、離しても解けず、回避でキャンセルもできない。明けたら（離していれば）解ける', () => {
    const g = GUARDS.shield;
    const p = shieldPlayer();
    press(p);
    hold(p, g.minHoldFrames + 2);
    p.guardBlock(hit());
    step(p, { dodgePressed: true }, g.hitStunFrames - 1); // 離していて、回避も押している
    expect(p.state).toBe('guard');
    expect(p.guardStun).toBe(1);
    step(p, {}, 1);
    expect(p.guardStun).toBe(0);
    expect(p.state).toBe('guard');
    step(p, {}, 1);
    expect(p.state).not.toBe('guard');
    expect(p.state).not.toBe('dodge'); // 硬直中に押した回避は先行入力にならない
  });

  it('硬直のあいだに押した攻撃は先行入力として残り、硬直が明けたら出る（構えのまま受けた直後の反撃）', () => {
    const g = GUARDS.shield;
    const p = shieldPlayer();
    press(p);
    hold(p, g.minHoldFrames + 2);
    p.guardBlock(hit());
    hold(p, g.hitStunFrames - 1, { attackPressed: true });
    expect(p.state).toBe('guard');
    hold(p, 1);
    expect(p.state).toBe('guard');
    hold(p, 1);
    expect(p.state).toBe('attack');
    expect(p.attack!.id).toBe('combo1');
  });

  it('パリィ: ダメージも押されもなく、構えのまま。parrySerial が増える', () => {
    const p = shieldPlayer();
    press(p);
    const hp = p.health.hp;
    const serial = p.parrySerial;
    p.parry(hit());
    expect(p.parrySerial).toBe(serial + 1);
    expect(p.health.hp).toBe(hp);
    expect(p.state).toBe('guard');
    expect(p.guardStun).toBe(0);
    const z = p.body.z;
    hold(p, 10);
    expect(p.body.z).toBeCloseTo(z, 6);
  });

  it('ガードの削りで HP が尽きたら倒れる（構えは解ける）', () => {
    const p = shieldPlayer();
    press(p);
    hold(p, 12);
    p.health.hp = 1;
    const r = p.guardBlock(hit());
    expect(r.killed).toBe(true);
    expect(p.state).toBe('dead');
    expect(p.guard).toBeNull();
    expect(p.dead).toBe(true);
  });

  it('構えの外から受けた攻撃（背後・横）は通常の被弾: ひるみに入り、構えは解ける', () => {
    const p = shieldPlayer();
    press(p);
    hold(p, 12);
    p.takeHit(hit({ dirX: 0, dirZ: 1 }));
    expect(p.state).toBe('hit');
    expect(p.guard).toBeNull();
    expect(p.guardStun).toBe(0);
    expect(p.health.hp).toBe(p.health.max - 12);
  });

  it('被弾のあとは構えの先行入力も消える（ひるみが明けた瞬間に勝手に構えない）', () => {
    const p = shieldPlayer();
    press(p);
    p.takeHit(hit({ dirX: 0, dirZ: 1 }));
    step(p, { guardPressed: true, guardHeld: true });
    expect(p.state).toBe('hit');
    step(p, {}, 60); // ひるみ・無敵が明けるまで
    expect(p.state).not.toBe('guard');
  });
});

describe('装備', () => {
  it('標準は素手の片手剣。立っている・走っているあいだだけ替えられ、替えたら equipSerial が増える', () => {
    const p = new Player();
    expect(p.loadout).toBe(LOADOUTS.sword);
    expect(p.equipSerial).toBe(0);
    expect(p.equip('sword-shield')).toBe(true);
    expect(p.loadout).toBe(LOADOUTS['sword-shield']);
    expect(p.equipSerial).toBe(1);
    expect(p.equip('sword-shield')).toBe(true); // すでにその装備: 何も変わらない
    expect(p.equipSerial).toBe(1);
    step(p, { moveX: 0, moveY: 1 }, 5);
    expect(p.state).toBe('run');
    expect(p.equip('sword')).toBe(true);
    expect(p.equipSerial).toBe(2);
  });

  it('攻撃・回避・溜め・構え・被弾のあいだは替えられない', () => {
    const attacking = new Player();
    step(attacking, { attackPressed: true });
    expect(attacking.equip('sword-shield')).toBe(false);
    expect(attacking.loadout.id).toBe('sword');

    const dodging = new Player();
    step(dodging, { dodgePressed: true });
    expect(dodging.equip('sword-shield')).toBe(false);

    const guarding = shieldPlayer();
    press(guarding);
    expect(guarding.equip('sword')).toBe(false);
    expect(guarding.loadout.id).toBe('sword-shield');

    const hurt = new Player();
    hurt.takeHit(hit());
    expect(hurt.equip('sword-shield')).toBe(false);
  });

  it('盾を持つと走る速さが遅くなる（盾の重さ）。構えの定義は装備に従う', () => {
    const run = (p: Player) => {
      step(p, { moveX: 0, moveY: 1 }, 90);
      return Math.hypot(p.velX, p.velZ);
    };
    const plain = new Player();
    const shielded = shieldPlayer();
    expect(run(plain)).toBeCloseTo(MOVE.runSpeed, 6);
    expect(run(shielded)).toBeCloseTo(MOVE.runSpeed * LOADOUTS['sword-shield'].runSpeedScale, 6);
    press(plain);
    press(shielded);
    expect(plain.guard).toBe(GUARDS.sword);
    expect(shielded.guard).toBe(GUARDS.shield);
  });

  it('reset しても装備は変わらない（再戦しても同じ装備）', () => {
    const p = shieldPlayer();
    press(p);
    p.reset();
    expect(p.loadout.id).toBe('sword-shield');
    expect(p.state).toBe('idle');
    expect(p.guard).toBeNull();
  });
});
