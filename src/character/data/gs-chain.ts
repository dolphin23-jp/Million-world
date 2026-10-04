import type { AuthoredAttack } from '../authoring';
import { plane } from './cutting-plane';
import { GS_READY, GS_TWO_HAND } from './greatsword';
import { GS1 } from './gs-combo';
import { pose } from './stagger';

/**
 * 大剣のコンボの分岐の技（ADR-023）。両手持ち（greatsword.ts）。座標の約束は combo1.ts と同じ（胸の座標系）。
 * 1 段目の受付（gs1 の 0.56s の姿勢）から、スティックの向きで続きが変わる。
 */

type V3 = [number, number, number];

// ---------------------------------------------------------------- 連携回転斬り（1 段目の受付で横へ倒して攻撃）

/** 巻き込み: 1 段目の振り抜き（左前下）からさらに左へ引き込み、腰を深く沈める（跳び上がる前の溜め）。剣は左前へ水平に寝かせる */
const SPIN2_COIL = {
  hips: { yaw: -24, pitch: 8, z: 0.02, y: -0.26 },
  chest: { yaw: -46, pitch: 10 },
  head: { yaw: -12 },
  grip: [-24, -6, 0.4] as V3,
  ...plane(-40, 0),
  roll: 120,
  pole: [-0.5, -0.8, 0.1] as V3,
};

/** 回転中の腕と剣（胸の座標で一定）: 剣は体の左前へ水平に伸びる。右へ回るので、剣は正面 → 右 → 後ろ → 左と円を描く */
const SPIN2_ARMS = {
  grip: [-20, 2, 0.4] as V3,
  ...plane(-38, 0),
  roll: 120,
  pole: [-0.5, -0.8, 0.1] as V3,
};

/**
 * 連携回転斬り（1 段目の受付で、スティックを横へ倒して攻撃）: 左前下へ振り抜いた剣を引き込んで沈み、跳び上がって体ごと右へ 1 回転しながら、水平の円を描いて薙ぎ払う。
 * 1 段目の流れで正面を先に薙いで全方位へ回る（大回転斬り gsSpin は左回り。こちらは右回り）。全方位を薙ぐ広い技。
 * 1 段目の受付時点（0.56s）の姿勢から続けて始まる（continueFrom）。
 * 0 → 0.14 引き込んで沈む / 0.14 → 0.42 跳び上がって回る（0.2〜0.38 に剣が全周を通る）/ 0.42 → 0.52 着地して沈む / 0.52 → 0.64 保つ / 0.64 → 1.0 戻り。
 * ルートは 0.14 から 0.42 までに 0.6 m 前へ。足は跳ぶまで世界に固定 → 跳んでいるあいだ腰に付いて回る → 着地で世界に固定。
 */
export const GS_SPIN2: AuthoredAttack = {
  name: 'gsSpin2',
  duration: 1.0,
  twoHanded: GS_TWO_HAND,
  continueFrom: { attack: GS1, t: 0.56 },
  keys: [
    // ---- ルート ----
    { t: 0.14, ease: 'lin', rootZ: 0 },
    { t: 0.28, ease: 'in', rootZ: 0.25 },
    { t: 0.42, ease: 'out', rootZ: 0.6 },
    // ---- 足（開始時は 1 段目の終わりの位置: 左足 0、右足 −0.2）----
    { t: 0.14, ease: 'lin', footL: { rel: 0, z: 0, lift: 0 }, footR: { rel: 0, z: -0.2, lift: 0 } },
    { t: 0.19, ease: 'io', footL: { rel: 1, lx: 0.11, ly: -0.64, lz: 0.08, knee: 1 }, footR: { rel: 1, lx: -0.11, ly: -0.66, lz: -0.04, knee: 1 } },
    { t: 0.38, ease: 'lin', footL: { rel: 1, lx: 0.11, ly: -0.7, lz: 0.06, knee: 0.4 }, footR: { rel: 1, lx: -0.11, ly: -0.7, lz: -0.04, knee: 0.4 } },
    { t: 0.44, ease: 'io', footL: { rel: 0, z: 0.7, x: 0, lift: 0, pitch: 0 }, footR: { rel: 0, z: 0.55, x: 0, lift: 0, pitch: 0 } },
    { t: 1.0, ease: 'io', footL: { z: 0.6 }, footR: { z: 0.6 } },
    // ---- 腰: 沈む（0.14）→ 跳ぶ → 着地で沈む → 立つ ----
    { t: 0.26, ease: 'out', hips: { y: 0.2 } },
    { t: 0.36, ease: 'lin', hips: { y: 0.16 } },
    { t: 0.46, ease: 'in', hips: { y: -0.2 } },
    { t: 0.64, ease: 'lin', hips: { y: -0.2 } },
    // ---- 体の回転（ヨー。腰・胸が 360° 右へ回る）と腕 ----
    ...pose(0.14, 'io', SPIN2_COIL),
    { t: 0.24, ease: 'out', ...SPIN2_ARMS },
    { t: 0.38, ease: 'lin', ...SPIN2_ARMS, hips: { yaw: 336 }, chest: { yaw: 316 }, head: { yaw: 348 } },
    { t: 0.46, ease: 'out', hips: { yaw: 346, pitch: 10 }, chest: { yaw: 330, pitch: 12 }, head: { yaw: 350 } },
    { t: 0.64, ease: 'lin', hips: { yaw: 346, pitch: 10 }, chest: { yaw: 330, pitch: 12 }, head: { yaw: 350 } },
    // 戻り: 回転は 360° で元の向きに戻っているので、構えの姿勢の値は 360° 足したもの
    ...pose(1.0, 'io', { ...GS_READY, hips: { ...GS_READY.hips, yaw: GS_READY.hips.yaw + 360 }, chest: { ...GS_READY.chest, yaw: GS_READY.chest.yaw + 360 }, head: { yaw: GS_READY.head.yaw + 360 } }),
  ],
};
