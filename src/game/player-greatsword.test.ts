import { describe, expect, it } from 'vitest';
import { Player } from './player';
import { createEmptyIntent, type InputIntent } from '../input/intent';
import { ATTACKS, CHARGES, DODGES, MOVE } from '../combat/data/attacks';
import { GUARDS } from '../combat/data/guard';
import { LOADOUTS } from '../combat/data/loadouts';
import { wrapAngle } from '../core/math';

/**
 * 大剣（両手持ち。ADR-021）の Player 結合テスト: 技の選択・2 連・溜め斬り・ガードと、片手剣との違い（重い・手数が少ない）。
 * カメラ yaw = π のとき、スティックの上は +Z、右は −X、左は +X。
 */
const DT = 1 / 60;
const CAM_YAW = Math.PI;
const step = (p: Player, over: Partial<InputIntent> = {}, n = 1) => {
  for (let i = 0; i < n; i++) p.step(DT, { ...createEmptyIntent(), ...over }, CAM_YAW);
};
const press = (over: Partial<InputIntent> = {}): Partial<InputIntent> => ({ attackPressed: true, attackHeld: true, ...over });
const near = (a: number, b: number) => Math.abs(wrapAngle(a - b)) < 1e-6;
const greatsword = () => {
  const p = new Player();
  expect(p.equip('greatsword')).toBe(true);
  return p;
};

describe('大剣: 装備', () => {
  it('両手持ちで盾は持たず、技のセット・溜め・ガードは大剣のもの。走る速さは片手剣より遅い', () => {
    const p = greatsword();
    expect(p.loadout).toBe(LOADOUTS.greatsword);
    expect(p.loadout.weapon).toBe('greatsword');
    expect(p.loadout.offhand).toBe('none');
    expect(p.loadout.charge).toBe('greatsword');
    expect(p.guard).toBeNull();
    step(p, { moveX: 0, moveY: 1 }, 90);
    const sword = new Player();
    step(sword, { moveX: 0, moveY: 1 }, 90);
    expect(p.speed).toBeCloseTo(MOVE.runSpeed * LOADOUTS.greatsword.runSpeedScale, 2);
    expect(p.speed).toBeLessThan(sword.speed);
  });

  it('装備は立っている・走っているあいだだけ替えられる（攻撃の途中では替えられない）', () => {
    const p = new Player();
    step(p, press());
    expect(p.state).toBe('attack');
    expect(p.equip('greatsword')).toBe(false);
    expect(p.loadout.id).toBe('sword');
  });
});

describe('大剣: 攻撃ボタンで出る技の選択', () => {
  it('スティックなしは 1 段目（gs1）', () => {
    const p = greatsword();
    step(p, press());
    expect(p.state).toBe('attack');
    expect(p.attack!.id).toBe('gs1');
  });

  it('ロックなしでスティックを倒して攻撃すると、倒した向きへ踏み込み突き（gsLunge）', () => {
    const p = greatsword();
    step(p, press({ moveX: -1, moveY: 0 })); // 画面の左 = +X
    expect(p.attack!.id).toBe('gsLunge');
    expect(near(p.yaw, Math.PI / 2)).toBe(true);
  });

  it('ロック中は対象に対する向きで決まる: 前 = 踏み込み突き / 後ろ = 下がりながらの薙ぎ払い / 横 = 大回転', () => {
    const cases: [string, Partial<InputIntent>][] = [
      ['gsLunge', { moveX: 0, moveY: 1 }],
      ['gsRetreat', { moveX: 0, moveY: -1 }],
      ['gsSpin', { moveX: 1, moveY: 0 }],
      ['gsSpin', { moveX: -1, moveY: 0 }],
    ];
    for (const [id, stick] of cases) {
      const p = greatsword();
      p.setAim({ x: 0, z: 6 });
      step(p, press(stick));
      expect(p.attack!.id, JSON.stringify(stick)).toBe(id);
      expect(near(p.yaw, 0), JSON.stringify(stick)).toBe(true);
    }
  });

  it('ロール直後は跳び叩きつけ（gsDash）。回避の途中（キャンセルできるようになってから）に押しても同じ', () => {
    const a = greatsword();
    step(a, { dodgePressed: true, moveX: 0, moveY: 1 });
    expect(a.dodgeKind).toBe('roll');
    step(a, {}, DODGES.roll.frames);
    step(a, press());
    expect(a.attack!.id).toBe('gsDash');

    const b = greatsword();
    step(b, { dodgePressed: true, moveX: 0, moveY: 1 });
    step(b, press(), 2);
    while (b.state === 'dodge') step(b);
    expect(b.attack!.id).toBe('gsDash');
  });

  it('後ろステップ直後は斬り上げ（gsRise。片手剣は踏み込み突き）', () => {
    const p = greatsword();
    step(p, { dodgePressed: true });
    expect(p.dodgeKind).toBe('back');
    step(p, {}, DODGES.back.frames);
    step(p, press());
    expect(p.attack!.id).toBe('gsRise');
  });
});

