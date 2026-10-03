import type { AuthoredAttack } from '../authoring';
import { plane } from './cutting-plane';
import { OFFHAND } from './offhand';

/** 縦の面（刃と面の法線が矢状面）。θ = 0 が前、+ が上〜後ろ、− が前下 */
const V = 90;

/** 予備動作の頂点: 腰を落として体を反らせ、剣を頭の上〜後ろへ大きく振りかぶる。頂点で一拍止めてから振り下ろす */
const TOP = {
  hips: { yaw: 6, pitch: -6, z: -0.06, y: -0.1 },
  chest: { yaw: 10, pitch: -14 },
  head: { yaw: 2 },
  grip: [14, 64, 0.34] as [number, number, number],
  ...plane(128, V),
  roll: 0,
  pole: [-0.65, -0.75, -0.2] as [number, number, number],
  ...OFFHAND.guard,
};

/** 振り下ろしの終わり: 前へ踏み込んで体を倒し、剣先が前の低い所で止まる。受付までこの姿勢を保つ */
const LAND = {
  hips: { yaw: 0, pitch: 12, z: 0.08, y: -0.16 },
  chest: { yaw: 0, pitch: 22 },
  head: { yaw: 0 },
  grip: [4, -32, 0.46] as [number, number, number],
  ...plane(-30, V),
  roll: 0,
  pole: [-0.4, -0.85, -0.1] as [number, number, number],
  ...OFFHAND.hip,
};

/**
 * 重撃: 剣を頭上へ大きく振りかぶり、右足を大きく踏み込んで真上から真下へ叩き斬る（縦斬り）。手付け（ADR-012）。
 * 座標の約束は combo1.ts と同じ（胸の座標系）。斬りの面は縦（plane の tilt = 90）。左手は構え手 → 引き手 → 脇（offhand.ts）。
 *
 * 時間: 0 → 0.38 予備動作（腰を落として反る。0.38〜0.44 は頂点で一拍）/ 0.44 → 0.51 振り下ろし（0.51 に前を通る最高速。当たりはその前後）/
 * 0.51 → 0.58 叩きつけて止まる / 0.58 → 0.72 姿勢を保つ / 0.72 → 1.0 戻り（左足が追いつく）。
 * 足は世界に固定。右足が 0.3 → 0.53 で大きく踏み込み（弧）、ルートは 0.5 m 進む。
 */
export const HEAVY: AuthoredAttack = {
  name: 'heavy',
  duration: 1.0,
  keys: [
    // ---- 予備動作 ----
    { t: 0.38, ease: 'io', ...TOP },
    { t: 0.44, ease: 'lin', ...TOP },
    // ---- 下半身: 右足が大きく踏み込む。左足は残って、戻りで追いつく ----
    { t: 0.3, ease: 'lin', footR: { z: 0 }, rootZ: 0 },
    { t: 0.53, ease: 'io', footR: { z: 0.62, arc: 0.16 }, rootZ: 0.5 },
    { t: 0.72, ease: 'lin', footL: { z: 0 }, footR: { z: 0.62 } },
    { t: 1.0, ease: 'io', footL: { z: 0.5, arc: 0.1 }, footR: { z: 0.5, arc: 0.03 } },
    // ---- 振り下ろし ----
    {
      t: 0.51,
      ease: 'in',
      hips: { yaw: 0, pitch: 6, z: 0.04, y: -0.14 },
      chest: { yaw: 0, pitch: 8 },
      head: { yaw: 0 },
      grip: [6, 6, 0.46],
      ...plane(0, V),
      roll: 0,
      pole: [-0.45, -0.85, -0.15],
      ...OFFHAND.pull,
    },
    { t: 0.58, ease: 'out', ...LAND },
    { t: 0.72, ease: 'lin', ...LAND },
    // ---- 戻り ----
    {
      t: 1.0,
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
