import type { AuthoredAttack } from '../authoring';
import { plane } from './cutting-plane';
import { OFFHAND } from './offhand';
import { pose } from './stagger';

/** 水平の面（tilt 0）。θ = 0 が前、+ が右（後ろへ回る）、− が左。θ は胸に対して。世界の向きは腰・胸のヨーを足した角度（払いの始点 ≒ +110°、終点 ≒ −100°） */
const H = 0;

/**
 * 下がりながらの払い（ロック中にスティックを後ろへ倒して攻撃。ADR-018）: 後ろへ跳びながら、剣を右から左へ水平に払って敵を押し返す。間合いを取り直す防御的な技。
 * 後ろステップ（dodge.ts の DODGE_BACK）と同じ足の作り（跳んでいるあいだ足は腰に付いてぶら下がり、着地で世界に固定）。座標の約束は combo1.ts と同じ。向きは保つ。
 *
 * 時間: 0 → 0.08 右へひねって剣を右へ引く、沈む / 0.08 → 0.24 跳びながら右から左へ払う（0.16 に前を通る最高速）/ 0.24 → 0.32 払い切って着地 / 0.32 → 0.54 戻り。
 * ルートは 0.08 から 0.34 までに 1.1 m 後ろへ（負）。当たりは払いの最中（跳び始め）なので、プレイヤーの位置は払いの前半ではまだ元の近く。
 */
const COIL = {
  hips: { yaw: 14, pitch: 6, z: 0.02, y: -0.15 },
  chest: { yaw: 24, pitch: 8 },
  head: { yaw: 8 },
  grip: [60, -2, 0.36] as [number, number, number],
  ...plane(72, H),
  roll: -30,
  pole: [-0.6, -0.8, 0.1] as [number, number, number],
  ...OFFHAND.guard,
};

export const RETREAT: AuthoredAttack = {
  name: 'retreat',
  duration: 0.54,
  keys: [
    // ---- ルート（後ろへ。負が後ろ） ----
    { t: 0.08, ease: 'lin', rootZ: 0 },
    { t: 0.14, ease: 'in', rootZ: -0.3 },
    { t: 0.26, ease: 'lin', rootZ: -1.0 },
    { t: 0.34, ease: 'out', rootZ: -1.1 },
    // ---- 足: 蹴るまで世界に固定 → 跳んでいるあいだは腰にぶら下がる → 着地で世界に固定 ----
    { t: 0.08, ease: 'lin', footL: { rel: 0, z: 0, lift: 0 }, footR: { rel: 0, z: 0, lift: 0 } },
    { t: 0.13, ease: 'io', footL: { rel: 1, lx: 0.11, ly: -0.66, lz: -0.08, knee: 0 }, footR: { rel: 1, lx: -0.11, ly: -0.68, lz: 0, knee: 0 } },
    { t: 0.24, ease: 'lin', footL: { rel: 1, lx: 0.11, ly: -0.72, lz: 0.05, knee: 0 }, footR: { rel: 1, lx: -0.11, ly: -0.7, lz: -0.04, knee: 0 } },
    { t: 0.29, ease: 'io', footL: { rel: 0, z: -1.0, x: 0, lift: 0, pitch: 0 }, footR: { rel: 0, z: -1.15, x: 0, lift: 0, pitch: 0 } },
    { t: 0.54, ease: 'io', footL: { z: -1.1 }, footR: { z: -1.1 } },
    // ---- 体と剣: 引く → 払う（腰 → 胸 → 腕・剣の順に遅れて動く）→ 払い切る → 戻る ----
    ...pose(0.08, 'io', COIL),
    ...pose(0.16, 'in', {
      hips: { yaw: -4, pitch: -6, z: -0.02, y: 0.1 },
      chest: { yaw: -4, pitch: -6 },
      head: { yaw: -2 },
      grip: [4, 4, 0.46],
      ...plane(0, H),
      roll: -30,
      pole: [-0.4, -0.85, 0],
      ...OFFHAND.pull,
    }),
    ...pose(0.24, 'out', {
      hips: { yaw: -16, pitch: -2, z: 0, y: 0.04 },
      chest: { yaw: -26, pitch: 0 },
      head: { yaw: -12 },
      grip: [-40, 6, 0.46],
      ...plane(-58, H),
      roll: -30,
      pole: [-0.5, -0.8, 0],
      ...OFFHAND.hip,
    }),
    ...pose(0.32, 'lin', {
      hips: { yaw: -14, pitch: 8, z: 0.03, y: -0.14 },
      chest: { yaw: -22, pitch: 10 },
      head: { yaw: -10 },
      grip: [-38, 4, 0.46],
      ...plane(-62, H),
      roll: -30,
      pole: [-0.5, -0.8, 0],
      ...OFFHAND.hip,
    }),
    ...pose(0.54, 'io', {
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
