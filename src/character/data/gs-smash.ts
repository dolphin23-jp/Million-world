import type { AuthoredAttack } from '../authoring';
import { plane } from './cutting-plane';
import { GS_READY, GS_TWO_HAND } from './greatsword';
import { GS_CHARGE, PASS, TOP } from './gs-heavy';
import { pose } from './stagger';

/**
 * 大剣の地割り（溜めを最大まで溜めて放つ。ADR-023）。両手持ち（greatsword.ts）。座標の約束は combo1.ts と同じ（胸の座標系）。
 * 溜め斬り（gsHeavy）は剣先が床すれすれで止まるが、地割りは剣が床へ「当たる」まで振り下ろす: 切っ先が床を叩いて急に止まり（衝撃の輪・砂ぼこり・ひび割れ・揺れ）、
 * 剣が少し跳ね返って体が反動で浮き、もう一度沈んで止まる。重い剣が床に弾かれる手応えを見せる技。
 */

type V3 = [number, number, number];
const V = 90;

/** 振りかぶりの頂点: 溜めの構え（TOP）からさらに剣を高く・後ろへ引き、体を反らせて腰を深く沈める */
const RAISE = {
  ...TOP,
  hips: { yaw: 6, pitch: -8, z: -0.06, y: -0.3 },
  chest: { yaw: 6, pitch: -22 },
  grip: [14, 76, 0.34] as V3,
  ...plane(138, V),
  pole: [-0.65, -0.75, -0.25] as V3,
};

/** 叩きつけの瞬間: 前へ大きく踏み込んで深く沈み、剣が前下へ斜めに落ちて切っ先が床に届く（切っ先の高さ 0） */
const IMPACT = {
  hips: { yaw: 0, pitch: 20, z: 0.14, y: -0.36 },
  chest: { yaw: 0, pitch: 30 },
  head: { yaw: 0 },
  grip: [-2, 23, 0.46] as V3,
  blade: [0, -0.09, 0.996] as V3,
  face: [-1, 0, 0] as V3,
  roll: 0,
  pole: [-0.4, -0.9, -0.1] as V3,
};

/** 跳ね返り: 床に弾かれて剣が持ち上がり、体が反動で起きる（腰が上がって胸が反る） */
const REBOUND = {
  hips: { yaw: 0, pitch: 14, z: 0.11, y: -0.3 },
  chest: { yaw: 0, pitch: 22 },
  head: { yaw: 0 },
  grip: [-2, 28, 0.45] as V3,
  blade: [0, 0.02, 1] as V3,
  face: [-1, 0, 0] as V3,
  roll: 0,
  pole: [-0.4, -0.9, -0.1] as V3,
};

/** 落ち着き: もう一度沈んで、剣先が床の上で止まる（受け止めた反動が収まる） */
const SETTLE = {
  hips: { yaw: 0, pitch: 18, z: 0.13, y: -0.35 },
  chest: { yaw: 0, pitch: 27 },
  head: { yaw: 0 },
  grip: [-2, 18, 0.46] as V3,
  blade: [0, -0.06, 0.998] as V3,
  face: [-1, 0, 0] as V3,
  roll: 0,
  pole: [-0.4, -0.9, -0.1] as V3,
};

/**
 * 地割り: 頭上の構えから、さらに高く振りかぶって沈み、左足を大きく踏み込んで真上から床へ叩きつける。溜めの終端（TOP）の姿勢から続けて始まる（continueFrom）。
 * 0 → 0.12 さらに振りかぶって沈む（0.12〜0.18 は頂点で一拍）/ 0.18 → 0.3 振り下ろす（0.24 に体の前を通る最高速、0.3 に床へ当たって止まる。左足は 0.3 に着地）/
 * 0.3 → 0.4 跳ね返り（剣が持ち上がり、体が浮く）/ 0.4 → 0.54 落ち着いて沈む / 0.54 → 0.76 保つ（硬直は長い）/ 0.76 → 1.2 戻り。
 * 踏み込み: 左足は 0.12 に床を離れ、0.3 に腰の 0.48 m 前へ着地する。右足は引きずって 0.3 には腰の 0.4 m 後ろ。ルートは 0.12 から加速して 0.3 までに 0.8 m、減速して 0.45 までに 1.2 m。
 */
export const GS_SMASH: AuthoredAttack = {
  name: 'gsSmash',
  duration: 1.2,
  twoHanded: GS_TWO_HAND,
  continueFrom: { attack: GS_CHARGE, t: GS_CHARGE.duration },
  keys: [
    // ---- 下半身 ----
    { t: 0.12, ease: 'lin', rootZ: 0 },
    { t: 0.3, ease: 'in', rootZ: 0.8 },
    { t: 0.45, ease: 'out', rootZ: 1.2 },
    { t: 0.12, ease: 'lin', footL: { z: 0 } },
    { t: 0.3, ease: 'io', footL: { z: 1.14, arc: 0.16 } },
    { t: 0.76, ease: 'lin', footL: { z: 1.14 } },
    { t: 1.2, ease: 'io', footL: { z: 1.2, arc: 0.02 } },
    { t: 0.12, ease: 'lin', footR: { z: 0 } },
    { t: 0.3, ease: 'io', footR: { z: 0.4, arc: 0.05 } },
    { t: 0.46, ease: 'out', footR: { z: 0.85, arc: 0.08 } },
    { t: 0.76, ease: 'lin', footR: { z: 0.85 } },
    { t: 1.2, ease: 'io', footR: { z: 1.2, arc: 0.1 } },
    // ---- 振りかぶる → 振り下ろす → 床に当たる → 跳ね返る → 沈む → 保つ → 戻る ----
    ...pose(0.12, 'io', RAISE),
    ...pose(0.18, 'lin', RAISE),
    ...pose(0.24, 'in', PASS),
    ...pose(0.3, 'in', IMPACT),
    ...pose(0.32, 'lin', IMPACT),
    ...pose(0.4, 'out', REBOUND),
    ...pose(0.54, 'io', SETTLE),
    ...pose(0.76, 'lin', SETTLE),
    ...pose(1.2, 'io', GS_READY),
  ],
};