describe('大剣: 2 連（手数が少ない）', () => {
  it('1 段目の受付から 2 段目（gs2）に連なり、そこで終わる。3 段目はない', () => {
    const p = greatsword();
    step(p, press());
    step(p, { attackHeld: false });
    while (p.stateFrame < p.attackFrames!.cancelFrame) step(p);
    step(p, { attackPressed: true });
    while (p.attack?.id === 'gs1') step(p);
    expect(p.attack!.id).toBe('gs2');
    // 2 段目の途中で何度押しても連ならない。終わると待機に戻る（終わってから押すと、新しい 1 段目になる）
    const seen = new Set<string>();
    for (let i = 0; i < 90 && p.state === 'attack'; i++) {
      step(p, { attackPressed: i % 5 === 0 });
      if (p.attack) seen.add(p.attack.id);
    }
    expect([...seen]).toEqual(['gs2']);
    expect(p.state).toBe('idle');
  });

  it('1 段目を受付より早く押しても、受付になってから 2 段目に入る（先行入力）', () => {
    const p = greatsword();
    step(p, press());
    step(p, { attackPressed: true }, 3);
    expect(p.attack!.id).toBe('gs1');
    while (p.attack?.id === 'gs1') step(p);
    expect(p.attack!.id).toBe('gs2');
  });

  it('1 段目は前進し（0.7m）、2 段目も続けて進む（合計 1.3m）。受付から先はルートが止まっている', () => {
    const p = greatsword();
    step(p, press());
    step(p, { attackHeld: false });
    while (p.stateFrame < p.attackFrames!.cancelFrame) step(p);
    const z1 = p.body.z;
    expect(z1).toBeGreaterThan(0.55);
    step(p, { attackPressed: true });
    while (p.attack?.id === 'gs1') step(p);
    while (p.state === 'attack') step(p);
    expect(p.body.z - z1).toBeGreaterThan(0.45);
  });
});

