import type { AuthoredAttack } from '../authoring';
import { COMBO2 } from './combo2';

/**
 * 3 段目（フィニッシュ）: 右手の突き。右足を大きく踏み込んで、剣を引き絞ってから体ごと前へ伸びる。
 * 2 段目の受付時点（0.32s）の姿勢から続けて始まる（continueFrom）。座標の約束は combo1.ts と同じ（胸の座標系）。
 * 剣の向きは胸の座標系で書くので、体のひねり（chest.yaw）を打ち消して「ワールドで前」を向くようにしてある
 * （右へ yaw したとき、胸の座標系での「ワールド前」は左へ同じだけ振れる: [sin(yaw), 0, cos(yaw)]）。
 *
 * 時間: 0 → 0.1 右へひねって剣を右腰へ引き絞る（0.1〜0.13 は頂点で一拍）/ 0.13 → 0.18 突き出す（0.18 に最高速）/ 0.18 → 0.24 伸び切る /
 * 0.24 → 0.34 余韻 / 0.34 → 0.62 戻り。足は世界に固定。ルートは突きで 0.3 m 進む。
 */
const CHAMBER = {
  hips: { yaw: 20, pitch: 2, z: -0.02, y: -0.14 },
  chest: { yaw: 36, pitch: 4 },
  head: { yaw: 10 },
  grip: [50, -8, 0.3] as [number, number, number],
  blade: [0.588, 0.1, 0.8] as [number, number, number],
  face: [0, 1, 0] as [number, number, number],
  roll: 0,
  pole: [-0.5, -0.85, -0.1] as [number, number, number],
  left: [-45, -18, 0.34] as [number, number, number],
  leftPole: [0.6, -0.7, 0.3] as [number, number, number],
};

export const COMBO3: AuthoredAttack = {
  name: 'combo3',
  duration: 0.62,
  continueFrom: { attack: COMBO2, t: 0.32 },
  keys: [
    // ---- 下半身: 前足（右）が踏み込み、後ろ足（左）は小さく浮かせて引き寄せる。戻りで両足がルートの真下に揃う ----
    { t: 0.13, ease: 'lin', footR: { z: 0.1 }, footL: { z: -0.3 }, rootZ: 0 },
    { t: 0.22, ease: 'io', footR: { z: 0.45, arc: 0.05 }, footL: { z: -0.2, arc: 0.03 }, rootZ: 0.3 },
    { t: 0.34, ease: 'lin', footL: { z: -0.2 }, footR: { z: 0.45 } },
    { t: 0.62, ease: 'io', footL: { z: 0.3, arc: 0.12 }, footR: { z: 0.3, arc: 0.04 } },
    // ---- 引き絞り（頂点で一拍止めて、突きを鋭くする） ----
    { t: 0.1, ease: 'io', ...CHAMBER },
    { t: 0.13, ease: 'lin', ...CHAMBER },
    // ---- 突き ----
    {
      t: 0.18,
      ease: 'in',
      hips: { yaw: -8, pitch: 4, z: 0.04, y: -0.16 },
      chest: { yaw: -8, pitch: 8 },
      head: { yaw: -4 },
      grip: [8, 6, 0.46],
      blade: [-0.139, 0.06, 0.99],
      face: [0, 1, 0],
      roll: 0,
      pole: [-0.4, -0.9, -0.1],
      left: [-62, -22, 0.34],
      leftPole: [0.6, -0.7, 0.3],
    },
    {
      t: 0.24,
      ease: 'out',
      hips: { yaw: -10, pitch: 4, z: 0.05, y: -0.16 },
      chest: { yaw: -10, pitch: 9 },
      head: { yaw: -5 },
      grip: [8, 6, 0.48],
      blade: [-0.174, 0.06, 0.983],
      face: [0, 1, 0],
      roll: 0,
      pole: [-0.4, -0.9, -0.1],
      left: [-66, -24, 0.34],
    },
    // ---- 戻り ----
    {
      t: 0.62,
      ease: 'io',
      hips: { yaw: 0, pitch: 0, z: 0, y: 0 },
      chest: { yaw: 0, pitch: 0 },
      head: { yaw: 0 },
      grip: 'idle',
      blade: 'idle',
      pole: 'idle',
      left: 'idle',
      leftPole: 'idle',
    },
  ],
};
