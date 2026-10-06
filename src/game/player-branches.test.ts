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
    // そのまま押すだけ（前へ倒さない）では、落下斬りで連携は終わる（前へ倒すと地擦り斬り上げへ延びる。ADR-047）
    for (let i = 0; i < 120 && p.state === 'attack'; i++) step(p, { attackPressed: i % 4 === 0 });
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

describe('連携の続き 第 2 弾（ADR-047）: 片手剣は最大 7 連、大剣は最大 5 連', () => {
  it('片手剣 7 連: 袈裟 → 逆袈裟 → 突き →（前）打ち上げ → 落下斬り →（前）地擦り斬り上げ → 燕返し。ロックなしで、前へ倒して連打するだけで届く', () => {
    const p = make('sword', false);
    chainTo(p, ['combo1', 'combo2', 'combo3']);
    expect(followUp(p, FORWARD)).toBe('comboUpper');
    expect(followUp(p, FORWARD)).toBe('comboSlam');
    expect(followUp(p, FORWARD)).toBe('slamRip');
    expect(followUp(p, FORWARD)).toBe('swallow');
    expect(p.chain).toEqual(['combo1', 'combo2', 'combo3', 'comboUpper', 'comboSlam', 'slamRip', 'swallow']);
    // 燕返しで連携は終わる（続きは無い）。終わると待機に戻る
    expect(followUp(p, FORWARD)).toBeNull();
    for (let i = 0; i < 120 && p.state === 'attack'; i++) step(p);
    expect(p.state === 'idle' || p.state === 'run').toBe(true);
  });

  it('落下斬りの受付は、前へ倒したときだけ地擦り斬り上げへ続く。そのまま押すだけ・横・後ろでは続かない（5 連で終わる）', () => {
    for (const [stick, want] of [[FORWARD, 'slamRip'], [{}, null], [SIDE, null], [BACK, null]] as const) {
      const p = make('sword', true);
      chainTo(p, ['combo1', 'combo2', 'combo3']);
      expect(followUp(p, FORWARD)).toBe('comboUpper');
      expect(followUp(p, {})).toBe('comboSlam');
      expect(followUp(p, stick), JSON.stringify(stick)).toBe(want);
    }
  });

  it('地擦り斬り上げは、押せば燕返しへ続く（連打）。燕返しは 2 つの当たりの窓を持つ', () => {
    const p = make('sword', false);
    chainTo(p, ['combo1', 'combo2', 'combo3']);
    followUp(p, FORWARD);
    followUp(p, {});
    followUp(p, FORWARD);
    expect(p.attack!.id).toBe('slamRip');
    expect(followUp(p, {})).toBe('swallow');
    expect(p.attackFrames!.windows).toHaveLength(2);
  });

  it('片手剣の旋風（5 連）: 袈裟 → 逆袈裟 →（横）回転斬り →（横）逆回転斬り → 回転斬り上げ。ロック中だけ。回転斬りの受付で前・後ろ・そのまま押すだけでは続かない', () => {
    const p = make('sword', true);
    chainTo(p, ['combo1', 'combo2']);
    expect(followUp(p, SIDE)).toBe('comboSpin');
    expect(followUp(p, SIDE)).toBe('spinRev');
    expect(followUp(p, {})).toBe('spinRise');
    expect(p.chain).toEqual(['combo1', 'combo2', 'comboSpin', 'spinRev', 'spinRise']);
    for (const stick of [{}, FORWARD, BACK]) {
      const q = make('sword', true);
      chainTo(q, ['combo1', 'combo2']);
      expect(followUp(q, SIDE)).toBe('comboSpin');
      expect(followUp(q, stick), JSON.stringify(stick)).toBeNull();
    }
  });

  it('ロックなしでは「横」が無いので、回転斬りから逆回転斬りへは続かない（2 段目で横へ倒しても逆袈裟の続きの突きになる）', () => {
    const p = make('sword', false);
    chainTo(p, ['combo1', 'combo2']);
    expect(followUp(p, SIDE)).toBe('combo3');
  });

  it('大剣 5 連: 袈裟 → 逆袈裟 →（前）叩き落とし →（前）跳ね上げ → 大叩き割り。ロックなしで、前へ倒して連打するだけで届く', () => {
    const p = make('greatsword', false);
    chainTo(p, ['gs1', 'gs2']);
    expect(followUp(p, FORWARD)).toBe('gsDrop');
    expect(followUp(p, FORWARD)).toBe('gsBounce');
    expect(followUp(p, FORWARD)).toBe('gsCrush');
    expect(p.chain).toEqual(['gs1', 'gs2', 'gsDrop', 'gsBounce', 'gsCrush']);
    expect(followUp(p, FORWARD)).toBeNull();
  });

  it('叩き落としの受付は前へ倒したときだけ跳ね上げへ続く（そのまま押すだけ・横・後ろでは続かない）', () => {
    for (const [stick, want] of [[FORWARD, 'gsBounce'], [{}, null], [SIDE, null], [BACK, null]] as const) {
      const p = make('greatsword', true);
      chainTo(p, ['gs1', 'gs2']);
      expect(followUp(p, FORWARD)).toBe('gsDrop');
      expect(followUp(p, stick), JSON.stringify(stick)).toBe(want);
    }
  });

  it('大剣の旋風（4 連）: 袈裟 →（横）連携回転斬り →（横）逆の大回転 →（前）回転叩きつけ。逆の大回転の受付で、そのまま押すだけ・横・後ろでは続かない', () => {
    const p = make('greatsword', true);
    step(p, press());
    step(p, { attackHeld: false });
    expect(followUp(p, SIDE)).toBe('gsSpin2');
    expect(followUp(p, SIDE)).toBe('gsSpin3');
    expect(followUp(p, FORWARD)).toBe('gsSpinSlam');
    expect(p.chain).toEqual(['gs1', 'gsSpin2', 'gsSpin3', 'gsSpinSlam']);
    for (const stick of [{}, SIDE, BACK]) {
      const q = make('greatsword', true);
      step(q, press());
      step(q, { attackHeld: false });
      followUp(q, SIDE);
      expect(followUp(q, SIDE)).toBe('gsSpin3');
      expect(followUp(q, stick), JSON.stringify(stick)).toBeNull();
    }
  });

  it('大剣の踏み込み突き → 突き払い → 薙ぎ返し（そのまま押すだけの 3 連）', () => {
    const p = make('greatsword', true);
    step(p, press(FORWARD));
    step(p, { attackHeld: false, ...FORWARD });
    expect(p.attack!.id).toBe('gsLunge');
    expect(followUp(p, {})).toBe('gsLungeSweep');
    expect(followUp(p, {})).toBe('gsReturnSweep');
    expect(followUp(p, {})).toBeNull();
  });

  it('盾を持つ片手剣でも、7 連は同じ（続きの技は盾版も焼かれる）', () => {
    const p = new Player();
    expect(p.equip('sword-shield')).toBe(true);
    chainTo(p, ['combo1', 'combo2', 'combo3']);
    for (const want of ['comboUpper', 'comboSlam', 'slamRip', 'swallow']) expect(followUp(p, FORWARD)).toBe(want);
  });

  it('連携の履歴（Player.chain）は 7 連まで残る（MAX_CHAIN は 7 連より長い）', () => {
    const p = make('sword', false);
    chainTo(p, ['combo1', 'combo2', 'combo3']);
    for (let i = 0; i < 4; i++) followUp(p, FORWARD);
    expect(p.chain).toHaveLength(7);
    expect(p.chain[0]).toBe('combo1');
  });
});