describe('大剣: 溜め斬り', () => {
  const c = CHARGES.greatsword!;
  const enterCharge = (p: Player) => {
    step(p, press());
    let n = 1;
    while (p.state !== 'charge' && n < 40) {
      step(p, { attackHeld: true });
      n++;
    }
    return n;
  };

  it(`${c.holdFrames}f 押し続けると、頭上の溜めの構えに入る（1 段目の斬りが出る前）`, () => {
    const p = greatsword();
    const n = enterCharge(p);
    expect(p.state).toBe('charge');
    expect(p.charge).toBe(c);
    expect(n).toBeGreaterThanOrEqual(c.holdFrames);
    expect(n).toBeLessThanOrEqual(c.holdFrames + 2);
    expect(p.attackActive).toBe(false);
  });

  it('離すと溜め斬り（gsHeavy）を放つ。最大の段階まで溜めたときだけ地割り（gsSmash）。威力は離した時点の段階の倍率で、最高段階は片手剣より大きい', () => {
    for (let level = 0; level <= c.levels.length; level++) {
      const p = greatsword();
      enterCharge(p);
      step(p, { attackHeld: true }, c.frames);
      while (p.chargeLevel < level) step(p, { attackHeld: true });
      step(p); // 離す
      expect(p.state, `段階 ${level}`).toBe('attack');
      expect(p.attack!.id, `段階 ${level}`).toBe(level === c.levels.length ? 'gsSmash' : 'gsHeavy');
      expect(p.attackPower).toBe(c.levelPower[level]);
    }
    expect(c.levelPower[c.levelPower.length - 1]).toBeGreaterThan(CHARGES.sword!.levelPower[CHARGES.sword!.levelPower.length - 1]!);
  });

  it('溜め斬りは大剣の技の中で最も威力が大きく、範囲も広い（扇の半角 90°、届く距離 3m）。踏み込みは 1.3m', () => {
    const heavy = ATTACKS.gsHeavy!;
    for (const id of ['gs1', 'gs2', 'gsLunge', 'gsRetreat', 'gsSpin', 'gsDash', 'gsRise']) expect(heavy.damage, id).toBeGreaterThan(ATTACKS[id]!.damage);
    const p = greatsword();
    enterCharge(p);
    step(p, { attackHeld: true }, c.frames);
    step(p);
    const z0 = p.body.z;
    while (p.state === 'attack') step(p);
    expect(p.body.z - z0).toBeGreaterThan(1.1);
  });

  it('構えに入って dodgeCancelFrame 以降は、回避でキャンセルできる', () => {
    const p = greatsword();
    enterCharge(p);
    step(p, { attackHeld: true }, c.dodgeCancelFrame - p.stateFrame);
    step(p, { attackHeld: true, dodgePressed: true, moveX: -1, moveY: 0 });
    expect(p.state).toBe('dodge');
    expect(p.charge).toBeNull();
  });
});

describe('大剣: ガードとパリィ', () => {
  const g = GUARDS.greatsword;

  it('ガードボタンで大剣の構えに入る。パリィの受付は構えに入ってから 6f（盾の 10f より短い）', () => {
    const p = greatsword();
    step(p, { guardPressed: true, guardHeld: true });
    expect(p.state).toBe('guard');
    expect(p.guard).toBe(g);
    expect(p.parryWindow).toBe(true);
    step(p, { guardHeld: true }, g.parryFrames - 1);
    expect(p.parryWindow).toBe(true);
    step(p, { guardHeld: true });
    expect(p.parryWindow).toBe(false);
    expect(g.parryFrames).toBeLessThan(GUARDS.shield.parryFrames);
  });

  it('受付の中で当たる攻撃はパリィ（弾かれた敵は倒れる効果）、過ぎたらガード（軽減だけ）', () => {
    const hitEv = { attackerId: 1, targetId: 0, damage: 12, knockback: 0.9, hitStop: 6, dirX: 0, dirZ: -1, x: 0, z: 0.4 };
    const inside = greatsword();
    step(inside, { guardPressed: true, guardHeld: true });
    expect(inside.guardOutcome(hitEv)).toBe('parry');
    expect(inside.parry(hitEv).id).toBe('down');
    expect(inside.parrySerial).toBe(1);
    const late = greatsword();
    step(late, { guardPressed: true, guardHeld: true });
    step(late, { guardHeld: true }, g.parryFrames);
    expect(late.guardOutcome(hitEv)).toBe('guard');
  });

  it('受け止めたときの軽減は盾より小さく、素手の剣より大きい（失敗すると痛い）', () => {
    const p = greatsword();
    step(p, { guardPressed: true, guardHeld: true });
    step(p, { guardHeld: true }, g.parryFrames + 2);
    const ev = { attackerId: 1, targetId: 0, damage: 20, knockback: 0.9, hitStop: 6, dirX: 0, dirZ: -1, x: 0, z: 0.4 };
    const r = p.guardBlock(ev);
    expect(r.dealt).toBe(Math.round(20 * (1 - g.damageReduction)));
    expect(r.dealt).toBeGreaterThan(Math.round(20 * (1 - GUARDS.shield.damageReduction)));
    expect(r.dealt).toBeLessThan(Math.round(20 * (1 - GUARDS.sword.damageReduction)));
  });
});
