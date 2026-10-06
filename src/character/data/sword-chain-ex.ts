import type { AuthoredAttack } from '../authoring';
import { plane } from './cutting-plane';
import { GATHER as DASH_GATHER, RISE as DASH_RISE } from './dash';
import { OFFHAND } from './offhand';
import { pose } from './stagger';
import { COMBO_SPIN } from './combo-chain';
import { FOLLOW as FOLLOW2 } from './combo2';
import { COMBO_SLAM, SLAM_HOLD_T } from './sword-chain';
import { RETURN } from './skill-sword';

/**
 * 片手剣の連携の続き 第 2 弾（ADR-047）。座標の約束は combo1.ts と同じ（胸の座標系）。
 * 連携の終わりの技の受付（前の技の保持の姿勢を保っている間）に、スティックを倒して攻撃を押すと続く（前 = 踏み込み・叩き、横 = 回転・薙ぎ、後ろ = 引き・跳び退き）:
 *   落下斬り →（前）地擦り斬り上げ → 燕返し（最長 7 連: 袈裟 → 逆袈裟 → 突き →（前）打ち上げ → 落下斬り →（前）地擦り斬り上げ → 燕返し）。
 * どれも前の技の保持の姿勢から続けて始まる（continueFrom）。盾を持つとき（左腕を盾の位置に固定して焼く版）は左手のキーが使われない。
 */

type V3 = [number, number, number];

/** 体の向き（腰・胸・頭のヨー）を d 度ずらした姿勢。回転で巻かれた座標系の続きを書くのに使う */
function turnPose<T extends { hips: { yaw: number }; chest: { yaw: number }; head: { yaw: number } }>(p: T, d: number): T {
  return { ...p, hips: { ...p.hips, yaw: p.hips.yaw + d }, chest: { ...p.chest, yaw: p.chest.yaw + d }, head: { ...p.head, yaw: p.head.yaw + d } };
}

// ---------------------------------------------------------------- 地擦り斬り上げ（落下斬りの受付で前へ倒して攻撃）

/** すくい上げの途中（体の前を通る最高速）: 床を叩いた剣が、前の低い所から右下 → 左上の斜めの面を駆け上がる（ダッシュ斬りの斬り上げと同じ面） */
const RIP_PASS = {
  hips: { yaw: -6, pitch: 6, z: 0.06, y: -0.22 },
  chest: { yaw: -8, pitch: 8 },
  head: { yaw: -4 },
  grip: [10, 2, 0.46] as V3,
  ...plane(-8, -35),
  roll: 70,
  pole: [-0.4, -0.85, -0.1] as V3,
  ...OFFHAND.pull,
};

/** 斬り上げの受付の時刻（左上へ振り上げて体を反らせた姿勢を 0.28〜0.42 で保つ）。AttackDef.cancelAt と同じ */
export const SLAM_RIP_HOLD_T = 0.34;

/**
 * 地擦り斬り上げ（落下斬りの受付で、スティックを前へ倒して攻撃）: 床に叩きつけて止まった剣を、そのまま地面をかすめて右下から左上へ斬り上げる。叩きつけの衝撃で浮いた敵を追う返しの一撃。
 * 落下斬りの受付（SLAM_HOLD_T。叩きつけた姿勢を保っている間）から続けて始まる（continueFrom）。
 * 0 → 0.08 剣を右の低い所へ引き込む / 0.08 → 0.17 すくい上げる（0.17 に前を通る最高速。右足は 0.17 に着地）/ 0.17 → 0.28 左上へ振り上げて体を反らせる / 0.28 → 0.42 保つ / 0.42 → 0.64 戻り。
 * ルートは 0.04 から 0.28 までに 0.5 m 前へ。足は世界に固定（落下斬りの終わりは前の足が右）。
 */
