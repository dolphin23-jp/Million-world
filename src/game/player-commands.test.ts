import { describe, expect, it } from 'vitest';
import { Player } from './player';
import { createEmptyIntent, type InputIntent } from '../input/intent';
import { ATTACKS, CHARGES, DODGES } from '../combat/data/attacks';
import { CHARGE_HOLD_FRAMES, DASH_WINDOW_FRAMES } from '../combat/data/moveset';
import { wrapAngle } from '../core/math';

/**
 * 攻撃ボタンで出る技（ADR-018）の Player 結合テスト: スティック・ロック・回避直後による技の選択と、長押しの溜め。
 * カメラ yaw = π のとき、スティックの上は +Z、右は −X、左は +X
 */
const DT = 1 / 60;
const CAM_YAW = Math.PI;
const step = (p: Player, over: Partial<InputIntent> = {}, n = 1) => {
  for (let i = 0; i < n; i++) p.step(DT, { ...createEmptyIntent(), ...over }, CAM_YAW);
};
const near = (a: number, b: number) => Math.abs(wrapAngle(a - b)) < 1e-6;
const press = (over: Partial<InputIntent> = {}): Partial<InputIntent> => ({ attackPressed: true, attackHeld: true, ...over });

describe('攻撃ボタンで出る技の選択', () => {
  it('スティックなしは弱攻撃の 1 段目', () => {
    const p = new Player();
    step(p, press());
    expect(p.state).toBe('attack');
    expect(p.attack!.id).toBe('combo1');
  });

  it('ロックなしでスティックを倒して攻撃すると、倒した向きへ踏み込み', () => {
    const p = new Player();
    step(p, press({ moveX: -1, moveY: 0 })); // 画面の左 = +X
    expect(p.attack!.id).toBe('lunge');
    expect(near(p.yaw, Math.PI / 2)).toBe(true);
  });

  it('ロック中は対象に対する向きで決まる: 前 = 踏み込み / 後ろ = 下がりながらの払い / 横 = 横薙ぎ。向きは対象のまま', () => {
    const cases: [string, Partial<InputIntent>][] = [
      ['lunge', { moveX: 0, moveY: 1 }],
      ['retreat', { moveX: 0, moveY: -1 }],
      ['sweep', { moveX: 1, moveY: 0 }],
      ['sweep', { moveX: -1, moveY: 0 }],
    ];
    for (const [id, stick] of cases) {
      const p = new Player();
      p.setAim({ x: 0, z: 6 });
      step(p, press(stick));
      expect(p.attack!.id, JSON.stringify(stick)).toBe(id);
      expect(near(p.yaw, 0), JSON.stringify(stick)).toBe(true);
    }
  });

  it('ロール直後の攻撃はダッシュ斬り。回避の途中（キャンセル可能になってから）に押しても同じ', () => {
    // 終わってから押す
    const a = new Player();
    step(a, { dodgePressed: true, moveX: 0, moveY: 1 });
    expect(a.dodgeKind).toBe('roll');
    step(a, {}, DODGES.roll.frames);
    expect(a.state).toBe('idle');
    step(a, press());
    expect(a.attack!.id).toBe('dash');
    // 途中で押す（先行入力）
    const b = new Player();
    step(b, { dodgePressed: true, moveX: 0, moveY: 1 });
    step(b, press(), 2);
    expect(b.state).toBe('dodge');
    while (b.state === 'dodge') step(b);
    expect(b.attack!.id).toBe('dash');
  });

  it('後ろステップ直後の攻撃は踏み込み（追い斬り）', () => {
    const p = new Player();
    step(p, { dodgePressed: true });
    expect(p.dodgeKind).toBe('back');
    step(p, {}, DODGES.back.frames);
    step(p, press());
    expect(p.attack!.id).toBe('lunge');
  });

  it(`回避が終わって ${DASH_WINDOW_FRAMES}f を過ぎると、ふつうの 1 段目に戻る`, () => {
    const p = new Player();
    step(p, { dodgePressed: true, moveX: 0, moveY: 1 });
    step(p, {}, DODGES.roll.frames);
    step(p, {}, DASH_WINDOW_FRAMES + 2);
    step(p, press());
    expect(p.attack!.id).toBe('combo1');
  });

  it('ダッシュ斬りを出したあとの攻撃は、回避直後にならない', () => {
    const p = new Player();
    step(p, { dodgePressed: true, moveX: 0, moveY: 1 });
    step(p, press(), 2);
    while (p.state === 'dodge') step(p);
    expect(p.attack!.id).toBe('dash');
    step(p, {}, ATTACKS.dash!.activeEnd * 60 + 90); // 技を終えるまで待つ
    expect(p.state).toBe('idle');
    step(p, press());
    expect(p.attack!.id).toBe('combo1');
  });

  it('コンボの 2 段目以降は、スティックを倒していても連なる（技の選択を通らない）', () => {
    const p = new Player();
    step(p, press());
    step(p, { attackHeld: false });
    while (p.stateFrame < p.attackFrames!.cancelFrame) step(p);
    step(p, { attackPressed: true, moveX: -1, moveY: 0 });
    while (p.attack?.id === 'combo1') step(p, { moveX: -1, moveY: 0 });
    expect(p.attack!.id).toBe('combo2');
  });
});

