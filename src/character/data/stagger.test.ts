import { describe, expect, it } from 'vitest';
import { LEAD, pose } from './stagger';

describe('pose（体の部位を時間差で動かす）', () => {
  it('腰の回転 → 胸と頭 → 腕・剣の順に早く完了するキーへ分ける。腰の移動（沈み・前傾）は基準の時刻', () => {
    const keys = pose(0.3, 'in', {
      hips: { yaw: 10, pitch: 4, y: -0.1, z: 0.05 },
      chest: { yaw: 20 },
      head: { yaw: 5 },
      grip: [8, 12, 0.46],
    });
    const hipsRot = keys.find((k) => k.hips && k.hips.yaw !== undefined)!;
    const hipsMove = keys.find((k) => k.hips && k.hips.y !== undefined)!;
    const upper = keys.find((k) => k.chest)!;
    const arm = keys.find((k) => k.grip)!;
    expect(hipsRot.t).toBeCloseTo(0.3 - LEAD.hips, 9);
    expect(hipsRot.hips).toEqual({ yaw: 10, pitch: 4 });
    expect(hipsMove.t).toBeCloseTo(0.3, 9);
    expect(hipsMove.hips).toEqual({ y: -0.1, z: 0.05 });
    expect(upper.t).toBeCloseTo(0.3 - LEAD.chest, 9);
    expect(upper.head).toEqual({ yaw: 5 });
    expect(arm.t).toBeCloseTo(0.3, 9);
    // 腰 → 胸 → 腕の順（先行は常に「早める」向き）
    expect(hipsRot.t).toBeLessThan(upper.t);
    expect(upper.t).toBeLessThan(arm.t);
    for (const k of keys) expect(k.ease).toBe('in');
  });

  it('腰の回転が無ければ回転のキーを作らず、何も無ければキーなし。各部位は別のキーなので同じチャンネルに同時刻が重ならない', () => {
    expect(pose(0.2, 'lin', {})).toEqual([]);
    const onlyMove = pose(0.2, 'lin', { hips: { y: -0.05 } });
    expect(onlyMove).toHaveLength(1);
    expect(onlyMove[0]!.t).toBeCloseTo(0.2, 9);
    // 同じ ease・同じ時刻の 2 つのポーズを続けて置いても（頂点で一拍止めるときなど）、チャンネルごとの時刻は重ならない
    const a = pose(0.14, 'io', { hips: { yaw: 14, y: -0.05 }, chest: { yaw: 34 }, grip: [1, 2, 3] });
    const b = pose(0.17, 'lin', { hips: { yaw: 14, y: -0.05 }, chest: { yaw: 34 }, grip: [1, 2, 3] });
    const times = (ch: 'hips' | 'chest' | 'grip', field?: string) =>
      [...a, ...b]
        .filter((k) => (ch === 'hips' ? k.hips && (field === 'yaw' ? k.hips.yaw !== undefined : k.hips.y !== undefined) : k[ch]))
        .map((k) => k.t);
    for (const ts of [times('hips', 'yaw'), times('hips', 'y'), times('chest'), times('grip')]) {
      expect(new Set(ts.map((t) => t.toFixed(6))).size).toBe(ts.length);
    }
  });

  it('先行の時間は差し替えられる', () => {
    const keys = pose(0.5, 'out', { hips: { yaw: 3 }, chest: { yaw: 6 } }, { hips: 0.1, chest: 0.05 });
    expect(keys.find((k) => k.hips)!.t).toBeCloseTo(0.4, 9);
    expect(keys.find((k) => k.chest)!.t).toBeCloseTo(0.45, 9);
  });
});
