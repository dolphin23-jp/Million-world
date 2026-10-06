import type { AuthoredAttack } from '../authoring';
import { SP1 } from './sp-combo';
import { LUNGE_THRUST } from './sp-moves';
import { SP_FEET_Z, SP_READY, SP_TWO_HAND } from './spear';
import { pose } from './stagger';

/**
 * 槍の溜め突き（攻撃の長押し → 離す）。両手持ち・右手が前（spear.ts）。座標の約束は combo1.ts と同じ（胸の座標系）。
 * 1 段目（sp1）の引き絞り（0.1s。右手が腰へ引かれた姿勢）から、さらに深く引き絞って溜め、離すと体ごと飛び込んで貫く。
 */

type V3 = [number, number, number];

/** 1 段目（sp1）の引き絞りの途中から溜めに入る時刻。CHARGES.spear.holdFrames（6f = 0.1s）に合わせる。右足は構えの位置のまま（足を置き直さない） */
export const SP_CHARGE_ENTER_T = 0.1;

/** 溜めの構え: 腰を深く落として右手を腰の後ろまで引き、体を右へ巻く（穂先は敵へ向けたまま）。槍が体の後ろへ長く突き出す */
export const SP_COIL = {
  hips: { yaw: -6, pitch: 4, z: -0.12, y: -0.26 },
  chest: { yaw: -16, pitch: 4 },
  head: { yaw: 10 },
  grip: [-8, -40, 0.2] as V3,
  blade: [-0.3, 0.24, 0.92] as V3,
  face: [-1, 0, 0] as V3,
  roll: 0,
  pole: [-0.55, -0.8, 0.1] as V3,
};

/**
 * 溜め（構え）: 1 段目の引き絞りの姿勢（SP_CHARGE_ENTER_T）から、さらに深く引き絞った構え（SP_COIL）へ移り、そこで止まる（クリップは終端の姿勢で止まる）。
 * 0 → 0.22 引き絞る（0.22〜0.3 は一拍。以降は止めて保つ）。
 */
export const SP_CHARGE: AuthoredAttack = {
  name: 'spCharge',
  duration: 0.3,
  twoHanded: SP_TWO_HAND,
  continueFrom: { attack: SP1, t: SP_CHARGE_ENTER_T },
  keys: [...pose(0.22, 'io', SP_COIL), ...pose(0.3, 'lin', SP_COIL)],
};

/**
 * 溜め突き（溜めを放つ）: 深い引き絞りの構えから、体ごと一気に飛び込んで両腕で貫く。槍の最大の間合いの一撃（穂先は始点から 4.1m）。
 * 溜めの終端（SP_COIL）の姿勢から続けて始まる（continueFrom）。威力は溜めの段階で上がる（CHARGES.spear.levelPower）。
 * 0 → 0.06 さらに沈んで一拍 / 0.06 → 0.17 飛び込んで突く（0.17 に最高速。右足は 0.17 に着地）/ 0.17 → 0.3 伸び切る / 0.3 → 0.46 保つ / 0.46 → 0.86 戻り（硬直は長い）。
 * 踏み込み: ルートは 0.06 から加速して 0.17 までに 1.25m、減速して 0.3 までに 1.6m。
 */
export const SP_HEAVY: AuthoredAttack = {
  name: 'spHeavy',
  duration: 0.86,
  twoHanded: SP_TWO_HAND,
  continueFrom: { attack: SP_CHARGE, t: SP_CHARGE.duration },
  keys: [
    // ---- 下半身 ----
    { t: 0.06, ease: 'lin', rootZ: 0 },
    { t: 0.17, ease: 'in', rootZ: 1.25 },
    { t: 0.3, ease: 'out', rootZ: 1.6 },
    { t: 0.06, ease: 'lin', footR: { z: SP_FEET_Z.R } },
    { t: 0.17, ease: 'io', footR: { z: 1.5, arc: 0.16 } },
    { t: 0.46, ease: 'lin', footR: { z: 1.5 } },
    { t: 0.86, ease: 'io', footR: { z: 1.6 + SP_FEET_Z.R, arc: 0.03 } },
    { t: 0.06, ease: 'lin', footL: { z: SP_FEET_Z.L } },
    { t: 0.17, ease: 'io', footL: { z: 0.66, arc: 0.1 } },
    { t: 0.3, ease: 'out', footL: { z: 1.1, arc: 0.06 } },
    { t: 0.46, ease: 'lin', footL: { z: 1.1 } },
    { t: 0.86, ease: 'io', footL: { z: 1.6 + SP_FEET_Z.L, arc: 0.08 } },
    // ---- さらに沈む → 突く → 伸び切る → 保つ → 戻る ----
    ...pose(0.06, 'io', { ...SP_COIL, hips: { ...SP_COIL.hips, z: -0.14, y: -0.3 } }),
    ...pose(0.17, 'in', LUNGE_THRUST),
    ...pose(0.3, 'out', { ...LUNGE_THRUST, hips: { yaw: -5, pitch: 10, z: 0.1, y: -0.2 } }),
    ...pose(0.46, 'lin', { ...LUNGE_THRUST, hips: { yaw: -5, pitch: 10, z: 0.1, y: -0.2 } }),
    ...pose(0.86, 'io', SP_READY),
  ],
};

