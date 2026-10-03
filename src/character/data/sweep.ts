import type { AuthoredAttack } from '../authoring';
import { plane } from './cutting-plane';
import { OFFHAND } from './offhand';
import { pose } from './stagger';

/** 水平の面（tilt 0）。θ = 0 が前、+ が右（後ろへ回る）、− が左。θ は胸に対して。世界の向きは腰・胸のヨーを足した角度（薙ぎの始点 ≒ +136°、終点 ≒ −116°） */
const H = 0;

/**
 * 横薙ぎ（ロック中にスティックを横へ倒して攻撃。ADR-018）: 右へ大きくひねって溜め、左足を踏み込みながら体ごと右から左へ水平に薙ぐ。範囲の広い技。手付け（ADR-012）。
 * 座標の約束は combo1.ts と同じ（胸の座標系）。斬りの面は水平（tilt 0）。
 *
 * 時間: 0 → 0.16 右へひねって剣を右後ろへ（0.13〜0.16 は頂点で一拍。腰を落として後ろ足に体重）/ 0.16 → 0.26 薙ぐ（0.23 に前を通る最高速。左足は 0.22 に着地）/
 * 0.26 → 0.38 振り抜く / 0.38 → 0.46 保つ / 0.46 → 0.66 戻り。
 * 踏み込み: ルートは 0.1 から加速して 0.22 までに 0.3 m、減速して 0.38 までに 0.55 m。
 */
const WINDUP = {
  hips: { yaw: 22, pitch: -2, z: -0.05, y: -0.1 },
  chest: { yaw: 36, pitch: -4 },
  head: { yaw: 12 },
  grip: [66, 4, 0.36] as [number, number, number],
  ...plane(78, H),
  roll: -30,
  pole: [-0.6, -0.8, 0.1] as [number, number, number],
  ...OFFHAND.guard,
};

const FOLLOW = {
  hips: { yaw: -18, pitch: 8, z: 0.05, y: -0.14 },
  chest: { yaw: -32, pitch: 10 },
  head: { yaw: -14 },
  grip: [-44, 6, 0.46] as [number, number, number],
  ...plane(-66, H),
  roll: -30,
  pole: [-0.5, -0.8, 0] as [number, number, number],
  ...OFFHAND.hip,
};

export const SWEEP: AuthoredAttack = {
  name: 'sweep',
  duration: 0.66,
  keys: [
    // ---- 下半身: 左足が弧を描いて前へ踏み込む。右足は残って、あとで引き寄せる ----
    { t: 0.1, ease: 'lin', rootZ: 0 },
    { t: 0.22, ease: 'in', rootZ: 0.3 },
    { t: 0.38, ease: 'out', rootZ: 0.55 },
    { t: 0.1, ease: 'lin', footL: { z: 0 } },
    { t: 0.22, ease: 'io', footL: { z: 0.55, arc: 0.12 } },
    { t: 0.46, ease: 'lin', footL: { z: 0.55 } },
    { t: 0.66, ease: 'io', footL: { z: 0.55, arc: 0.02 } },
    { t: 0.26, ease: 'lin', footR: { z: 0 } },
    { t: 0.4, ease: 'io', footR: { z: 0.4, arc: 0.07 } },
    { t: 0.46, ease: 'lin', footR: { z: 0.4 } },
    { t: 0.66, ease: 'io', footR: { z: 0.55, arc: 0.05 } },
    // ---- ひねって溜める → 薙ぐ → 振り抜く ----
    ...pose(0.13, 'io', WINDUP),
    ...pose(0.16, 'lin', WINDUP),
    ...pose(0.23, 'in', {
      hips: { yaw: 0, pitch: 6, z: 0.05, y: -0.16 },
      chest: { yaw: 0, pitch: 9 },
      head: { yaw: 0 },
      grip: [6, 8, 0.46],
      ...plane(0, H),
      roll: -30,
      pole: [-0.4, -0.85, 0],
      ...OFFHAND.pull,
    }),
    ...pose(0.32, 'out', FOLLOW),
    ...pose(0.46, 'lin', FOLLOW),
    // ---- 戻り ----
    ...pose(0.66, 'io', {
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
