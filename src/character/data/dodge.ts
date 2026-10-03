import type { AuthoredAttack } from '../authoring';
import { OFFHAND } from './offhand';

/**
 * 回避: 低く前傾して 2 歩で駆け抜けるダッシュ。手付け（ADR-012）。座標の約束は combo1.ts と同じ（胸の座標系）。
 * 回避の向きはキャラの向きを入力方向へ合わせてから始まるので、アニメは常に「前」へ進む。
 *
 * 時間: 0 → 0.04 踏み切りの構え（沈み込む）/ 0.04 → 0.46 駆け抜け（右足を振り出して 0.2 に着き、0.15 に蹴った左足が 0.34 に前へ着く。
 * 0.15〜0.2 と 0.3〜0.34 は両足が浮く）/ 0.46 → 0.58 減速して立ち上がる。剣は体の後ろ・腰の高さに寝かせて走る。
 * ルートの速さは 0.04〜0.16 で加速、0.16〜0.34 は 10 m/s、0.34〜0.48 で減速（合計 3.1 m）。旧版（Meshy の前転、初速 9.5 m/s・3.6 m）と同程度。
 * 足は世界に固定（足の z は世界の idle 位置からの前進量）。着地の足は腰の約 0.5 m 前に置き、戻りで両足がルートの真下に揃う。
 */
const SWORD_BACK = {
  grip: [160, -45, 0.34] as [number, number, number],
  blade: [-0.25, -0.35, -0.9] as [number, number, number],
  face: [0, 1, 0] as [number, number, number],
  roll: 0,
  pole: [-0.3, -0.6, 0.7] as [number, number, number],
};

export const DODGE_CLIP: AuthoredAttack = {
  name: 'dodge',
  duration: 0.58,
  keys: [
    // ---- ルート ----
    { t: 0.04, ease: 'lin', rootZ: 0 },
    { t: 0.16, ease: 'in', rootZ: 0.6 },
    { t: 0.34, ease: 'lin', rootZ: 2.4 },
    { t: 0.48, ease: 'out', rootZ: 3.1 },
    // ---- 右足: 後ろの足を前へ振り出して着地（0.2）→ 蹴って（0.3）再び前へ（0.46） ----
    { t: 0.04, ease: 'lin', footR: { z: 0 } },
    { t: 0.2, ease: 'io', footR: { z: 1.64, arc: 0.24 } },
    { t: 0.3, ease: 'lin', footR: { z: 1.64 } },
    { t: 0.46, ease: 'io', footR: { z: 3.1, arc: 0.22 } },
    // ---- 左足: 蹴り出して（0.1）大きく前へ（0.34 に着地）→ 戻りでルートの真下へ ----
    { t: 0.15, ease: 'lin', footL: { z: 0 } },
    { t: 0.34, ease: 'io', footL: { z: 2.84, arc: 0.26 } },
    { t: 0.48, ease: 'lin', footL: { z: 2.84 } },
    { t: 0.58, ease: 'io', footL: { z: 3.1, arc: 0.05 } },
    // ---- 上体 ----
    {
      t: 0.07,
      ease: 'io',
      hips: { yaw: 0, pitch: 8, z: 0.02, y: -0.07 },
      chest: { yaw: 0, pitch: 14 },
      head: { yaw: 0 },
      ...SWORD_BACK,
      ...OFFHAND.guard,
    },
    {
      t: 0.14,
      ease: 'io',
      hips: { yaw: 0, pitch: 12, z: 0.06, y: -0.04 },
      chest: { yaw: 0, pitch: 22 },
      head: { yaw: 0 },
      ...SWORD_BACK,
      left: [-6, -15, 0.4],
      leftPole: [0.5, -0.85, -0.1],
    },
    {
      t: 0.28,
      ease: 'io',
      hips: { yaw: 0, pitch: 12, z: 0.06, y: -0.04 },
      chest: { yaw: 0, pitch: 22 },
      head: { yaw: 0 },
      ...SWORD_BACK,
      ...OFFHAND.pull,
    },
    {
      t: 0.42,
      ease: 'io',
      hips: { yaw: 0, pitch: 10, z: 0.04, y: -0.04 },
      chest: { yaw: 0, pitch: 18 },
      head: { yaw: 0 },
      ...SWORD_BACK,
      ...OFFHAND.guard,
    },
    // ---- 立ち上がり ----
    {
      t: 0.58,
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
