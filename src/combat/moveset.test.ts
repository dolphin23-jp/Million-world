import { describe, expect, it } from 'vitest';
import { afterDodgeOf, classifyStick, pickAttack, pickChargeRelease, pickFollowUp } from './moveset';
import { DASH_WINDOW_FRAMES, STICK_RULES, SWORD_MOVESET } from './data/moveset';

const deg = (d: number) => (d * Math.PI) / 180;
const M = SWORD_MOVESET;

describe('classifyStick', () => {
  it('倒していなければ none（しきい値未満）', () => {
    expect(classifyStick(0, 0, 0, true)).toBe('none');
    expect(classifyStick(STICK_RULES.threshold - 0.01, 1, 0, true)).toBe('none');
    expect(classifyStick(STICK_RULES.threshold, 1, 0, true)).not.toBe('none');
  });

  it('ロックなしで倒していれば、向きに関わらず forward（攻撃は倒した向きを向いて始まる）', () => {
    for (const yaw of [0, 1, 2, 3, -2]) expect(classifyStick(1, yaw, 0, false)).toBe('forward');
  });

  it('ロック中は、対象の向きに対して 前 / 横 / 後ろ に分かれる', () => {
    const ref = deg(30);
    expect(classifyStick(1, ref, ref, true)).toBe('forward');
    expect(classifyStick(1, ref + deg(40), ref, true)).toBe('forward');
    expect(classifyStick(1, ref + deg(90), ref, true)).toBe('side');
    expect(classifyStick(1, ref - deg(90), ref, true)).toBe('side');
    expect(classifyStick(1, ref + deg(150), ref, true)).toBe('back');
    expect(classifyStick(1, ref + Math.PI, ref, true)).toBe('back');
  });

  it('角度の境界は ±π をまたいでも正しい（対象 yaw が π 付近）', () => {
    const ref = deg(175);
    expect(classifyStick(1, deg(-175), ref, true)).toBe('forward'); // 10° しか違わない
    expect(classifyStick(1, deg(-5), ref, true)).toBe('back'); // 180° 違う
  });

  it('前・後ろのしきいは STICK_RULES どおり（前は 50° まで、後ろは 130° から）', () => {
    expect(classifyStick(1, deg(STICK_RULES.forwardConeDeg - 1), 0, true)).toBe('forward');
    expect(classifyStick(1, deg(STICK_RULES.forwardConeDeg + 1), 0, true)).toBe('side');
    expect(classifyStick(1, deg(STICK_RULES.backConeDeg - 1), 0, true)).toBe('side');
    expect(classifyStick(1, deg(STICK_RULES.backConeDeg + 1), 0, true)).toBe('back');
  });
});

describe('pickAttack', () => {
  it('スティックなし → 弱攻撃、前 → 踏み込み、後ろ → 払い、横 → 横薙ぎ', () => {
    expect(pickAttack(M, { stick: 'none', afterDodge: null })).toBe(M.light);
    expect(pickAttack(M, { stick: 'forward', afterDodge: null })).toBe(M.lunge);
    expect(pickAttack(M, { stick: 'back', afterDodge: null })).toBe(M.retreat);
    expect(pickAttack(M, { stick: 'side', afterDodge: null })).toBe(M.sweep);
  });

  it('回避の直後は、スティックに関わらず回避に応じたダッシュの技', () => {
    for (const stick of ['none', 'forward', 'back', 'side'] as const) {
      expect(pickAttack(M, { stick, afterDodge: 'roll' })).toBe(M.dashRoll);
      expect(pickAttack(M, { stick, afterDodge: 'back' })).toBe(M.dashBack);
    }
  });

  it('技のセットが指す攻撃 id がすべて異なる役割を持つ（light は他と別）', () => {
    expect(new Set([M.light, M.lunge, M.retreat, M.sweep, M.dashRoll]).size).toBe(5);
  });
});

describe('afterDodgeOf', () => {
  it('回避が終わってから DASH_WINDOW_FRAMES 以内なら回避直後（種類つき）。過ぎたら null', () => {
    expect(afterDodgeOf(0, 'roll')).toBe('roll');
    expect(afterDodgeOf(DASH_WINDOW_FRAMES, 'back')).toBe('back');
    expect(afterDodgeOf(DASH_WINDOW_FRAMES + 1, 'roll')).toBeNull();
    expect(afterDodgeOf(999, 'back')).toBeNull();
  });
});

describe('pickFollowUp（コンボの次段の受付。ADR-023）', () => {
  const branches = { side: 'spin', back: 'hop' } as const;
  it('スティックを倒していなければ next（普通の続き）', () => {
    expect(pickFollowUp('combo2', branches, 'none')).toBe('combo2');
  });
  it('倒した向きに分岐があればそれ。なければ next', () => {
    expect(pickFollowUp('combo2', branches, 'side')).toBe('spin');
    expect(pickFollowUp('combo2', branches, 'back')).toBe('hop');
    expect(pickFollowUp('combo2', branches, 'forward')).toBe('combo2');
    expect(pickFollowUp('combo2', undefined, 'side')).toBe('combo2');
  });
  it('next の無い技（コンボの終わり）は、分岐のある向きに倒したときだけ続く', () => {
    const upper = { forward: 'upper' } as const;
    expect(pickFollowUp(undefined, upper, 'forward')).toBe('upper');
    expect(pickFollowUp(undefined, upper, 'none')).toBeUndefined();
    expect(pickFollowUp(undefined, upper, 'side')).toBeUndefined();
    expect(pickFollowUp(undefined, undefined, 'forward')).toBeUndefined();
  });
});

describe('pickChargeRelease（溜めを放つとき）', () => {
  it('段階に技の指定があればそれ、なければ next', () => {
    expect(pickChargeRelease('heavy', undefined, 2)).toBe('heavy');
    expect(pickChargeRelease('heavy', [undefined, undefined, 'smash'], 0)).toBe('heavy');
    expect(pickChargeRelease('heavy', [undefined, undefined, 'smash'], 1)).toBe('heavy');
    expect(pickChargeRelease('heavy', [undefined, undefined, 'smash'], 2)).toBe('smash');
    expect(pickChargeRelease('heavy', [undefined], 5)).toBe('heavy');
  });
});
