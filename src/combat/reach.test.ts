import { describe, expect, it } from 'vitest';
import { verticalReach } from './reach';
import { REACH } from './data/reach';

describe('verticalReach: 近接が縦に届くか', () => {
  it('同じ地面なら届く（足の高さが同じ）', () => {
    expect(verticalReach(0, 1.7, 0, 1.7)).toBe(true);
    expect(verticalReach(0, 1.15, 0, 1.7)).toBe(true);
  });

  it('相手の足が、攻撃者の背の高さ + 腕より上にあれば届かない。ちょうどなら届く', () => {
    const top = 1.7 + REACH.above;
    expect(verticalReach(0, 1.7, top, 1.7)).toBe(true);
    expect(verticalReach(0, 1.7, top + 0.01, 1.7)).toBe(false);
    // 背の低い敵は届かない（猪 1.15m → 1.45m まで）
    expect(verticalReach(0, 1.15, 1.46, 1.7)).toBe(false);
    expect(verticalReach(0, 2.6, 2.2, 1.7)).toBe(true); // 背の高い敵（岩鬼）は壇（2.2m）の上のプレイヤーに届く
  });

  it('相手の頭が、攻撃者の足の少し下より下なら届かない（上から低い相手へ）', () => {
    // 足が 2.2m のプレイヤーの剣は、背 1.7m の敵（頭 1.7m）には届かない（2.2 − 0.3 = 1.9 > 1.7）
    expect(verticalReach(2.2, 1.7, 0, 1.7)).toBe(false);
    // 足が 1.5m なら届く（1.5 − 0.3 = 1.2 ≤ 1.7）
    expect(verticalReach(1.5, 1.7, 0, 1.7)).toBe(true);
    // 背の高い敵（頭 2.6m）には届く
    expect(verticalReach(2.2, 1.7, 0, 2.6)).toBe(true);
  });

  it('飛ぶ敵（足 1.8m）と地面のプレイヤーは、互いに届く', () => {
    expect(verticalReach(1.8, 1.6, 0, 1.7)).toBe(true); // 蝙蝠 → プレイヤー（頭 1.7 ≥ 蝙蝠の足 1.8 − 0.3）
    expect(verticalReach(0, 1.7, 1.8, 1.6)).toBe(true); // プレイヤー → 蝙蝠（1.7 + 0.3 = 2.0 ≥ 1.8）
  });

  it('reachTop: 攻撃者の足からその高さまでしか届かない（低い攻撃。跳んでいる相手には当たらない）', () => {
    expect(verticalReach(0, 1.15, 0, 1.7, 0.6)).toBe(true);
    expect(verticalReach(0, 1.15, 0.5, 1.7, 0.6)).toBe(true);
    expect(verticalReach(0, 1.15, 0.7, 1.7, 0.6)).toBe(false);
    // 攻撃者が高い所にいれば、その足から測る
    expect(verticalReach(1.0, 1.15, 1.5, 1.7, 0.6)).toBe(true);
    expect(verticalReach(1.0, 1.15, 1.7, 1.7, 0.6)).toBe(false);
  });
});