export const SLAM_RIP: AuthoredAttack = {
  name: 'slamRip',
  duration: 0.64,
  continueFrom: { attack: COMBO_SLAM, t: SLAM_HOLD_T },
  keys: [
    // ---- 下半身: 右足が前へ踏み出す。左足は残って、あとで引きつける ----
    { t: 0.04, ease: 'lin', rootZ: 0 },
    { t: 0.17, ease: 'in', rootZ: 0.28 },
    { t: 0.28, ease: 'out', rootZ: 0.5 },
    { t: 0.04, ease: 'lin', footR: { arc: 0 } },
    { t: 0.17, ease: 'io', footR: { z: 0.62, arc: 0.1 } },
    { t: 0.42, ease: 'lin', footR: { z: 0.62 } },
    { t: 0.64, ease: 'io', footR: { z: 0.5, arc: 0.03 } },
    { t: 0.12, ease: 'lin', footL: { arc: 0 } },
    { t: 0.28, ease: 'out', footL: { z: 0.26, arc: 0.06 } },
    { t: 0.42, ease: 'lin', footL: { z: 0.26 } },
    { t: 0.64, ease: 'io', footL: { z: 0.5, arc: 0.1 } },
    // ---- 引き込む → すくい上げる → 振り上げる → 保つ → 戻る ----
    ...pose(0.08, 'io', DASH_GATHER),
    ...pose(0.17, 'in', RIP_PASS),
    ...pose(0.28, 'out', DASH_RISE),
    ...pose(0.42, 'lin', DASH_RISE),
    ...pose(0.64, 'io', RETURN),
  ],
};

// ---------------------------------------------------------------- 燕返し（地擦り斬り上げの受付で攻撃）

/** 二つの太刀の途中（体の前を通る最高速）: 斜めの面（右下 ⇄ 左上）の真ん中を剣が駆け抜ける。体は正面を向き、沈んで前へ倒れ込む */
const SWALLOW_PASS = {
  ...RIP_PASS,
  hips: { yaw: 2, pitch: 6, z: 0.06, y: -0.2 },
  chest: { yaw: 2, pitch: 8 },
  head: { yaw: 0 },
};

/** 斬り下ろしの終わり（右下の低い所へ抜ける）: 体は右へひねり切る。剣は右後ろの低い所（ダッシュ斬りの溜めの姿勢）。ここから切り返す */
const SWALLOW_LOW = { ...DASH_GATHER, hips: { yaw: 16, pitch: 12, z: 0, y: -0.26 }, chest: { yaw: 26, pitch: 16 } };

/**
 * 燕返し（地擦り斬り上げの受付で、押して攻撃）: 左上へ斬り上げた剣を、同じ線をたどって右下へ斬り下ろし、そのまま間を置かず斬り上げ返す。二つの太刀が 1 つの技（連携の 7 連目。締め）。
 * 地擦り斬り上げの受付（SLAM_RIP_HOLD_T。振り上げた姿勢を保っている間）から続けて始まる（continueFrom）。
 * 0 → 0.15 斬り下ろす（0.15 に前を通る最高速。左足は 0.15 に着地）/ 0.15 → 0.22 右下へ抜ける / 0.22 → 0.28 斬り上げ返す（0.28 に前を通る最高速。右足は 0.28 に着地）/ 0.28 → 0.36 左上へ振り上げる /
 * 0.36 → 0.46 保つ / 0.46 → 0.68 戻り。当たりは 2 つ（0.135〜0.185 の斬り下ろしと、0.265〜0.315 の斬り上げ返し。2 つ目が強い）。
 * ルートは 0.05 から 0.36 までに 0.4 m 前へ。足は世界に固定（地擦り斬り上げの終わりは前の足が右）。
 */