describe('長押しの溜め', () => {
  const c = CHARGES.sword!;
  /** 攻撃を押したまま、溜めの構えに入るまで進める */
  const enterCharge = (p: Player, over: Partial<InputIntent> = {}) => {
    step(p, press(over));
    let n = 1;
    while (p.state !== 'charge' && n < 40) {
      step(p, { attackHeld: true, ...over });
      n++;
    }
    return n;
  };

  it(`${CHARGE_HOLD_FRAMES}f 押し続けると溜めの構えに入る（1 段目の斬りが出る前）。構えのあいだは動けない`, () => {
    const p = new Player();
    const n = enterCharge(p);
    expect(p.state).toBe('charge');
    expect(n).toBeGreaterThanOrEqual(CHARGE_HOLD_FRAMES);
    expect(n).toBeLessThanOrEqual(CHARGE_HOLD_FRAMES + 2);
    expect(p.attackActive).toBe(false);
    const z = p.body.z;
    step(p, { attackHeld: true, moveX: 0, moveY: 1 }, 30);
    expect(p.state).toBe('charge');
    expect(Math.abs(p.body.z - z)).toBeLessThan(0.05);
  });

  it('すぐ離せば（タップ）ふつうの 1 段目のまま。溜めには入らない', () => {
    const p = new Player();
    step(p, press());
    const states = new Set<string>();
    for (let i = 0; i < 70; i++) {
      step(p);
      states.add(p.state);
    }
    expect(states.has('charge')).toBe(false);
    expect(p.attackActive || p.state === 'idle').toBe(true);
  });

  it('途中で離して押し直しても溜めに入らない（連打で暴発しない）', () => {
    const p = new Player();
    step(p, press(), 3);
    step(p, { attackHeld: false }, 2);
    const states = new Set<string>();
    for (let i = 0; i < 60; i++) {
      step(p, { attackHeld: true });
      states.add(p.state);
    }
    expect(states.has('charge')).toBe(false);
  });

  it('2 段目以降を押し続けても溜めには入らない', () => {
    const p = new Player();
    step(p, press());
    step(p, { attackHeld: false });
    while (p.stateFrame < p.attackFrames!.cancelFrame) step(p);
    step(p, press());
    const states = new Set<string>();
    for (let i = 0; i < 80; i++) {
      step(p, { attackHeld: true });
      states.add(p.state);
    }
    expect(states.has('charge')).toBe(false);
  });

  it('保持の長さで段階が上がる（構えが整ってから levels のフレーム数ごと）', () => {
    const p = new Player();
    enterCharge(p);
    expect(p.chargeLevel).toBe(0);
    // 構えが整うまでは段階は上がらない
    step(p, { attackHeld: true }, c.frames);
    expect(p.chargeLevel).toBe(0);
    // 段階は「構えが整ってからの保持フレーム ≧ levels[i]」で上がる。stateFrame は step の後に進むので、上がるのは need の次の step（need 〜 need + 1）
    c.levels.forEach((need, i) => {
      while (p.chargeLevel === i) step(p, { attackHeld: true });
      const held = p.stateFrame - c.frames;
      expect(held, `段階 ${i + 1}`).toBeGreaterThanOrEqual(need);
      expect(held, `段階 ${i + 1}`).toBeLessThanOrEqual(need + 1);
    });
    expect(p.chargeLevel).toBe(c.levels.length);
  });

  it('離すと重撃を放つ。威力は離した時点の段階の倍率', () => {
    for (let level = 0; level <= c.levels.length; level++) {
      const p = new Player();
      enterCharge(p);
      // 構えが整うまで進め、目的の段階に上がったらすぐ離す
      step(p, { attackHeld: true }, c.frames);
      while (p.chargeLevel < level) step(p, { attackHeld: true });
      expect(p.chargeLevel).toBe(level);
      step(p); // 離す
      expect(p.state, `段階 ${level}`).toBe('attack');
      expect(p.attack!.id).toBe(c.next);
      expect(p.attackPower).toBe(c.levelPower[level]);
      expect(p.charge).toBeNull();
    }
  });

  it('構えが整う前に離しても、整うまで待ってから放つ', () => {
    const p = new Player();
    enterCharge(p);
    step(p, {}, 2);
    expect(p.state).toBe('charge');
    step(p, {}, c.frames);
    expect(p.state).toBe('attack');
    expect(p.attack!.id).toBe(c.next);
    expect(p.attackPower).toBe(c.levelPower[0]);
  });

  it('最大保持に達したら、押したままでも自動で放つ（最高段階）', () => {
    const p = new Player();
    enterCharge(p);
    step(p, { attackHeld: true }, c.frames + c.maxHoldFrames - p.stateFrame + 1);
    expect(p.state).toBe('attack');
    expect(p.attack!.id).toBe(c.next);
    expect(p.attackPower).toBe(c.levelPower[c.levels.length]);
  });

  it('構えに入って dodgeCancelFrame 以降は、回避でキャンセルできる（向きは入力）', () => {
    const early = new Player();
    enterCharge(early);
    step(early, { attackHeld: true }, c.dodgeCancelFrame - early.stateFrame - 1);
    step(early, { attackHeld: true, dodgePressed: true });
    expect(early.state).toBe('charge');

    const p = new Player();
    enterCharge(p);
    step(p, { attackHeld: true }, c.dodgeCancelFrame - p.stateFrame);
    step(p, { attackHeld: true, dodgePressed: true, moveX: -1, moveY: 0 });
    expect(p.state).toBe('dodge');
    expect(p.dodgeKind).toBe('roll');
    expect(p.charge).toBeNull();
    expect(p.chargeLevel).toBe(0);
    // キャンセルのあとに押し続けていても、また重撃は出ない
    step(p, { attackHeld: true }, 5);
    expect(p.attack).toBeNull();
  });

  it('放った重撃のあと、次の攻撃の威力は等倍に戻る', () => {
    const p = new Player();
    enterCharge(p);
    step(p, { attackHeld: true }, c.frames);
    while (p.chargeLevel < c.levels.length) step(p, { attackHeld: true });
    step(p);
    expect(p.attackPower).toBeGreaterThan(1);
    while (p.state === 'attack') step(p);
    step(p, press());
    expect(p.attack!.id).toBe('combo1');
    expect(p.attackPower).toBe(1);
  });

  it('ロック中は構えのあいだも対象のほうへ向き直る', () => {
    const p = new Player();
    enterCharge(p);
    p.setAim({ x: 6, z: 0 }); // 対象は +X
    step(p, { attackHeld: true }, 60);
    // 構えへ入るまでに少し前へ出ているので、対象の向きとは数 mrad ずれる
    expect(Math.abs(wrapAngle(p.yaw - Math.PI / 2))).toBeLessThan(0.05);
  });
});
