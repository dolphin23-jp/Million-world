import { describe, expect, it } from 'vitest';
import { Player } from './player';
import { resolvePlayerAttack, type CombatTarget } from './combat';
import { Enemy } from '../ai/enemy';
import { ENEMIES, type EnemyDef } from '../ai/data/enemies';
import { createEmptyIntent, type InputIntent } from '../input/intent';
import { ATTACKS, CHARGES, DODGES, MOVE } from '../combat/data/attacks';
import { GUARDS } from '../combat/data/guard';
import { LOADOUTS } from '../combat/data/loadouts';
import type { HitEvent } from '../combat/hit';
import { wrapAngle } from '../core/math';

/**
 * 槍（両手持ち・右手が前。ADR-049）の Player 結合テスト: 技の選択・5 連の連携・溜め突き・ガードと、穂先の利（間合いの先端の命中は強い）。
 * カメラ yaw = π のとき、スティックの上は +Z、右は −X、左は +X。
 */
const DT = 1 / 60;
const CAM_YAW = Math.PI;
const step = (p: Player, over: Partial<InputIntent> = {}, n = 1) => {
  for (let i = 0; i < n; i++) p.step(DT, { ...createEmptyIntent(), ...over }, CAM_YAW);
};
const press = (over: Partial<InputIntent> = {}): Partial<InputIntent> => ({ attackPressed: true, attackHeld: true, ...over });
const near = (a: number, b: number) => Math.abs(wrapAngle(a - b)) < 1e-6;
const spear = () => {
  const p = new Player();
  expect(p.equip('spear')).toBe(true);
  return p;
};
/** 受付（cancelFrame）まで進めて、次の入力を押す */
const toCancel = (p: Player) => {
  step(p, { attackHeld: false });
  while (p.stateFrame < p.attackFrames!.cancelFrame) step(p);
};

describe('槍: 装備', () => {
  it('両手持ちで盾は持たず、技のセット・溜め・ガードは槍のもの。走る速さは大剣より速く、片手剣より遅い', () => {
    const p = spear();
    expect(p.loadout).toBe(LOADOUTS.spear);
    expect(p.loadout.weapon).toBe('spear');
    expect(p.loadout.offhand).toBe('none');
    expect(p.loadout.charge).toBe('spear');
    expect(p.guard).toBeNull();
    step(p, { moveX: 0, moveY: 1 }, 90);
    const sword = new Player();
    step(sword, { moveX: 0, moveY: 1 }, 90);
    const gs = new Player();
    gs.equip('greatsword');
    step(gs, { moveX: 0, moveY: 1 }, 90);
    expect(p.speed).toBeCloseTo(MOVE.runSpeed * LOADOUTS.spear.runSpeedScale, 2);
    expect(p.speed).toBeLessThan(sword.speed);
    expect(p.speed).toBeGreaterThan(gs.speed);
  });
});

describe('槍: 攻撃ボタンで出る技の選択', () => {
  it('スティックなしは 1 段目の突き（sp1）', () => {
    const p = spear();
    step(p, press());
    expect(p.state).toBe('attack');
    expect(p.attack!.id).toBe('sp1');
  });

  it('ロックなしでスティックを倒して攻撃すると、倒した向きへ踏み込み突き（spLunge）', () => {
    const p = spear();
    step(p, press({ moveX: -1, moveY: 0 })); // 画面の左 = +X
    expect(p.attack!.id).toBe('spLunge');
    expect(near(p.yaw, Math.PI / 2)).toBe(true);
  });

  it('ロック中は対象に対する向きで決まる: 前 = 踏み込み突き / 後ろ = 跳び退き突き / 横 = 回転薙ぎ', () => {
    const cases: [string, Partial<InputIntent>][] = [
      ['spLunge', { moveX: 0, moveY: 1 }],
      ['spRetreat', { moveX: 0, moveY: -1 }],
      ['spSpin', { moveX: 1, moveY: 0 }],
      ['spSpin', { moveX: -1, moveY: 0 }],
    ];
    for (const [id, stick] of cases) {
      const p = spear();
      p.setAim({ x: 0, z: 6 });
      step(p, press(stick));
      expect(p.attack!.id, JSON.stringify(stick)).toBe(id);
      expect(near(p.yaw, 0), JSON.stringify(stick)).toBe(true);
    }
  });

  it('ロール直後は跳び突き（spDash）。後ろステップ直後は突き上げ（spRise）', () => {
    const a = spear();
    step(a, { dodgePressed: true, moveX: 0, moveY: 1 });
    expect(a.dodgeKind).toBe('roll');
    step(a, {}, DODGES.roll.frames);
    step(a, press());
    expect(a.attack!.id).toBe('spDash');

    const b = spear();
    step(b, { dodgePressed: true });
    expect(b.dodgeKind).toBe('back');
    step(b, {}, DODGES.back.frames);
    step(b, press());
    expect(b.attack!.id).toBe('spRise');
  });
});