export const SWALLOW: AuthoredAttack = {
  name: 'swallow',
  duration: 0.68,
  continueFrom: { attack: SLAM_RIP, t: SLAM_RIP_HOLD_T },
  keys: [
    // ---- 下半身: 左足が前へ出て斬り下ろし、右足が前へ出て斬り上げ返す ----
    { t: 0.05, ease: 'lin', rootZ: 0 },
    { t: 0.15, ease: 'in', rootZ: 0.16 },
    { t: 0.28, ease: 'lin', rootZ: 0.32 },
    { t: 0.36, ease: 'out', rootZ: 0.4 },
    { t: 0.04, ease: 'lin', footL: { arc: 0 } },
    { t: 0.15, ease: 'io', footL: { z: 0.4, arc: 0.1 } },
    { t: 0.46, ease: 'lin', footL: { z: 0.4 } },
    { t: 0.68, ease: 'io', footL: { z: 0.4, arc: 0.1 } },
    { t: 0.17, ease: 'lin', footR: { arc: 0 } },
    { t: 0.28, ease: 'io', footR: { z: 0.72, arc: 0.1 } },
    { t: 0.46, ease: 'lin', footR: { z: 0.72 } },
    { t: 0.68, ease: 'io', footR: { z: 0.4, arc: 0.04 } },
    // ---- 斬り下ろす → 右下へ抜ける → 斬り上げ返す → 振り上げる → 保つ → 戻る ----
    ...pose(0.15, 'in', SWALLOW_PASS),
    ...pose(0.22, 'out', SWALLOW_LOW),
    ...pose(0.28, 'in', { ...SWALLOW_PASS, hips: { yaw: -2, pitch: 6, z: 0.08, y: -0.22 }, chest: { yaw: -4, pitch: 8 } }),
    ...pose(0.36, 'out', DASH_RISE),
    ...pose(0.46, 'lin', DASH_RISE),
    ...pose(0.68, 'io', RETURN),
  ],
};

// ---------------------------------------------------------------- 逆回転斬り（回転斬りの受付で、ロック中に横へ倒して攻撃）

/** 回転斬りの受付の時刻（着地して沈み、剣を右へ水平に伸ばした姿勢を 0.4〜0.5 で保つ）。AttackDef.cancelAt と同じ。回転は 360° 巻かれているので、続きのクリップの体のヨーは「−348° 付近」の座標で書く */
export const SPIN_HOLD_T = 0.44;
/** 回転斬りの終わりで体が巻かれている量（度）。続きのクリップは、この座標系で書く（腰のヨー −348° = 向きとしては +12°） */
const SPIN_TURNS = -360;

/** 逆回転の溜め: 右へ振り抜いた剣を左へ引き込み、体を左へ戻して沈む。剣は左へ水平に寝かせる（返し薙ぎの引き込みと同じ姿勢） */
const REV_COIL = {
  hips: { yaw: -24, pitch: 8, z: 0.02, y: -0.2 },
  chest: { yaw: -48, pitch: 8 },
  head: { yaw: -12 },
  grip: [-52, 4, 0.42] as V3,
  ...plane(-80, 0),
  roll: -30,
  pole: [-0.5, -0.8, 0] as V3,
  ...OFFHAND.guard,
};

/** 逆回転中の腕と剣（胸の座標で一定）: 剣は体の左前へ水平に伸びる。右へ回るので、剣は正面 → 右 → 後ろ → 左と円を描く */
const REV_ARMS = {
  grip: [-20, 2, 0.44] as V3,
  ...plane(-66, 0),
  roll: -30,
  pole: [-0.5, -0.8, 0.1] as V3,
  ...OFFHAND.hip,
};

/** 逆回転の着地の姿勢: 左へ剣を伸ばしたまま沈む（回転斬りの終わりの鏡像）。続く回転斬り上げ（spinRise）の受付で保つ */
const REV_LAND = {
  ...REV_ARMS,
  hips: { yaw: -12, pitch: 10, z: 0.02, y: -0.18 },
  chest: { yaw: -30, pitch: 12 },
  head: { yaw: -10 },
};

/** 逆回転斬りの受付の時刻（着地した姿勢を 0.44〜0.54 で保つ）。AttackDef.cancelAt と同じ */
export const SPIN_REV_HOLD_T = 0.46;

/**
 * 逆回転斬り（回転斬りの受付で、ロック中にスティックを横へ倒して攻撃）: 右へ回り切った体を左へ引き戻して沈み、跳び上がって今度は体ごと右へ 1 回転しながら、左から水平の円を描く。回転斬りと逆向きの旋風の 2 つ目。
 * 全方位を薙ぐ。回転斬りの受付（SPIN_HOLD_T）から続けて始まる（continueFrom。回転斬りは体を 360° 巻いて終わるので、始まりのヨーは −348° 付近の座標で書く）。
 * 0 → 0.12 引き戻して沈む / 0.12 → 0.34 跳び上がって回る（0.16〜0.32 に剣が全周を通る）/ 0.34 → 0.42 着地して沈む / 0.42 → 0.56 保つ / 0.56 → 0.84 戻り。
 * ルートは 0.12 から 0.34 までに 0.45 m 前へ。足は跳ぶまで世界に固定 → 腰に付いて回る → 着地で世界に固定。
 */
