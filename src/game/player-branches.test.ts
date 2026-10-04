import { describe, expect, it } from 'vitest';
import { Player } from './player';
import { createEmptyIntent, type InputIntent } from '../input/intent';
import { ATTACKS, CHARGES } from '../combat/data/attacks';

/**
 * コンボの分岐（スティックの向きで続きが変わる）と、地面を叩く技の合図（ADR-023）の Player 結合テスト。
 * カメラ yaw = π のとき、スティックの上は +Z、右は −X、左は +X。ロック中は対象（0, 6）に対して 前 = +Z / 後ろ = −Z / 横 = ±X。
 */
const DT = 1 / 60;
const CAM_YAW = Math.PI;
const step = (p: Player, over: Partial<InputIntent> = {}, n = 1) => {
  for (let i = 0; i < n; i++) p.step(DT, { ...createEmptyIntent(), ...over }, CAM_YAW);
};
const press = (over: Partial<InputIntent> = {}): Partial<InputIntent> => ({ attackPressed: true, attackHeld: true, ...over });
const FORWARD = { moveX: 0, moveY: 1 };
const BACK = { moveX: 0, moveY: -1 };
const SIDE = { moveX: 1, moveY: 0 };

function make(loadout: 'sword' | 'greatsword', locked: boolean): Player {
  const p = new Player();
  expect(p.equip(loadout)).toBe(true);
  if (locked) p.setAim({ x: 0, z: 6 });
  return p;
}

/** 技 id の受付（cancelFrame）まで進めて、スティックを倒して攻撃を押す。押した後に始まった技の id（なければ null = 終わった）を返す */
function followUp(p: Player, stick: Partial<InputIntent>): string | null {
  const from = p.attack!.id;
  while (p.attack?.id === from && p.stateFrame < p.attackFrames!.cancelFrame) step(p);
  step(p, { attackPressed: true, ...stick });
  // 押した次のステップまでに続きが始まっていれば、その技（始まらなければ元の技のまま、または終わる）
  step(p, stick);
  if (p.state === 'attack' && p.attack!.id !== from) return p.attack!.id;
  return null;
}

/** 1 段目を出して、n 段目の受付まで進める（段ごとにそのまま押して連ねる） */
function chainTo(p: Player, ids: string[]): void {
  step(p, press());
  step(p, { attackHeld: false });
  for (let i = 1; i < ids.length; i++) {
    while (p.attack?.id === ids[i - 1] && p.stateFrame < p.attackFrames!.cancelFrame) step(p);
    step(p, { attackPressed: true });
    while (p.attack?.id === ids[i - 1]) step(p);
    expect(p.attack!.id).toBe(ids[i]);
  }
  while (p.stateFrame < p.attackFrames!.cancelFrame) step(p);
}

describe('片手剣のコンボの分岐', () => {
  it('1 段目の受付で、ロック中に後ろへ倒して押すと跳び退き斬り上げ（comboHop）。そのまま・前・横は 2 段目', () => {
    for (const [name, stick, want] of [
      ['後ろ', BACK, 'comboHop'],
      ['なし', {}, 'combo2'],
      ['前', FORWARD, 'combo2'],
      ['横', SIDE, 'combo2'],
    ] as const) {
      const p = make('sword', true);
      step(p, press());
      step(p, { attackHeld: false });
      expect(p.attack!.id).toBe('combo1');
      expect(followUp(p, stick), name).toBe(want);
    }
  });

  it('ロックなしでは「後ろ」「横」が無い（倒せば前）ので、1 段目の受付で何を倒しても 2 段目', () => {
    for (const stick of [BACK, SIDE, FORWARD, {}]) {
      const p = make('sword', false);
      step(p, press());
      step(p, { attackHeld: false });
      expect(followUp(p, stick)).toBe('combo2');
    }
  });

  it('2 段目の受付で、ロック中に横へ倒して押すと回転斬り（comboSpin）。そのまま・前・後ろは 3 段目', () => {
    for (const [stick, want] of [
      [SIDE, 'comboSpin'],
      [{ moveX: -1, moveY: 0 }, 'comboSpin'],
      [{}, 'combo3'],
      [FORWARD, 'combo3'],
      [BACK, 'combo3'],
    ] as const) {
      const p = make('sword', true);
      chainTo(p, ['combo1', 'combo2']);
      expect(followUp(p, stick), JSON.stringify(stick)).toBe(want);
    }
  });

  it('3 段目の受付で、前へ倒して押すと打ち上げ（comboUpper）。そのまま押すだけ・横・後ろでは続かない（3 連で終わる）', () => {
    for (const [stick, want] of [
      [FORWARD, 'comboUpper'],
      [{}, null],
      [SIDE, null],
      [BACK, null],
    ] as const) {
      const p = make('sword', true);
      chainTo(p, ['combo1', 'combo2', 'combo3']);
      expect(followUp(p, stick), JSON.stringify(stick)).toBe(want);
    }
  });

  it('打ち上げの後は、押せば落下斬り（comboSlam）が続く。その後は続かず、終わると待機に戻る（ADR-024）', () => {
    const p = make('sword', false);
    chainTo(p, ['combo1', 'combo2', 'combo3']);
    expect(followUp(p, FORWARD)).toBe('comboUpper');
    expect(followUp(p, {})).toBe('comboSlam');
    for (let i = 0; i < 120 && p.state === 'attack'; i++) step(p, { attackPressed: i % 4 === 0, ...FORWARD });
    expect(p.state === 'idle' || p.state === 'run').toBe(true);
  });

  it('盾を持っても同じ（分岐は装備の左手に関わらない）', () => {
    const p = new Player();
    expect(p.equip('sword-shield')).toBe(true);
    p.setAim({ x: 0, z: 6 });
    step(p, press());
    step(p, { attackHeld: false });
    expect(followUp(p, BACK)).toBe('comboHop');
  });
});

