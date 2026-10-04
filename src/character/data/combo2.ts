import type { AuthoredAttack } from '../authoring';
import { COMBO1 } from './combo1';
import { plane } from './cutting-plane';
import { OFFHAND } from './offhand';
import { pose } from './stagger';

/** 振り抜きの終わりのポーズ。受付が続くあいだ保つ（combo3 の continueFrom がこの姿勢 0.34s を指す） */
export const FOLLOW = {
  hips: { yaw: 14, pitch: 6, z: 0.05, y: -0.1 },
  chest: { yaw: 26, pitch: 11 },
  head: { yaw: 10 },
  grip: [34, 32, 0.45] as [number, number, number],
  ...plane(88),
  pole: [-0.5, -0.85, -0.1] as [number, number, number],
  ...OFFHAND.guard,
};

/**
 * 2 段目: 右手の逆袈裟（左下から右上へ斬り上げる）に右足を踏み込む。1 段目の受付時点（0.37s）の姿勢から続けて始まる（continueFrom）。
 * 座標の約束は combo1.ts と同じ（胸の座標系、grip = [方位°, 仰角°, 距離 m]、plane(θ) = 斬りの面の中の刃）。
 *
 * 時間: 0 → 0.09 少し引いて溜める（右足が床を離れて前へ出る） / 0.09 → 0.17 加速 / 0.17 → 0.25 斬り上げて減速（0.17 に体の前を通る最高速。当たりはその前後。
 * 右足は 0.16 に着地） / 0.25 → 0.34 振り抜き / 0.34 → 0.47 姿勢を保って次段を待つ / 0.47 → 0.67 戻り。
 * 足は世界に固定（足の z はこの攻撃の開始時のルートからの前進量）。
 *
 * 踏み込み: 1 段目の終わり（右足が腰の後ろ 0.26 m）から、右足が 0.9 m 前へ弧を描いて腰の 0.3 m 前へ着地する（足は最高 9.6 m/s で運ぶ。踏み込みの幅 0.53 m）。
 * 左足は残して腰が前へ抜け、着地のあとに引きつける。ルートは 0.02 から加速して 0.16（着地）までに 0.34 m、そのあと減速して 0.26 までに 0.58 m（以降は止める）。
 * 戻りでは左足が前へ出て右足は少し引き（0.2 m）、idle の並び（左足が前）に揃う。
 */
export const COMBO2: AuthoredAttack = {
  name: 'combo2',
  duration: 0.67,
  continueFrom: { attack: COMBO1, t: 0.37 },
  keys: [
    // ---- 下半身: 後ろにいた右足が弧を描いて大きく前へ着地する。左足は残して、着地のあと引きつける。ルートは着地まで加速して、そのあと減速 ----
    { t: 0.02, ease: 'lin', rootZ: 0 },
    { t: 0.16, ease: 'in', rootZ: 0.34 },
    { t: 0.26, ease: 'out', rootZ: 0.58 },
    { t: 0.02, ease: 'lin', footR: { z: -0.12 } },
    { t: 0.16, ease: 'io', footR: { z: 0.78, arc: 0.14 } },
    { t: 0.47, ease: 'lin', footR: { z: 0.78 } },
    { t: 0.67, ease: 'io', footR: { z: 0.58, arc: 0.05 } },
    { t: 0.16, ease: 'lin', footL: { z: 0 } },
    { t: 0.28, ease: 'out', footL: { z: 0.2, arc: 0.06 } },
    { t: 0.47, ease: 'lin', footL: { z: 0.2 } },
    { t: 0.67, ease: 'io', footL: { z: 0.58, arc: 0.12 } },
    // ---- 溜め ----
    ...pose(0.09, 'io', {
      hips: { yaw: -20, pitch: 7, z: 0.03, y: -0.12 },
      chest: { yaw: -38, pitch: 14 },
      head: { yaw: -12 },
      grip: [-58, -34, 0.42],
      ...plane(-82),
      pole: [-0.5, -0.8, 0],
      ...OFFHAND.hip,
    }),
    // ---- 斬り上げ（0.17 に体の前を通る。腰 → 胸 → 腕・剣の順に遅れて動く） ----
    ...pose(0.17, 'in', {
      hips: { yaw: 0, pitch: 7, z: 0.05, y: -0.14 },
      chest: { yaw: 2, pitch: 10 },
      head: { yaw: 0 },
      grip: [6, 4, 0.46],
      ...plane(8),
      pole: [-0.3, -0.9, -0.2],
      ...OFFHAND.pull,
    }),
    ...pose(0.25, 'out', {
      hips: { yaw: 12, pitch: 6, z: 0.05, y: -0.12 },
      chest: { yaw: 22, pitch: 10 },
      head: { yaw: 8 },
      grip: [30, 28, 0.46],
      ...plane(80),
      pole: [-0.5, -0.85, -0.1],
      ...OFFHAND.guard,
    }),
    // ---- 振り抜き（0.34 から 0.47 まで姿勢を保って次段を待つ。次段はこの姿勢から続く） ----
    ...pose(0.34, 'out', FOLLOW),
    ...pose(0.47, 'lin', FOLLOW),
    // ---- 戻り ----
    ...pose(0.67, 'io', {
      hips: { yaw: 0, pitch: 0, z: 0, y: 0 },
      chest: { yaw: 0, pitch: 0 },
      head: { yaw: 0 },
      grip: 'idle',
      blade: 'idle',
      pole: 'idle',
      left: 'idle',
      leftPole: 'idle',
    }),
  ],
};