export const SPIN_REV: AuthoredAttack = {
  name: 'spinRev',
  duration: 0.84,
  continueFrom: { attack: COMBO_SPIN, t: SPIN_HOLD_T },
  keys: [
    // ---- ルート ----
    { t: 0.12, ease: 'lin', rootZ: 0 },
    { t: 0.24, ease: 'in', rootZ: 0.18 },
    { t: 0.34, ease: 'out', rootZ: 0.45 },
    // ---- 足（跳ぶまで受け取った位置 → 腰にぶら下がる → 着地） ----
    { t: 0.12, ease: 'lin', footL: { arc: 0 }, footR: { arc: 0 } },
    { t: 0.16, ease: 'io', footL: { rel: 1, lx: 0.11, ly: -0.64, lz: 0.06, knee: 1 }, footR: { rel: 1, lx: -0.11, ly: -0.66, lz: -0.04, knee: 1 } },
    { t: 0.3, ease: 'lin', footL: { rel: 1, lx: 0.11, ly: -0.7, lz: 0.06, knee: 0.4 }, footR: { rel: 1, lx: -0.11, ly: -0.7, lz: -0.04, knee: 0.4 } },
    { t: 0.36, ease: 'io', footL: { rel: 0, z: 0.5, x: 0, lift: 0, pitch: 0 }, footR: { rel: 0, z: 0.36, x: 0, lift: 0, pitch: 0 } },
    { t: 0.84, ease: 'io', footL: { z: 0.45 }, footR: { z: 0.45 } },
    // ---- 腰: 沈む（0.12）→ 跳ぶ → 着地で沈む → 立つ ----
    { t: 0.22, ease: 'out', hips: { y: 0.18 } },
    { t: 0.3, ease: 'lin', hips: { y: 0.14 } },
    { t: 0.38, ease: 'in', hips: { y: -0.18 } },
    { t: 0.54, ease: 'lin', hips: { y: -0.18 } },
    // ---- 体の回転（ヨー。腰・胸が 360° 右へ回る。回転斬りの終わりの座標 −360° から始まる）と腕 ----
    ...pose(0.12, 'io', turnPose(REV_COIL, SPIN_TURNS)),
    { t: 0.2, ease: 'out', ...REV_ARMS },
    { t: 0.34, ease: 'lin', ...REV_ARMS, hips: { yaw: -24 }, chest: { yaw: -48 }, head: { yaw: -12 } },
    ...pose(0.42, 'out', REV_LAND),
    ...pose(0.56, 'lin', REV_LAND),
    ...pose(0.84, 'io', RETURN),
  ],
};

// ---------------------------------------------------------------- 回転斬り上げ（逆回転斬りの受付で攻撃）

/** 跳ぶ前の溜め: 左へ伸ばした剣を左の低い所へ引き、腰を沈める */
const RISE_COIL = {
  hips: { yaw: -22, pitch: 10, z: 0.03, y: -0.2 },
  chest: { yaw: -38, pitch: 16 },
  head: { yaw: -14 },
  grip: [-58, -40, 0.4] as V3,
  ...plane(-84),
  roll: -15,
  pole: [-0.5, -0.8, 0] as V3,
  ...OFFHAND.hip,
};

/** 斬り上げの途中（体の前を通る最高速）: 左下から前を通って右上へ。前へ跳びながら、体は少し反る */
const RISE_PASS = {
  hips: { yaw: -2, pitch: -4, z: 0.02, y: 0.1 },
  chest: { yaw: 0, pitch: -4 },
  head: { yaw: 0 },
  grip: [6, 10, 0.46] as V3,
  ...plane(6),
  roll: -20,
  pole: [-0.35, -0.9, -0.15] as V3,
  ...OFFHAND.pull,
};