describe('大剣のコンボの分岐', () => {
  it('1 段目の受付で、ロック中に横へ倒して押すと連携回転斬り（gsSpin2）。そのまま・前・後ろは 2 段目', () => {
    for (const [stick, want] of [
      [SIDE, 'gsSpin2'],
      [{}, 'gs2'],
      [FORWARD, 'gs2'],
      [BACK, 'gs2'],
    ] as const) {
      const p = make('greatsword', true);
      step(p, press());
      step(p, { attackHeld: false });
      expect(followUp(p, stick), JSON.stringify(stick)).toBe(want);
    }
  });

  it('2 段目の受付で、前へ倒して押すと叩き落とし（gsDrop）。そのまま押すだけ・横・後ろでは続かない（2 連で終わる）', () => {
    for (const [stick, want] of [
      [FORWARD, 'gsDrop'],
      [{}, null],
      [SIDE, null],
      [BACK, null],
    ] as const) {
      const p = make('greatsword', true);
      chainTo(p, ['gs1', 'gs2']);
      expect(followUp(p, stick), JSON.stringify(stick)).toBe(want);
    }
  });

  it('ロックなしでも、2 段目の受付でスティックを倒せば（前扱い）叩き落とし', () => {
    const p = make('greatsword', false);
    chainTo(p, ['gs1', 'gs2']);
    expect(followUp(p, { moveX: 1, moveY: 0 })).toBe('gsDrop');
  });
});

describe('地面を叩く技の合図（Player.impactSerial）', () => {
  const c = CHARGES.greatsword!;
  const releaseAtMax = (p: Player) => {
    step(p, press());
    let n = 1;
    while (p.state !== 'charge' && n < 40) {
      step(p, { attackHeld: true });
      n++;
    }
    step(p, { attackHeld: true }, c.frames);
    while (p.chargeLevel < c.levels.length) step(p, { attackHeld: true });
    step(p); // 離す
    expect(p.attack!.id).toBe('gsSmash');
  };

  it('地割りは、剣が床に当たる時刻に 1 回だけ合図を出す。位置は体の前 dist、強さは impact.power × 溜めの倍率', () => {
    const p = make('greatsword', false);
    releaseAtMax(p);
    const a = ATTACKS.gsSmash!;
    const frame = Math.round((a.impact!.t * 60) / a.rate);
    const before = p.impactSerial;
    const seen: number[] = [];
    let expected: { x: number; z: number } | null = null;
    while (p.state === 'attack') {
      const s = p.impactSerial;
      // 合図は step の中の移動の前に出るので、位置はその step を始める前の体の前
      const x0 = p.body.x;
      const z0 = p.body.z;
      const yaw = p.yaw;
      step(p);
      if (p.impactSerial !== s) {
        seen.push(p.stateFrame);
        expected = { x: x0 + Math.sin(yaw) * a.impact!.dist, z: z0 + Math.cos(yaw) * a.impact!.dist };
      }
    }
    expect(p.impactSerial).toBe(before + 1);
    expect(seen).toEqual([frame]); // 描画されている姿勢の時刻（stateFrame）が床に当たる時刻
    expect(p.lastImpact.power).toBeCloseTo(a.impact!.power * c.levelPower[c.levels.length]!, 9);
    expect(p.lastImpact.x).toBeCloseTo(expected!.x, 9);
    expect(p.lastImpact.z).toBeCloseTo(expected!.z, 9);
  });

  it('叩き落とし（gsDrop）も 1 回。ほかの技（gs1・gs2・溜め斬り）は合図を出さない', () => {
    const p = make('greatsword', false);
    const s0 = p.impactSerial;
    chainTo(p, ['gs1', 'gs2']);
    followUp(p, FORWARD);
    expect(p.attack!.id).toBe('gsDrop');
    while (p.state === 'attack') step(p);
    expect(p.impactSerial).toBe(s0 + 1);

    const q = make('greatsword', false);
    step(q, press());
    step(q, { attackHeld: false });
    while (q.state === 'attack') step(q, { attackPressed: q.attack?.id === 'gs1' && q.stateFrame >= q.attackFrames!.cancelFrame });
    expect(q.impactSerial).toBe(0);
  });

  it('途中で被弾すると、床に当たる前なら合図は出ない', () => {
    const p = make('greatsword', false);
    releaseAtMax(p);
    step(p, {}, 3);
    p.takeHit({ attackerId: 1, targetId: 0, damage: 5, knockback: 0.5, hitStop: 4, dirX: 0, dirZ: -1, x: 0, z: 0 });
    while (p.state !== 'idle' && p.state !== 'run') step(p);
    expect(p.impactSerial).toBe(0);
  });
});

