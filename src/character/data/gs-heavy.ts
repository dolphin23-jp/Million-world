import type { AuthoredAttack } from '../authoring';
import { plane } from './cutting-plane';
import { GS1 } from './gs-combo';
import { GS_READY, GS_TWO_HAND } from './greatsword';
import { pose } from './stagger';

/**
 * 大剣の溜め斬り（攻撃の長押し → 離す）。両手持ち（greatsword.ts）。座標の約束は combo1.ts と同じ（胸の座標系）。
 * 溜め: 剣を頭上へ振りかぶって腰を落とす。放つ: 前へ大きく踏み込んで、頭上から真下へ叩きつける（唐竹割り）。範囲は広い扇形。
 */

type V3 = [number, number, number];
/** 縦の面（刃と面の法線が矢状面）。θ = 0 が前、+ が上〜後ろ、− が前下 */
const V = 90;

/** 1 段目（gs1）の予備動作の途中から溜めに入る時刻。CHARGE_HOLD_FRAMES（12f = 0.2s）に合わせる。左足が床を離す前（gs1 の 0.22s）なので、足を置き直さずに済む */
export const GS_CHARGE_ENTER_T = 0.2;

/** 頭上の構え: 腰を深く落として体を反らせ、剣を頭の上〜後ろへ立てる（刃は後ろ上がり）。両手が頭の上に来る */
export const TOP = {
  hips: { yaw: 4, pitch: -8, z: -0.06, y: -0.2 },
  chest: { yaw: 6, pitch: -14 },
  head: { yaw: 2 },
  grip: [12, 66, 0.34] as V3,
  ...plane(128, V),
  roll: 0,
  pole: [-0.65, -0.75, -0.2] as V3,
};

/**
 * 溜め（構え）: 1 段目の予備動作の途中（GS_CHARGE_ENTER_T）の姿勢から、剣を頭上へ振りかぶった構え（TOP）へ移り、そこで止まる。
 * 0 → 0.28 剣を頭上へ、腰を落として体を反らせる（0.28〜0.36 は頂点で一拍。以降は止めて保つ。クリップは終端の姿勢で止まる）。
 */
export const GS_CHARGE: AuthoredAttack = {
  name: 'gsCharge',
  duration: 0.36,
  twoHanded: GS_TWO_HAND,
  continueFrom: { attack: GS1, t: GS_CHARGE_ENTER_T },
  keys: [...pose(0.28, 'io', TOP), ...pose(0.36, 'lin', TOP)],
};

/** 振り下ろしの途中（体の前を通る最高速）: 頭上から前へ。剣が水平に近づく。腰が前へ落ちる */
export const PASS = {
  hips: { yaw: 0, pitch: 10, z: 0.08, y: -0.28 },
  chest: { yaw: 0, pitch: 16 },
  head: { yaw: 0 },
  grip: [4, 14, 0.44] as V3,
  ...plane(0, V),
  roll: 0,
  pole: [-0.45, -0.85, -0.15] as V3,
};

/** 叩きつけ: 前へ大きく踏み込んで深く沈み、前へ倒れる。剣先が体の前の床へ届く（切っ先は床すれすれ） */
export const SMASH = {
  hips: { yaw: 0, pitch: 18, z: 0.12, y: -0.32 },
  chest: { yaw: 0, pitch: 28 },
  head: { yaw: 0 },
  grip: [-2, -4, 0.46] as V3,
  blade: [0, 0.06, 0.998] as V3,
  face: [-1, 0, 0] as V3,
  roll: 0,
  pole: [-0.4, -0.9, -0.1] as V3,
};

/**
 * 溜め斬り（溜めを放つ）: 頭上の構えから、左足を大きく踏み込んで、真上から真下へ叩き割る。溜めの終端（TOP）の姿勢から続けて始まる（continueFrom）。威力は溜めの段階で上がる（CHARGES.greatsword.levelPower）。
 * 0 → 0.14 腰を沈めて力を溜める（TOP からさらに沈む）/ 0.14 → 0.22 振り下ろす（0.22 に体の前を通る最高速。左足は 0.22 に着地）/ 0.22 → 0.3 叩きつけて止まる / 0.3 → 0.58 保つ（地擦り斬り上げの受付。ADR-024）/ 0.58 → 0.98 戻り（硬直は長い）。
 * 踏み込み: 左足が 0.1 に床を離れ、0.22 に腰の 0.46 m 前へ着地する。右足は引きずって 0.22 には腰の 0.4 m 後ろ（幅 0.86 m。これ以上開くと脚が届かず腰が沈みすぎる）。ルートは 0.1 から加速して 0.22 までに 0.7 m、減速して 0.36 までに 1.3 m。
 */
/** 叩きつけた姿勢を保つ時刻（地擦り斬り上げ gsHeavyRip の受付。AttackDef.cancelAt と同じ。0.3〜0.58 で保つ。ルートは 0.36 で止まる） */
export const GS_HEAVY_HOLD_T = 0.4;

export const GS_HEAVY: AuthoredAttack = {
  name: 'gsHeavy',
  duration: 0.98,
  twoHanded: GS_TWO_HAND,
  continueFrom: { attack: GS_CHARGE, t: GS_CHARGE.duration },
  keys: [
    // ---- 下半身 ----
    { t: 0.1, ease: 'lin', rootZ: 0 },
    { t: 0.22, ease: 'in', rootZ: 0.7 },
    { t: 0.36, ease: 'out', rootZ: 1.3 },
    { t: 0.1, ease: 'lin', footL: { z: 0 } },
    { t: 0.22, ease: 'io', footL: { z: 1.16, arc: 0.16 } },
    { t: 0.58, ease: 'lin', footL: { z: 1.16 } },
    { t: 0.98, ease: 'io', footL: { z: 1.3, arc: 0.02 } },
    { t: 0.1, ease: 'lin', footR: { z: 0 } },
    { t: 0.22, ease: 'io', footR: { z: 0.3, arc: 0.05 } },
    { t: 0.38, ease: 'out', footR: { z: 0.85, arc: 0.08 } },
    { t: 0.58, ease: 'lin', footR: { z: 0.85 } },
    { t: 0.98, ease: 'io', footR: { z: 1.3, arc: 0.1 } },
    // ---- 沈む → 振り下ろす → 叩きつける → 保つ → 戻る ----
    ...pose(0.1, 'io', { ...TOP, hips: { yaw: 6, pitch: -4, z: -0.04, y: -0.28 } }),
    ...pose(0.14, 'lin', { ...TOP, hips: { yaw: 6, pitch: -4, z: -0.04, y: -0.28 } }),
    ...pose(0.22, 'in', PASS),
    ...pose(0.3, 'out', SMASH),
    ...pose(0.58, 'lin', SMASH),
    ...pose(0.98, 'io', GS_READY),
  ],
};