/** 斬り上げの終わり: 剣は右上へ抜け、体は右へ。着地して保つ（2 段目の逆袈裟の終わりに近い） */
const RISE_END = { ...FOLLOW2, hips: { yaw: 12, pitch: 4, z: 0.02, y: -0.12 } };

/** 回転斬り上げの受付の時刻（着地して右上へ抜けた姿勢を 0.46〜0.56 で保つ）。AttackDef.cancelAt と同じ */
export const SPIN_RISE_HOLD_T = 0.48;

/**
 * 回転斬り上げ（逆回転斬りの受付で攻撃）: 回り切って左へ伸ばした剣を左下へ引き込み、前へ跳び上がりながら左下から右上へ斬り上げる。旋風の締めの 3 つ目（敵を打ち上げる強い一撃）。
 * 逆回転斬りの受付（SPIN_REV_HOLD_T。着地して剣を伸ばした姿勢を保っている間）から続けて始まる（continueFrom）。
 * 0 → 0.1 引き込んで沈む / 0.1 → 0.26 跳びながら斬り上げる（0.2 に前を通る最高速）/ 0.26 → 0.32 右上へ抜ける / 0.32 → 0.42 滞空して着地 / 0.42 → 0.56 保つ / 0.56 → 0.8 戻り。
 * ルートは 0.1 から 0.34 までに 0.6 m 前へ。足は蹴るまで世界に固定 → 跳んでいるあいだ腰にぶら下がる → 着地で世界に固定。
 */
export const SPIN_RISE: AuthoredAttack = {
  name: 'spinRise',
  duration: 0.8,
  continueFrom: { attack: SPIN_REV, t: SPIN_REV_HOLD_T },
  keys: [
    // ---- ルート ----
    { t: 0.1, ease: 'lin', rootZ: 0 },
    { t: 0.2, ease: 'in', rootZ: 0.2 },
    { t: 0.34, ease: 'out', rootZ: 0.6 },
    // ---- 足 ----
    { t: 0.1, ease: 'lin', footL: { arc: 0 }, footR: { arc: 0 } },
    { t: 0.16, ease: 'io', footL: { rel: 1, lx: 0.11, ly: -0.7, lz: -0.04, knee: 0.3 }, footR: { rel: 1, lx: -0.11, ly: -0.7, lz: 0.06, knee: 0.3 } },
    { t: 0.3, ease: 'lin', footL: { rel: 1, lx: 0.11, ly: -0.72, lz: 0.02, knee: 0.1 }, footR: { rel: 1, lx: -0.11, ly: -0.72, lz: 0.04, knee: 0.1 } },
    { t: 0.38, ease: 'io', footL: { rel: 0, z: 0.4, x: 0, lift: 0, pitch: 0 }, footR: { rel: 0, z: 0.85, x: 0, lift: 0, pitch: 0 } },
    { t: 0.8, ease: 'io', footL: { z: 0.6 }, footR: { z: 0.6 } },
    // ---- 腰: 沈む（0.1）→ 跳ぶ → 着地で沈む → 立つ ----
    { t: 0.22, ease: 'out', hips: { y: 0.16 } },
    { t: 0.3, ease: 'lin', hips: { y: 0.16 } },
    { t: 0.4, ease: 'in', hips: { y: -0.16 } },
    { t: 0.56, ease: 'lin', hips: { y: -0.16 } },
    // ---- 引き込む → 斬り上げる → 右上へ抜ける → 着地 → 保つ → 戻る ----
    ...pose(0.1, 'io', RISE_COIL),
    ...pose(0.2, 'in', RISE_PASS),
    ...pose(0.3, 'out', RISE_END),
    ...pose(0.42, 'io', { ...RISE_END, hips: { yaw: 12, pitch: 4, z: 0.02, y: -0.16 } }),
    ...pose(0.56, 'lin', { ...RISE_END, hips: { yaw: 12, pitch: 4, z: 0.02, y: -0.16 } }),
    ...pose(0.8, 'io', RETURN),
  ],
};