describe('槍: 連携（突き → 二段突き → 薙ぎ払い →（前）貫き突き → 回し払い。最大 5 連）', () => {
  it('受付から押すたびに 1 → 2 → 3 段目と続き、3 段目で終わる（そのまま押すだけでは貫き突きに入らない）', () => {
    const p = spear();
    step(p, press());
    toCancel(p);
    step(p, { attackPressed: true });
    while (p.attack?.id === 'sp1') step(p);
    expect(p.attack!.id).toBe('sp2');
    toCancel(p);
    step(p, { attackPressed: true });
    while (p.attack?.id === 'sp2') step(p);
    expect(p.attack!.id).toBe('sp3');
    // 3 段目の受付で、前へ倒さずに押しても続かない（終わると待機に戻る）
    toCancel(p);
    const seen = new Set<string>();
    for (let i = 0; i < 90 && p.state === 'attack'; i++) {
      step(p, { attackPressed: i % 5 === 0 });
      if (p.attack) seen.add(p.attack.id);
    }
    expect([...seen]).toEqual(['sp3']);
    expect(p.state).toBe('idle');
  });

  it('3 段目の受付で前へ倒して押すと貫き突き（spPierce）、続けて押すと回し払い（spTwirl）で終わる', () => {
    const p = spear();
    step(p, press());
    toCancel(p);
    step(p, { attackPressed: true });
    while (p.attack?.id === 'sp1') step(p);
    toCancel(p);
    step(p, { attackPressed: true });
    while (p.attack?.id === 'sp2') step(p);
    toCancel(p);
    step(p, { attackPressed: true, moveX: 0, moveY: 1 });
    while (p.attack?.id === 'sp3') step(p, { moveX: 0, moveY: 1 });
    expect(p.attack!.id).toBe('spPierce');
    toCancel(p);
    step(p, { attackPressed: true });
    while (p.attack?.id === 'spPierce') step(p);
    expect(p.attack!.id).toBe('spTwirl');
    // 回し払いで連携は終わる
    while (p.state === 'attack') step(p, { attackPressed: true });
    expect(p.state).toBe('idle');
  });

  it('1 段目の受付で、ロック中に横へ倒して押すと払い上げ（spUpper）', () => {
    const p = spear();
    p.setAim({ x: 0, z: 6 });
    step(p, press());
    toCancel(p);
    step(p, { attackPressed: true, moveX: 1, moveY: 0 });
    while (p.attack?.id === 'sp1') step(p, { moveX: 1, moveY: 0 });
    expect(p.attack!.id).toBe('spUpper');
  });

  it('1 段目を受付より早く押しても、受付になってから 2 段目に入る（先行入力）', () => {
    const p = spear();
    step(p, press());
    step(p, { attackPressed: true }, 3);
    expect(p.attack!.id).toBe('sp1');
    while (p.attack?.id === 'sp1') step(p);
    expect(p.attack!.id).toBe('sp2');
  });

  it('突きは素早い: 1・2 段目の発生は 10f 以内、3 段目の薙ぎ払い・貫き突きは前へ踏み込む', () => {
    for (const id of ['sp1', 'sp2']) expect(ATTACKS[id]!.activeStart * 60, id).toBeLessThanOrEqual(10);
    const p = spear();
    step(p, press());
    const z0 = p.body.z;
    while (p.state === 'attack') step(p);
    expect(p.body.z - z0).toBeGreaterThan(0.35);
  });
});

describe('槍: 溜め突き', () => {
  const c = CHARGES.spear!;
  const enterCharge = (p: Player) => {
    step(p, press());
    let n = 1;
    while (p.state !== 'charge' && n < 40) {
      step(p, { attackHeld: true });
      n++;
    }
    return n;
  };

  it(`${c.holdFrames}f 押し続けると、深い引き絞りの構えに入る（1 段目の突きが出る前）`, () => {
    const p = spear();
    const n = enterCharge(p);
    expect(p.state).toBe('charge');
    expect(p.charge).toBe(c);
    expect(n).toBeGreaterThanOrEqual(c.holdFrames);
    expect(n).toBeLessThanOrEqual(c.holdFrames + 2);
    expect(p.attackActive).toBe(false);
  });

  it('離すと溜め突き（spHeavy）。威力は離した時点の段階の倍率（段階が上がるほど大きい）。踏み込みは 1.5m 以上', () => {
    for (let level = 0; level <= c.levels.length; level++) {
      const p = spear();
      enterCharge(p);
      step(p, { attackHeld: true }, c.frames);
      while (p.chargeLevel < level) step(p, { attackHeld: true });
      step(p); // 離す
      expect(p.state, `段階 ${level}`).toBe('attack');
      expect(p.attack!.id, `段階 ${level}`).toBe('spHeavy');
      expect(p.attackPower).toBe(c.levelPower[level]);
    }
    const p = spear();
    enterCharge(p);
    step(p, { attackHeld: true }, c.frames);
    step(p);
    const z0 = p.body.z;
    while (p.state === 'attack') step(p);
    expect(p.body.z - z0).toBeGreaterThan(1.4);
  });

  it('溜め突きは槍の通常の技の中で最も威力が大きい', () => {
    const heavy = ATTACKS.spHeavy!;
    for (const id of ['sp1', 'sp2', 'sp3', 'spLunge', 'spRetreat', 'spSpin', 'spDash', 'spRise', 'spUpper', 'spPierce', 'spTwirl']) expect(heavy.damage, id).toBeGreaterThan(ATTACKS[id]!.damage);
  });

  it('構えに入って dodgeCancelFrame 以降は、回避でキャンセルできる', () => {
    const p = spear();
    enterCharge(p);
    step(p, { attackHeld: true }, c.dodgeCancelFrame - p.stateFrame);
    step(p, { attackHeld: true, dodgePressed: true, moveX: -1, moveY: 0 });
    expect(p.state).toBe('dodge');
    expect(p.charge).toBeNull();
  });
});

