import type { AuthoredAttack } from '../authoring';
import { COMBO1 } from './combo1';
import { plane } from './cutting-plane';

/** 振り抜きの終わりのポーズ。受付が続くあいだ保つ（combo3 の continueFrom がこの姿勢 0.32s を指す） */
const FOLLOW = {
  hips: { yaw: 14, pitch: 3, z: 0.01, y: -0.1 },
  chest: { yaw: 26, pitch: 7 },
  head: { yaw: 10 },
  grip: [34, 32, 0.45] as [number, number, number],
  ...plane(88),
  pole: [-0.5, -0.85, -0.1] as [number, number, number],
  left: [-52, 10, 0.36] as [number, number, number],
  leftPole: [0.6, -0.7, 0.3] as [number, number, number],
};

/**
 * 2 段目: 右手の逆袈裟（左下から右上へ斬り上げる）に右足を踏み込む。1 段目の受付時点（0.37s）の姿勢から続けて始まる（continueFrom）。
 * 座標の約束は combo1.ts と同じ（胸の座標系、grip = [方位°, 仰角°, 距離 m]、plane(θ) = 斬りの面の中の刃）。
 *
 * 時間: 0 → 0.075 少し引いて溜める / 0.075 → 0.15 加速 / 0.15 → 0.23 斬り上げて減速（0.15 に体の前を通る最高速。当たりはその前後）/
 * 0.23 → 0.32 振り抜き / 0.32 → 0.45 姿勢を保って次段を待つ / 0.45 → 0.65 戻り。足は世界に固定（足の z はこの攻撃の開始時のルートからの前進量）。
 */
export const COMBO2: AuthoredAttack = {
  name: 'combo2',
  duration: 0.65,
  continueFrom: { attack: COMBO1, t: 0.37 },
  keys: [
    // ---- 下半身: 後ろにいた右足が前へ出る（弧）。左足は踏ん張って、戻りで揃える ----
    { t: 0.03, ease: 'lin', footR: { z: -0.3 }, rootZ: 0 },
    { t: 0.23, ease: 'io', footR: { z: 0.4, arc: 0.1 }, rootZ: 0.3 },
    { t: 0.45, ease: 'lin', footL: { z: 0 }, footR: { z: 0.4 } },
    { t: 0.65, ease: 'io', footL: { z: 0.3, arc: 0.1 }, footR: { z: 0.3, arc: 0.04 } },
    // ---- 溜め ----
    {
      t: 0.075,
      ease: 'io',
      hips: { yaw: -20, pitch: 7, z: 0.02, y: -0.1 },
      chest: { yaw: -38, pitch: 14 },
      head: { yaw: -12 },
      grip: [-58, -34, 0.42],
      ...plane(-82),
      pole: [-0.5, -0.8, 0],
      left: [-70, -25, 0.4],
      leftPole: [0.6, -0.8, 0],
    },
    // ---- 斬り上げ（0.15 に体の前を通る） ----
    {
      t: 0.15,
      ease: 'in',
      hips: { yaw: 0, pitch: 3, z: 0.03, y: -0.09 },
      chest: { yaw: 2, pitch: 6 },
      head: { yaw: 0 },
      grip: [6, 4, 0.46],
      ...plane(8),
      pole: [-0.3, -0.9, -0.2],
      left: [-70, -8, 0.42],
      leftPole: [0.6, -0.8, 0.1],
    },
    {
      t: 0.23,
      ease: 'out',
      hips: { yaw: 12, pitch: 3, z: 0.02, y: -0.1 },
      chest: { yaw: 22, pitch: 6 },
      head: { yaw: 8 },
      grip: [30, 28, 0.46],
      ...plane(80),
      pole: [-0.5, -0.85, -0.1],
      left: [-50, 8, 0.36],
      leftPole: [0.6, -0.7, 0.3],
    },
    // ---- 振り抜き（0.32 から 0.45 まで姿勢を保って次段を待つ。次段はこの姿勢から続く） ----
    { t: 0.32, ease: 'out', ...FOLLOW },
    { t: 0.45, ease: 'lin', ...FOLLOW },
    // ---- 戻り ----
    {
      t: 0.65,
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
