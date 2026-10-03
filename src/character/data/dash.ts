import type { AuthoredAttack } from '../authoring';
import { DODGE_CLIP } from './dodge';
import { plane } from './cutting-plane';
import { OFFHAND } from './offhand';
import { pose } from './stagger';

/**
 * 斜めの面（逆袈裟）。tilt が負 = 面が右下がり: θ = 0 が前、+ が右下〜後ろ、− が左上。
 * 縦の面（tilt 90）で下から振り上げると、途中で剣が真下を向いて、低い構えから剣先が床を貫く（実測 −0.4m）ので、右下 → 左上の斜めに振る。
 */
const T = -35;
/** 刃の軸まわりの回し（度）。斜めの面だと手首が逆へ 180° 近くねじれるので、刃を 70° 回して手首のねじれを 140° 以内に収める */
const R = 70;

/**
 * ダッシュ斬り（ロール直後の攻撃。ADR-018）: 転がって着地した低い姿勢から、立ち上がりながら右足を踏み込み、剣を右下から左上へ斜めにすくい上げる（逆袈裟の斬り上げ）。手付け（ADR-012）。
 * ロールの着地の姿勢（0.43s）から続けて始まる（continueFrom）。座標の約束は combo1.ts と同じ（胸の座標系）。斬りの面は縦（tilt 90）。
 *
 * 時間: 0 → 0.09 低いまま剣を右後ろの低い所へ引く / 0.09 → 0.17 すくい上げる（0.17 に前を通る最高速。右足は 0.17 に着地）/
 * 0.17 → 0.28 振り上げて体を反らせる / 0.28 → 0.4 保つ / 0.4 → 0.62 戻り。
 * 踏み込み: ルートは 0.05 から加速して 0.17 までに 0.45 m、減速して 0.32 までに 0.85 m。
 */
const GATHER = {
  hips: { yaw: 18, pitch: 14, z: -0.02, y: -0.3 },
  chest: { yaw: 30, pitch: 18 },
  head: { yaw: 8 },
  grip: [40, -26, 0.38] as [number, number, number],
  ...plane(100, T),
  roll: R,
  pole: [-0.6, -0.8, -0.2] as [number, number, number],
  ...OFFHAND.guard,
};

const RISE = {
  hips: { yaw: -8, pitch: -8, z: 0.04, y: -0.08 },
  chest: { yaw: -10, pitch: -14 },
  head: { yaw: -4 },
  grip: [6, 56, 0.42] as [number, number, number],
  ...plane(-70, T),
  roll: R,
  pole: [-0.5, -0.8, 0] as [number, number, number],
  ...OFFHAND.hip,
};

export const DASH: AuthoredAttack = {
  name: 'dash',
  duration: 0.62,
  continueFrom: { attack: DODGE_CLIP, t: 0.43 },
  keys: [
    // ---- 下半身 ----
    { t: 0.05, ease: 'lin', rootZ: 0 },
    { t: 0.17, ease: 'in', rootZ: 0.45 },
    { t: 0.32, ease: 'out', rootZ: 0.85 },
    { t: 0.04, ease: 'lin', footR: { z: -0.05 } },
    { t: 0.17, ease: 'io', footR: { z: 0.95, arc: 0.12 } },
    { t: 0.4, ease: 'lin', footR: { z: 0.95 } },
    { t: 0.62, ease: 'io', footR: { z: 0.85, arc: 0.03 } },
    { t: 0.15, ease: 'lin', footL: { z: 0.2 } },
    { t: 0.3, ease: 'out', footL: { z: 0.6, arc: 0.07 } },
    { t: 0.4, ease: 'lin', footL: { z: 0.6 } },
    { t: 0.62, ease: 'io', footL: { z: 0.85, arc: 0.08 } },
    // ---- 引く → すくい上げる → 振り上げる ----
    ...pose(0.09, 'io', GATHER),
    ...pose(0.17, 'in', {
      hips: { yaw: -6, pitch: 6, z: 0.06, y: -0.22 },
      chest: { yaw: -8, pitch: 8 },
      head: { yaw: -4 },
      grip: [10, 2, 0.46],
      ...plane(-8, T),
      roll: R,
      pole: [-0.4, -0.85, -0.1],
      ...OFFHAND.pull,
    }),
    ...pose(0.28, 'out', RISE),
    ...pose(0.4, 'lin', RISE),
    // ---- 戻り ----
    ...pose(0.62, 'io', {
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
