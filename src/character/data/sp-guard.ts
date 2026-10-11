import type { AuthoredAttack } from '../authoring';
import { FROM_STANCE, SP_TWO_HAND } from './spear';
import { pose } from './stagger';

/**
 * 槍のガード・受け・パリィ（両手持ち。spear.ts）。座標の約束は combo1.ts と同じ（胸の座標系）。構えは「保持」なので、
 * どのクリップも終端が同じ構えの姿勢（GUARD_HOLD）で止まる（Player が離すまで保つ）。受け（SP_GUARD_HIT）・パリィ（SP_PARRY）は構えの終端から始まり、構えの姿勢に戻って終わる（continueFrom）。
 *
 * 槍の構え: 柄を体の前で水平に近く横にして、穂先を右へ向ける（右手が前なので、左手が体の左前、右手が体の中心の右前に付く）。腰を落として、体を正面へ向ける。
 * 柄で受けるので、盾ほど固くはないが体の前を広くふさぐ。パリィの受付は大剣より少し長い（柄を払って弾く動きが大きいぶん）。
 */

type V3 = [number, number, number];

const GUARD_HOLD = {
  hips: { yaw: -4, pitch: 5, z: 0.03, y: -0.1 },
  chest: { yaw: -6, pitch: 5 },
  head: { yaw: 6 },
  grip: [-4, 6, 0.34] as V3,
  blade: [-0.9, 0.38, 0.2] as V3,
  face: [0, 0, 1] as V3,
  roll: 0,
  pole: [-0.5, -0.8, 0.1] as V3,
};

/** 構えに入る: 0 → 0.1 槍を一気に体の前で横にする（パリィの受付はこの動きの中）。終端の構えで止まる */
export const SP_GUARD: AuthoredAttack = {
  name: 'guardSpear',
  duration: 0.1,
  twoHanded: SP_TWO_HAND,
  continueFrom: FROM_STANCE,
  keys: [...pose(0.1, 'out', GUARD_HOLD)],
};

/** 受けた反動: 柄が押し込まれて体が少し反り（0.05）、構えへ戻る（0.2）。体の反動だけで足は動かさない */
export const SP_GUARD_HIT: AuthoredAttack = {
  name: 'guardSpearHit',
  duration: 0.2,
  twoHanded: SP_TWO_HAND,
  continueFrom: { attack: SP_GUARD, t: SP_GUARD.duration },
  keys: [
    ...pose(0.05, 'out', {
      ...GUARD_HOLD,
      hips: { yaw: -3, pitch: -2, z: -0.04, y: -0.06 },
      chest: { yaw: -4, pitch: -5 },
      grip: [-4, 4, 0.31],
    }),
    ...pose(0.2, 'io', GUARD_HOLD),
  ],
};

/** パリィ成功: 構えから柄を左上へ一気に跳ね上げて弾き（0.05）、構えへ戻る（0.24）。体も左へひねって、受け流した勢いが見える */
export const SP_PARRY: AuthoredAttack = {
  name: 'guardSpearParry',
  duration: 0.24,
  twoHanded: SP_TWO_HAND,
  continueFrom: { attack: SP_GUARD, t: SP_GUARD.duration },
  keys: [
    ...pose(0.05, 'out', {
      hips: { yaw: -12, pitch: 6, z: 0.05, y: -0.12 },
      chest: { yaw: -16, pitch: 6 },
      head: { yaw: 8 },
      grip: [-2, 14, 0.38],
      blade: [-0.55, 0.78, 0.3],
      face: [0, 0, 1],
      roll: 0,
      pole: [-0.5, -0.8, 0.1],
    }),
    ...pose(0.24, 'io', GUARD_HOLD),
  ],
};
