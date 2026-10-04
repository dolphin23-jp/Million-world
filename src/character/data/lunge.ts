import type { AuthoredAttack } from '../authoring';
import { OFFHAND } from './offhand';
import { pose } from './stagger';

/**
 * 踏み込み突き（スティック前 + 攻撃。ADR-018）: 大きく踏み込んで体ごと突く（フェンシングのランジ）。距離を詰める技。手付け（ADR-012）。
 * 座標の約束は combo1.ts と同じ（胸の座標系）。3 段目（combo3）の突きを、待機から・より遠くへ伸ばしたもの。
 *
 * 時間: 0 → 0.12 右へひねって剣を右腰へ引き絞る（0.12〜0.15 は頂点で一拍） / 0.15 → 0.21 突き出す（0.21 に最高速。右足は 0.21 に着地）/
 * 0.21 → 0.3 伸び切る / 0.3 → 0.42 余韻 / 0.42 → 0.5 保つ（抜き払いの受付。ADR-024）/ 0.5 → 0.7 戻り。足は世界に固定。
 * 踏み込み: ルートは 0.06 から加速して 0.21 までに 0.7 m、減速して 0.34 までに 1.3 m（回避直後の追い斬りにも使う）。右足は腰の 0.45 m 前へ着地、左足は引き寄せて追いかける。
 */
export const CHAMBER = {
  hips: { yaw: 22, pitch: 3, z: -0.04, y: -0.14 },
  chest: { yaw: 38, pitch: 4 },
  head: { yaw: 10 },
  grip: [50, -8, 0.3] as [number, number, number],
  blade: [0.588, 0.1, 0.8] as [number, number, number],
  face: [0, 1, 0] as [number, number, number],
  roll: 0,
  pole: [-0.5, -0.85, -0.1] as [number, number, number],
  ...OFFHAND.guard,
};

export const THRUST = {
  hips: { yaw: -8, pitch: 10, z: 0.1, y: -0.22 },
  chest: { yaw: -8, pitch: 14 },
  head: { yaw: -4 },
  grip: [8, 6, 0.47] as [number, number, number],
  blade: [-0.139, 0.06, 0.99] as [number, number, number],
  face: [0, 1, 0] as [number, number, number],
  roll: 0,
  pole: [-0.4, -0.9, -0.1] as [number, number, number],
  ...OFFHAND.pull,
};

/** 突き切った姿勢を保つ時刻（抜き払い lungeSlash の continueFrom がこの姿勢を指す） */
export const LUNGE_HOLD_T = 0.42;

export const LUNGE: AuthoredAttack = {
  name: 'lunge',
  duration: 0.7,
  keys: [
    // ---- 下半身: 右足が大きく飛び込む。左足は残って、突いたあと引き寄せて追いつく ----
    { t: 0.06, ease: 'lin', rootZ: 0 },
    { t: 0.14, ease: 'in', rootZ: 0.15 },
    { t: 0.21, ease: 'lin', rootZ: 0.7 },
    { t: 0.34, ease: 'out', rootZ: 1.3 },
    { t: 0.08, ease: 'lin', footR: { z: 0 } },
    { t: 0.21, ease: 'io', footR: { z: 1.15, arc: 0.14 } },
    { t: 0.5, ease: 'lin', footR: { z: 1.15 } },
    { t: 0.7, ease: 'io', footR: { z: 1.3, arc: 0.04 } },
    { t: 0.17, ease: 'lin', footL: { z: 0 } },
    { t: 0.34, ease: 'out', footL: { z: 0.75, arc: 0.07 } },
    { t: 0.5, ease: 'lin', footL: { z: 0.75 } },
    { t: 0.7, ease: 'io', footL: { z: 1.3, arc: 0.1 } },
    // ---- 引き絞り（頂点で一拍止めて、突きを鋭くする） ----
    ...pose(0.12, 'io', CHAMBER),
    ...pose(0.15, 'lin', CHAMBER),
    // ---- 突き（腰 → 胸 → 腕・剣の順に遅れて動く） ----
    ...pose(0.21, 'in', THRUST),
    ...pose(0.3, 'out', { ...THRUST, grip: [8, 6, 0.47], ...OFFHAND.hip }),
    ...pose(0.42, 'out', { ...THRUST, hips: { yaw: -10, pitch: 8, z: 0.08, y: -0.14 }, grip: [8, 6, 0.47], ...OFFHAND.hip }),
    ...pose(0.5, 'lin', { ...THRUST, hips: { yaw: -10, pitch: 8, z: 0.08, y: -0.14 }, grip: [8, 6, 0.47], ...OFFHAND.hip }),
    // ---- 戻り ----
    ...pose(0.7, 'io', {
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
