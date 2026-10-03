import type { AuthoredAttack } from '../authoring';
import { COMBO2 } from './combo2';
import { OFFHAND } from './offhand';
import { pose } from './stagger';

/**
 * 3 段目（フィニッシュ）: 右手の突き。右足を大きく踏み込む突進（フェンシングのランジ）で、剣を引き絞ってから体ごと前へ伸びる。
 * 2 段目の受付時点（0.34s）の姿勢から続けて始まる（continueFrom）。座標の約束は combo1.ts と同じ（胸の座標系）。
 * 剣の向きは胸の座標系で書くので、体のひねり（chest.yaw）を打ち消して「ワールドで前」を向くようにしてある
 * （右へ yaw したとき、胸の座標系での「ワールド前」は左へ同じだけ振れる: [sin(yaw), 0, cos(yaw)]）。
 *
 * 時間: 0 → 0.1 右へひねって剣を右腰へ引き絞る（0.1〜0.13 は頂点で一拍。後ろ足を前へ引き寄せ、腰を深く沈める） / 0.13 → 0.18 突き出す（0.18 に最高速。
 * 右足は 0.17 に着地） / 0.18 → 0.24 伸び切る / 0.24 → 0.34 余韻 / 0.34 → 0.64 戻り。足は世界に固定。
 *
 * 踏み込み: 右足が腰の 0.4 m 前へ、左足が 0.4 m 後ろへ開く幅 0.8 m のランジ。右足は 0.04 から 0.84 まで弧を描いて飛び込む。
 * ルートは 0.05 から加速して 0.18 までに 0.30 m、減速して 0.31 までに 0.60 m（以降は止める。後で押しても pose と位置がずれない）。
 * 戻りは左足が前へ出て、右足は床を滑らせずに小さく浮かせて引き、idle の並び（左足が前）に揃う。
 */
const CHAMBER = {
  hips: { yaw: 20, pitch: 2, z: -0.03, y: -0.16 },
  chest: { yaw: 36, pitch: 4 },
  head: { yaw: 10 },
  grip: [50, -8, 0.3] as [number, number, number],
  blade: [0.588, 0.1, 0.8] as [number, number, number],
  face: [0, 1, 0] as [number, number, number],
  roll: 0,
  pole: [-0.5, -0.85, -0.1] as [number, number, number],
  ...OFFHAND.guard,
};

export const COMBO3: AuthoredAttack = {
  name: 'combo3',
  duration: 0.64,
  continueFrom: { attack: COMBO2, t: 0.34 },
  keys: [
    // ---- 下半身: 後ろ足（左）を前へ引き寄せてから、前足（右）が弧を描いて飛び込む。着地のあと後ろ足が追いかけ、戻りで左足が前へ出て揃う ----
    { t: 0.05, ease: 'lin', rootZ: 0 },
    { t: 0.12, ease: 'in', rootZ: 0.14 },
    { t: 0.17, ease: 'lin', rootZ: 0.34 },
    { t: 0.3, ease: 'out', rootZ: 0.6 },
    { t: 0.04, ease: 'lin', footR: { z: 0.2 } },
    { t: 0.17, ease: 'io', footR: { z: 0.84, arc: 0.08 } },
    { t: 0.46, ease: 'lin', footR: { z: 0.84 } },
    { t: 0.64, ease: 'io', footR: { z: 0.6, arc: 0.04 } },
    { t: 0.03, ease: 'lin', footL: { z: -0.38 } },
    { t: 0.12, ease: 'io', footL: { z: -0.2, arc: 0.05 } },
    { t: 0.17, ease: 'lin', footL: { z: -0.2 } },
    { t: 0.31, ease: 'out', footL: { z: 0.2, arc: 0.06 } },
    { t: 0.46, ease: 'lin', footL: { z: 0.2 } },
    { t: 0.64, ease: 'io', footL: { z: 0.6, arc: 0.12 } },
    // ---- 引き絞り（頂点で一拍止めて、突きを鋭くする） ----
    ...pose(0.1, 'io', CHAMBER),
    ...pose(0.13, 'lin', CHAMBER),
    // ---- 突き（腰 → 胸 → 腕・剣の順に遅れて動く） ----
    ...pose(0.18, 'in', {
      hips: { yaw: -8, pitch: 8, z: 0.08, y: -0.17 },
      chest: { yaw: -8, pitch: 12 },
      head: { yaw: -4 },
      grip: [8, 6, 0.46],
      blade: [-0.139, 0.06, 0.99],
      face: [0, 1, 0],
      roll: 0,
      pole: [-0.4, -0.9, -0.1],
      ...OFFHAND.pull,
    }),
    ...pose(0.24, 'out', {
      hips: { yaw: -10, pitch: 9, z: 0.09, y: -0.15 },
      chest: { yaw: -10, pitch: 13 },
      head: { yaw: -5 },
      grip: [8, 6, 0.48],
      blade: [-0.174, 0.06, 0.983],
      face: [0, 1, 0],
      roll: 0,
      pole: [-0.4, -0.9, -0.1],
      ...OFFHAND.hip,
    }),
    // ---- 余韻（突き切ったまま少し保つ） ----
    ...pose(0.34, 'out', {
      hips: { yaw: -10, pitch: 8, z: 0.08, y: -0.12 },
      chest: { yaw: -10, pitch: 12 },
      head: { yaw: -5 },
      grip: [8, 6, 0.47],
      blade: [-0.174, 0.06, 0.983],
      face: [0, 1, 0],
      roll: 0,
      pole: [-0.4, -0.9, -0.1],
      ...OFFHAND.hip,
    }),
    // ---- 戻り ----
    ...pose(0.64, 'io', {
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