describe('槍: ガードとパリィ', () => {
  const g = GUARDS.spear;

  it('ガードボタンで槍の構えに入る。パリィの受付は構えに入ってから 8f（盾の 10f と大剣の 6f の間）', () => {
    const p = spear();
    step(p, { guardPressed: true, guardHeld: true });
    expect(p.state).toBe('guard');
    expect(p.guard).toBe(g);
    expect(p.parryWindow).toBe(true);
    step(p, { guardHeld: true }, g.parryFrames - 1);
    expect(p.parryWindow).toBe(true);
    step(p, { guardHeld: true });
    expect(p.parryWindow).toBe(false);
    expect(g.parryFrames).toBeLessThan(GUARDS.shield.parryFrames);
    expect(g.parryFrames).toBeGreaterThan(GUARDS.greatsword.parryFrames);
  });

  it('受付の中で当たる攻撃はパリィ（弾かれた敵は体勢を崩す）、過ぎたらガード（軽減だけ）', () => {
    const hitEv = { attackerId: 1, targetId: 0, damage: 12, knockback: 0.9, hitStop: 6, dirX: 0, dirZ: -1, x: 0, z: 0.4 };
    const inside = spear();
    step(inside, { guardPressed: true, guardHeld: true });
    expect(inside.guardOutcome(hitEv)).toBe('parry');
    expect(inside.parry(hitEv).id).toBe('stagger');
    const late = spear();
    step(late, { guardPressed: true, guardHeld: true });
    step(late, { guardHeld: true }, g.parryFrames);
    expect(late.guardOutcome(hitEv)).toBe('guard');
  });

  it('受け止めたときの軽減は盾より小さく、大剣より大きい', () => {
    expect(g.damageReduction).toBeLessThan(GUARDS.shield.damageReduction);
    expect(g.damageReduction).toBeGreaterThan(GUARDS.greatsword.damageReduction);
  });
});

describe('槍: 穂先の利（間合いの先端の命中はダメージが大きい）', () => {
  const DUMMY: EnemyDef = { ...ENEMIES.imp, hp: 999999, knockbackScale: 0 };

  /** 的を (0, z) に置いて、1 段目の突きが当たるまで進め、最初の命中を返す */
  function firstHit(z: number): HitEvent | undefined {
    const p = spear();
    const e = new Enemy(DUMMY, 1, 0, z);
    e.place(0, z, Math.PI);
    const hits: HitEvent[] = [];
    step(p, press());
    for (let i = 0; i < 60 && hits.length === 0; i++) {
      if (i > 0) step(p);
      resolvePlayerAttack(p, [e] as CombatTarget[], (ev) => hits.push(ev));
    }
    return hits[0];
  }

  it('近い的は通常のダメージ、遠い的（tip.from 以上）は tip.scale 倍で、命中に tip の印が付く', () => {
    const tip = ATTACKS.sp1!.tip!;
    expect(tip.scale).toBeGreaterThan(1);
    const near = firstHit(1.6);
    const far = firstHit(tip.from + 0.55);
    expect(near).toBeDefined();
    expect(far).toBeDefined();
    expect(near!.tip).toBeUndefined();
    expect(far!.tip).toBe(true);
    expect(near!.damage).toBe(ATTACKS.sp1!.damage);
    expect(far!.damage).toBe(Math.round(ATTACKS.sp1!.damage * tip.scale));
  });

  it('穂先の利を持つのは槍の技だけ。from は当たりの届く距離の内側（遠すぎて当たらない的には効かない）', () => {
    for (const a of Object.values(ATTACKS)) {
      if (a.tip === undefined) continue;
      expect(a.id.startsWith('sp'), a.id).toBe(true);
      const reach = a.hitbox.kind === 'line' ? a.hitbox.length + a.hitbox.radius : a.hitbox.kind === 'arc' ? a.hitbox.range : a.hitbox.offset + a.hitbox.radius;
      expect(a.tip.from, a.id).toBeLessThan(reach + 0.5);
      expect(a.tip.from, a.id).toBeGreaterThan(1.8);
      expect(a.tip.scale, a.id).toBeGreaterThan(1);
      expect(a.tip.scale, a.id).toBeLessThanOrEqual(1.5);
    }
  });
});