describe('連携の続きの技（ADR-024）', () => {
  /** 始動の技を出して（スティック stick）、その受付まで進める */
  const start = (loadout: 'sword' | 'greatsword', stick: Partial<InputIntent>): Player => {
    const p = make(loadout, true);
    step(p, press(stick));
    step(p, { attackHeld: false, ...stick });
    return p;
  };

  it('横薙ぎ → 返し薙ぎ、踏み込み突き → 抜き払い（そのまま押す）。受付を逃すと続かない', () => {
    const a = start('sword', SIDE);
    expect(a.attack!.id).toBe('sweep');
    expect(followUp(a, {})).toBe('sweepBack');
    const b = start('sword', FORWARD);
    expect(b.attack!.id).toBe('lunge');
    expect(followUp(b, {})).toBe('lungeSlash');
    // 続きの後は続かない（2 連で終わる）
    expect(followUp(b, {})).toBeNull();
  });

  it('跳び退き斬り上げの受付で前へ倒すと飛び込み突き。そのまま押しても続かない', () => {
    for (const [stick, want] of [[FORWARD, 'hopThrust'], [{}, null], [BACK, null]] as const) {
      const p = make('sword', true);
      step(p, press());
      step(p, { attackHeld: false });
      expect(followUp(p, BACK)).toBe('comboHop');
      expect(followUp(p, stick), JSON.stringify(stick)).toBe(want);
    }
  });

  it('大剣: 踏み込み突き → 突き払い、斬り上げ → 飛翔叩きつけ（そのまま）、下がりながらの薙ぎ払い → 前で飛び込み突き', () => {
    const a = start('greatsword', FORWARD);
    expect(a.attack!.id).toBe('gsLunge');
    expect(followUp(a, {})).toBe('gsLungeSweep');
    const b = start('greatsword', BACK);
    expect(b.attack!.id).toBe('gsRetreat');
    expect(followUp(b, {})).toBeNull(); // そのまま押しても続かない（前へ倒したときだけ）
    const c = start('greatsword', BACK);
    expect(followUp(c, FORWARD)).toBe('gsRetreatLunge');
  });

  it('連携の履歴（Player.chain）: 受付から続けた技は足され、始動の技からやり直すと 1 つに戻る', () => {
    const p = make('sword', true);
    step(p, press());
    step(p, { attackHeld: false });
    expect(p.chain).toEqual(['combo1']);
    followUp(p, BACK);
    expect(p.chain).toEqual(['combo1', 'comboHop']);
    followUp(p, FORWARD);
    expect(p.chain).toEqual(['combo1', 'comboHop', 'hopThrust']);
    // 終わるまで待って、あらためて始める
    for (let i = 0; i < 120 && p.state === 'attack'; i++) step(p);
    step(p, press());
    expect(p.chain).toEqual(['combo1']);
  });

  it('stickDir は直近のスティックの向き（ロック中は対象に対して）、locked と afterDodge も読める（操作ガイドが使う）', () => {
    const p = make('sword', true);
    step(p, BACK);
    expect(p.stickDir).toBe('back');
    step(p, SIDE);
    expect(p.stickDir).toBe('side');
    step(p, {});
    expect(p.stickDir).toBe('none');
    expect(p.locked).toBe(true);
    expect(p.afterDodge).toBeNull();
    const q = make('sword', false);
    step(q, BACK);
    expect(q.stickDir).toBe('forward'); // ロックなしは倒していれば前
    expect(q.locked).toBe(false);
  });
});
