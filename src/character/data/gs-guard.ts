import type { AuthoredAttack } from '../authoring';
import { FROM_STANCE, GS_TWO_HAND } from './greatsword';
import { pose } from './stagger';

/**
 * 大剣のガード・受け・パリィ（両手持ち。greatsword.ts）。座標の約束は combo1.ts と同じ（胸の座標系）。構えは「保持」なので、
 * どのクリップも終端が同じ構えの姿勢（GUARD_HOLD）で止まる（Player が離すまで保つ）。受け（GS_GUARD_HIT）・パリィ（GS_PARRY）は構えの終端から始まり、構えの姿勢に戻って終わる（continueFrom）。
 *
 * 大剣の構え: 剣を体の前で立てて、刃を体の左上へ斜めに構える（刃の面が敵に向く）。腰を落として、体を少し左へひねる。盾より体の前をふさぐ面積が小さいので、軽減は小さく、
 * 代わりにパリィの受付は短い（0.1 秒の構えの動きの中の 6f。ガードに入る動きそのものが「弾き」なので、早すぎても遅すぎても弾けない）。
 */

type V3 = [number, number, number];

const GUARD_HOLD = {
  hips: { yaw: -8, pitch: 5, z: 0.03, y: -0.1 },
  chest: { yaw: -12, pitch: 5 },
  head: { yaw: 6 },
  grip: [-4, 8, 0.4] as V3,
  blade: [0.5, 0.82, 0.27] as V3,
  face: [0, 0, 1] as V3,
  roll: -180,
  pole: [-0.5, -0.8, 0.1] as V3,
};

/** 構えに入る: 0 → 0.1 剣を一気に体の前へ立てる（パリィの受付 6f はこの動きの中）。終端の構えで止まる */
export const GS_GUARD: AuthoredAttack = {
  name: 'guardGreatsword',
  duration: 0.1,
  twoHanded: GS_TWO_HAND,
  continueFrom: FROM_STANCE,
  keys: [...pose(0.1, 'out', GUARD_HOLD)],
};

/** 受けた反動: 剣が押し込まれて体が少し反り（0.05）、構えへ戻る（0.2）。体の反動だけで足は動かさない */
export const GS_GUARD_HIT: AuthoredAttack = {
  name: 'guardGreatswordHit',
  duration: 0.2,
  twoHanded: GS_TWO_HAND,
  continueFrom: { attack: GS_GUARD, t: GS_GUARD.duration },
  keys: [
    ...pose(0.05, 'out', {
      ...GUARD_HOLD,
      hips: { yaw: -6, pitch: -3, z: -0.04, y: -0.06 },
      chest: { yaw: -10, pitch: -6 },
      grip: [-4, 6, 0.33],
    }),
    ...pose(0.2, 'io', GUARD_HOLD),
  ],
};

/** パリィ成功: 構えから剣を右前へ一気に払って弾き（0.05）、構えへ戻る（0.26）。体も右へひねって、受け流した勢いが見える */
export const GS_PARRY: AuthoredAttack = {
  name: 'guardGreatswordParry',
  duration: 0.26,
  twoHanded: GS_TWO_HAND,
  continueFrom: { attack: GS_GUARD, t: GS_GUARD.duration },
  keys: [
    ...pose(0.05, 'out', {
      hips: { yaw: 10, pitch: 6, z: 0.06, y: -0.12 },
      chest: { yaw: 18, pitch: 7 },
      head: { yaw: 4 },
      grip: [4, 8, 0.44],
      blade: [-0.62, 0.62, 0.48],
      face: [0, 0, 1],
      roll: -180,
      pole: [-0.5, -0.8, 0.1],
    }),
    ...pose(0.26, 'io', GUARD_HOLD),
  ],
};
