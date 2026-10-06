import type { AuthoredAttack } from '../authoring';
import { GS_READY, GS_TWO_HAND } from './greatsword';
import { GS2, PASS, WINDUP } from './gs-combo';
import { pose } from './stagger';

/**
 * 大剣の叩き落とし（2 段目の受付で前へ倒して攻撃。ADR-023）。両手持ち（greatsword.ts）。座標の約束は combo1.ts と同じ（胸の座標系）。
 * 2 段目の斬り上げで右上へ抜けた剣を、そのまま大きく振りかぶり直して、左前の床へ斜めに叩き落とす。1 段目の袈裟（gs1）と同じ軌道で、床に当たって止まり、跳ね返る
 * （地割り gsSmash より小さく速い。衝撃の輪も小さい）。2 連の終わりに続けて出す、重い締めの一撃。
 */

type V3 = [number, number, number];

/** 振りかぶり: 1 段目の予備動作の頂点（WINDUP）と同じ。右肩の後ろへ大きく引き上げる */
const RAISE = { ...WINDUP, hips: { ...WINDUP.hips, y: -0.2 } };

/** 叩きつけの瞬間: 左前へ踏み込んで深く沈み、剣が左前下へ斜めに落ちて切っ先が床に届く（切っ先の高さ 0） */
const IMPACT = {
  hips: { yaw: -12, pitch: 14, z: 0.1, y: -0.32 },
  chest: { yaw: -26, pitch: 22 },
  head: { yaw: -8 },
  grip: [-16, 6, 0.46] as V3,
  blade: [0.5, -0.3, 0.81] as V3,
  face: [-0.78, -0.62, 0] as V3,
  roll: -150,
  pole: [-0.5, -0.8, 0] as V3,
};

/** 跳ね返り: 床に弾かれて剣が持ち上がり、体が反動で少し起きる */
const REBOUND = {
  hips: { yaw: -10, pitch: 9, z: 0.09, y: -0.26 },
  chest: { yaw: -22, pitch: 15 },
  head: { yaw: -6 },
  grip: [-16, 20, 0.45] as V3,
  blade: [0.5, 0.0, 0.86] as V3,
  face: [-0.78, -0.62, 0] as V3,
  roll: -150,
  pole: [-0.5, -0.8, 0] as V3,
};

/** 落ち着き: もう一度沈んで、剣先が床の上で止まる */
const SETTLE = {
  ...IMPACT,
  hips: { yaw: -12, pitch: 14, z: 0.1, y: -0.3 },
  grip: [-16, 8, 0.46] as V3,
  blade: [0.5, -0.2, 0.84] as V3,
};

/** 落ち着いた姿勢を保つ時刻（跳ね上げ gsBounce の受付。AttackDef.cancelAt と同じ。0.5〜0.62 で保つ。ルートは 0.42 で止まる。ADR-047） */
export const GS_DROP_HOLD_T = 0.52;

/**
 * 叩き落とし: 2 段目の振り抜きの終わり（0.46s）の姿勢から続けて始まる（continueFrom）。
 * 0 → 0.14 右肩の後ろへ振りかぶる（0.14〜0.18 は頂点で一拍）/ 0.18 → 0.29 斜めに振り下ろす（0.24 に最高速、0.29 に切っ先が床を叩く。左足は 0.24 に着地）/
 * 0.29 → 0.37 跳ね返る / 0.37 → 0.5 沈んで落ち着く / 0.5 → 0.62 保つ / 0.62 → 1.0 戻り。
 * 踏み込み: 左足が 0.12 に床を離れ、0.24 に腰の 0.45 m 前（開始位置から 0.7 m）へ着地する。右足は残して引きずる。ルートは 0.1 から 0.29 までに 0.5 m、減速して 0.42 までに 0.8 m。
 */
export const GS_DROP: AuthoredAttack = {
  name: 'gsDrop',
  duration: 1.0,
  twoHanded: GS_TWO_HAND,
  continueFrom: { attack: GS2, t: 0.46 },
  keys: [
    // ---- 下半身（足の z は、この技の開始時のルートからの前進量。2 段目の終わりは左足 −0.35、右足 0.02）----
    { t: 0.1, ease: 'lin', rootZ: 0 },
    { t: 0.29, ease: 'in', rootZ: 0.5 },
    { t: 0.42, ease: 'out', rootZ: 0.8 },
    { t: 0.1, ease: 'lin', footL: { z: -0.35 } },
    { t: 0.24, ease: 'io', footL: { z: 0.7, arc: 0.15 } },
    { t: 0.62, ease: 'lin', footL: { z: 0.7 } },
    { t: 1.0, ease: 'io', footL: { z: 0.8, arc: 0.02 } },
    { t: 0.1, ease: 'lin', footR: { z: 0.02 } },
    { t: 0.24, ease: 'io', footR: { z: 0.14, arc: 0 } },
    { t: 0.4, ease: 'out', footR: { z: 0.5, arc: 0.08 } },
    { t: 0.62, ease: 'lin', footR: { z: 0.5 } },
    { t: 1.0, ease: 'io', footR: { z: 0.8, arc: 0.1 } },
    // ---- 振りかぶる → 振り下ろす → 床に当たる → 跳ね返る → 落ち着く → 保つ → 戻る ----
    ...pose(0.14, 'io', RAISE),
    ...pose(0.18, 'lin', RAISE),
    ...pose(0.24, 'in', PASS),
    ...pose(0.29, 'in', IMPACT),
    ...pose(0.31, 'lin', IMPACT),
    ...pose(0.37, 'out', REBOUND),
    ...pose(0.5, 'io', SETTLE),
    ...pose(0.62, 'lin', SETTLE),
    ...pose(1.0, 'io', GS_READY),
  ],
};
