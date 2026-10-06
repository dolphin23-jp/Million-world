import type { AuthoredAttack } from '../authoring';
import { plane } from './cutting-plane';
import { GS_READY, GS_TWO_HAND } from './greatsword';
import { COIL2, FINISH2, PASS2 } from './gs-combo';
import { GS_DROP, GS_DROP_HOLD_T } from './gs-drop';
import { GS_LUNGE_SWEEP, GS_LUNGE_SWEEP_HOLD_T, GS_SPIN2, GS_SPIN2_HOLD_T } from './gs-chain';
import { PASS as SMASH_PASS, SMASH, TOP } from './gs-heavy';
import { LEAP_GATHER, LEAP_TOP, SLAM, SPIN_ARMS, SPIN_COIL } from './gs-moves';
import { pose } from './stagger';

/**
 * 大剣の連携の続き 第 2 弾（ADR-047）。両手持ち（greatsword.ts）。座標の約束は combo1.ts と同じ（胸の座標系）。
 * 連携の終わりの技の受付（前の技の保持の姿勢を保っている間）に、スティックを倒して攻撃を押すと続く（前 = 踏み込み・叩き、横 = 回転・薙ぎ）:
 *   叩き落とし →（前）跳ね上げ → 大叩き割り（最長 5 連: 袈裟 → 逆袈裟 →（前）叩き落とし →（前）跳ね上げ → 大叩き割り）。
 *   連携回転斬り →（横）逆の大回転 →（前）回転叩きつけ / 突き払い → 薙ぎ返し。
 * どれも前の技の保持の姿勢から続けて始まる（continueFrom）。足の始まりは「arc だけのキー」で前の技から受け取った位置のまま保つ。
 */

type V3 = [number, number, number];

// ---------------------------------------------------------------- 跳ね上げ（叩き落としの受付で前へ倒して攻撃）

/** 跳ね上げの終わり: 剣は右上へ抜け、体は右へひねり切って、床を蹴った反動で起き上がる（逆袈裟の終わりより腰が高い） */
const BOUNCE_END = { ...FINISH2, hips: { yaw: 14, pitch: -2, z: 0.04, y: -0.04 }, chest: { yaw: 30, pitch: -4 } };

/** 跳ね上げの溜め・途中の左肘の向き（下向き。左手首のねじれを減らす） */
const BOUNCE_ELBOW: V3 = [0.4, -0.9, -0.2];

/** 跳ね上げの受付の時刻（右上へ抜けて起き上がった姿勢を 0.3〜0.5 で保つ）。AttackDef.cancelAt と同じ */
export const GS_BOUNCE_HOLD_T = 0.46;

/**
 * 跳ね上げ（叩き落としの受付で、スティックを前へ倒して攻撃）: 床を叩いて弾かれた剣の反動を使い、左下から右上へ一気に斬り上げる。叩き落としで浮いた敵を、さらに高く跳ね上げる。
 * 叩き落としの受付（GS_DROP_HOLD_T。落ち着いた姿勢を保っている間）から続けて始まる（continueFrom）。
 * 0 → 0.14 左へ巻き込んで沈む / 0.14 → 0.21 斬り上げる（0.21 に前を通る最高速。右足は 0.21 に着地）/ 0.21 → 0.31 右上へ振り抜いて起き上がる / 0.31 → 0.5 保つ / 0.5 → 0.9 戻り。
 * ルートは 0.06 から 0.34 までに 0.6 m 前へ。足は世界に固定（叩き落としの終わりは左足が前、右足が後ろ）。
 */
export const GS_BOUNCE: AuthoredAttack = {
  name: 'gsBounce',
  duration: 0.9,
  twoHanded: GS_TWO_HAND,
  continueFrom: { attack: GS_DROP, t: GS_DROP_HOLD_T },
  keys: [
    // ---- 下半身: 後ろにいた右足が弧を描いて前へ着地する。左足は残って、あとで引きつける ----
    { t: 0.06, ease: 'lin', rootZ: 0 },
    { t: 0.21, ease: 'in', rootZ: 0.3 },
    { t: 0.34, ease: 'out', rootZ: 0.6 },
    { t: 0.06, ease: 'lin', footR: { arc: 0 } },
    { t: 0.21, ease: 'io', footR: { z: 0.62, arc: 0.14 } },
    { t: 0.5, ease: 'lin', footR: { z: 0.62 } },
    { t: 0.9, ease: 'io', footR: { z: 0.6, arc: 0.03 } },
    { t: 0.2, ease: 'lin', footL: { arc: 0 } },
    { t: 0.34, ease: 'out', footL: { z: 0.25, arc: 0.06 } },
    { t: 0.5, ease: 'lin', footL: { z: 0.25 } },
    { t: 0.9, ease: 'io', footL: { z: 0.6, arc: 0.1 } },
    // ---- 巻き込む → 斬り上げる → 振り抜く → 保つ → 戻る（左肘は下向き。逆袈裟 gs2 と同じ姿勢のままだと左手首のねじれが 163° になる。motionlab で 145° に） ----
    ...pose(0.14, 'io', { ...COIL2, leftPole: BOUNCE_ELBOW }),
    ...pose(0.21, 'in', { ...PASS2, leftPole: BOUNCE_ELBOW }),
    ...pose(0.31, 'out', BOUNCE_END),
    ...pose(0.5, 'lin', BOUNCE_END),
    ...pose(0.9, 'io', GS_READY),
  ],
};

// ---------------------------------------------------------------- 大叩き割り（跳ね上げの受付で攻撃）

/**
 * 大叩き割り（跳ね上げの受付で攻撃。大剣の 5 連目）: 右上へ振り上げた剣をそのまま頭上へ引き上げ、右足を大きく踏み込んで、真上から真下へ叩き割る。衝撃の輪が広がる、連携の締めの重い一撃。
 * 跳ね上げの受付（GS_BOUNCE_HOLD_T）から続けて始まる（continueFrom）。
 * 0 → 0.16 頭上へ引き上げる（0.16〜0.2 は頂点で一拍）/ 0.2 → 0.27 振り下ろす（0.27 に最高速。右足は 0.27 に着地）/ 0.27 → 0.34 叩きつけて止まる（0.33 に切っ先が床を叩く）/ 0.34 → 0.62 保つ / 0.62 → 1.0 戻り。
 * ルートは 0.08 から 0.27 までに 0.5 m、減速して 0.42 までに 0.75 m。足は世界に固定（跳ね上げの終わりは右足が前、左足が後ろ）。
 */
export const GS_CRUSH: AuthoredAttack = {
  name: 'gsCrush',
  duration: 1.0,
  twoHanded: GS_TWO_HAND,
  continueFrom: { attack: GS_BOUNCE, t: GS_BOUNCE_HOLD_T },
  keys: [
    // ---- 下半身: 右足が追い足で大きく踏み込む。左足は残って、叩きつけたあと引きつける ----
    { t: 0.08, ease: 'lin', rootZ: 0 },
    { t: 0.27, ease: 'in', rootZ: 0.5 },
    { t: 0.42, ease: 'out', rootZ: 0.75 },
    { t: 0.1, ease: 'lin', footR: { arc: 0 } },
    { t: 0.27, ease: 'io', footR: { z: 1.0, arc: 0.14 } },
    { t: 0.62, ease: 'lin', footR: { z: 1.0 } },
    { t: 1.0, ease: 'io', footR: { z: 0.75, arc: 0.03 } },
    { t: 0.22, ease: 'lin', footL: { arc: 0 } },
    { t: 0.42, ease: 'out', footL: { z: 0.4, arc: 0.07 } },
    { t: 0.62, ease: 'lin', footL: { z: 0.4 } },
    { t: 1.0, ease: 'io', footL: { z: 0.75, arc: 0.1 } },
    // ---- 引き上げる → 振り下ろす → 叩きつける → 保つ → 戻る ----
    ...pose(0.16, 'io', TOP),
    ...pose(0.2, 'lin', TOP),
    ...pose(0.27, 'in', SMASH_PASS),
    ...pose(0.33, 'in', SMASH),
    ...pose(0.62, 'lin', SMASH),
    ...pose(1.0, 'io', GS_READY),
  ],
};

// ---------------------------------------------------------------- 逆の大回転（連携回転斬りの受付で、ロック中に横へ倒して攻撃）

/** 連携回転斬りの受付のあとに続ける回転は、右へ 360° 巻かれた座標（+360°）の続き。回転の溜めは大回転斬り（gsSpin）と同じ姿勢 */
const TURN = 360;

/** 逆の大回転の着地の姿勢（大回転斬りの終わりと同じ。体の向きは回転が済んだ座標で書く） */
const SPIN3_LAND = {
  ...SPIN_ARMS,
  hips: { yaw: 14, pitch: 10, z: 0, y: -0.2 },
  chest: { yaw: 38, pitch: 12 },
  head: { yaw: 10 },
};

/** 逆の大回転の受付の時刻（着地して沈んだ姿勢を 0.46〜0.64 で保つ）。AttackDef.cancelAt と同じ */
export const GS_SPIN3_HOLD_T = 0.5;

/**
 * 逆の大回転（連携回転斬りの受付で、ロック中にスティックを横へ倒して攻撃）: 右へ回り切った体を右へ巻き込んで沈み、跳び上がって今度は体ごと左へ 1 回転しながら、水平の円を描く。連携回転斬り（右回り）と逆向きの旋風。
 * 連携回転斬りの受付（GS_SPIN2_HOLD_T）から続けて始まる（continueFrom。連携回転斬りは体を 360° 巻いて終わるので、始まりのヨーは +360° の座標で書く）。
 * 0 → 0.14 巻き込んで沈む / 0.14 → 0.42 跳び上がって回る（0.2〜0.38 に剣が全周を通る）/ 0.42 → 0.52 着地して沈む / 0.52 → 0.64 保つ / 0.64 → 1.0 戻り。
 * ルートは 0.14 から 0.42 までに 0.55 m 前へ。足は跳ぶまで世界に固定 → 跳んでいるあいだ腰に付いて回る → 着地で世界に固定。
 */
export const GS_SPIN3: AuthoredAttack = {
  name: 'gsSpin3',
  duration: 1.0,
  twoHanded: GS_TWO_HAND,
  continueFrom: { attack: GS_SPIN2, t: GS_SPIN2_HOLD_T },
  keys: [
    // ---- ルート ----
    { t: 0.14, ease: 'lin', rootZ: 0 },
    { t: 0.28, ease: 'in', rootZ: 0.22 },
    { t: 0.42, ease: 'out', rootZ: 0.55 },
    // ---- 足 ----
    { t: 0.14, ease: 'lin', footL: { arc: 0 }, footR: { arc: 0 } },
    { t: 0.19, ease: 'io', footL: { rel: 1, lx: 0.11, ly: -0.64, lz: 0.08, knee: 1 }, footR: { rel: 1, lx: -0.11, ly: -0.66, lz: -0.04, knee: 1 } },
    { t: 0.38, ease: 'lin', footL: { rel: 1, lx: 0.11, ly: -0.7, lz: 0.06, knee: 0.4 }, footR: { rel: 1, lx: -0.11, ly: -0.7, lz: -0.04, knee: 0.4 } },
    { t: 0.44, ease: 'io', footL: { rel: 0, z: 0.65, x: 0, lift: 0, pitch: 0 }, footR: { rel: 0, z: 0.5, x: 0, lift: 0, pitch: 0 } },
    { t: 1.0, ease: 'io', footL: { z: 0.55 }, footR: { z: 0.55 } },
    // ---- 腰: 沈む（0.14）→ 跳ぶ → 着地で沈む → 立つ ----
    { t: 0.26, ease: 'out', hips: { y: 0.2 } },
    { t: 0.36, ease: 'lin', hips: { y: 0.16 } },
    { t: 0.46, ease: 'in', hips: { y: -0.2 } },
    { t: 0.64, ease: 'lin', hips: { y: -0.2 } },
    // ---- 体の回転（ヨー。腰・胸が 360° 左へ回る。連携回転斬りの終わりの座標 +360° から始まる）と腕 ----
    ...pose(0.14, 'io', { ...SPIN_COIL, hips: { ...SPIN_COIL.hips, yaw: SPIN_COIL.hips.yaw + TURN }, chest: { ...SPIN_COIL.chest, yaw: SPIN_COIL.chest.yaw + TURN }, head: { yaw: SPIN_COIL.head.yaw + TURN } }),
    { t: 0.24, ease: 'out', ...SPIN_ARMS },
    { t: 0.38, ease: 'lin', ...SPIN_ARMS, hips: { yaw: SPIN_COIL.hips.yaw }, chest: { yaw: SPIN_COIL.chest.yaw }, head: { yaw: SPIN_COIL.head.yaw } },
    ...pose(0.46, 'out', SPIN3_LAND),
    ...pose(0.64, 'lin', SPIN3_LAND),
    ...pose(1.0, 'io', GS_READY),
  ],
};

// ---------------------------------------------------------------- 回転叩きつけ（逆の大回転の受付で前へ倒して攻撃）

/**
 * 回転叩きつけ（逆の大回転の受付で、スティックを前へ倒して攻撃）: 回り切った剣を右肩の後ろへ引き上げ、前へ高く跳んで、体重を乗せて真上から叩きつける。旋風の締めの重い一撃。
 * 着地で剣が床を叩く（衝撃の輪）。逆の大回転の受付（GS_SPIN3_HOLD_T）から続けて始まる（continueFrom）。
 * 0 → 0.12 引き上げて沈む / 0.12 → 0.22 跳んで頭上へ掲げる / 0.22 → 0.32 叩きつけて両足で着地（0.3 に最高速、0.33 に剣が床を叩く）/ 0.32 → 0.5 保つ / 0.5 → 0.92 戻り。
 * ルートは 0.1 から 0.32 までに 1.2 m 前へ（跳び込み）。足は蹴るまで世界に固定 → 跳んでいるあいだは腰にぶら下がる → 両足で着地。
 */
export const GS_SPIN_SLAM: AuthoredAttack = {
  name: 'gsSpinSlam',
  duration: 0.92,
  twoHanded: GS_TWO_HAND,
  continueFrom: { attack: GS_SPIN3, t: GS_SPIN3_HOLD_T },
  keys: [
    // ---- ルート ----
    { t: 0.1, ease: 'lin', rootZ: 0 },
    { t: 0.2, ease: 'in', rootZ: 0.4 },
    { t: 0.32, ease: 'out', rootZ: 1.2 },
    // ---- 足: 受け取った位置 → 跳ぶあいだは腰にぶら下がる → 両足で着地 ----
    { t: 0.1, ease: 'lin', footL: { arc: 0 }, footR: { arc: 0 } },
    { t: 0.15, ease: 'io', footL: { rel: 1, lx: 0.11, ly: -0.66, lz: 0.06, knee: 0.6 }, footR: { rel: 1, lx: -0.11, ly: -0.68, lz: -0.04, knee: 0.6 } },
    { t: 0.26, ease: 'lin', footL: { rel: 1, lx: 0.11, ly: -0.74, lz: 0.1, knee: 0.1 }, footR: { rel: 1, lx: -0.11, ly: -0.72, lz: 0, knee: 0.1 } },
    { t: 0.32, ease: 'io', footL: { rel: 0, z: 1.45, x: 0, lift: 0, pitch: 0 }, footR: { rel: 0, z: 1.1, x: 0, lift: 0, pitch: 0 } },
    { t: 0.92, ease: 'io', footL: { z: 1.2 }, footR: { z: 1.2 } },
    // ---- 引き上げる → 跳んで掲げる → 叩きつける → 保つ → 戻る ----
    ...pose(0.12, 'io', LEAP_GATHER),
    ...pose(0.22, 'out', LEAP_TOP),
    ...pose(0.32, 'in', SLAM),
    ...pose(0.5, 'lin', SLAM),
    ...pose(0.92, 'io', GS_READY),
  ],
};

// ---------------------------------------------------------------- 薙ぎ返し（突き払いの受付で攻撃）

/** 薙ぎ返しの溜め: 左へ払い切った剣を、さらに左へ引き込んで水平に寝かせる（体を左へ巻く） */
const RETURN_COIL = {
  hips: { yaw: -22, pitch: 8, z: 0.02, y: -0.22 },
  chest: { yaw: -42, pitch: 10 },
  head: { yaw: -16 },
  grip: [-26, 4, 0.4] as V3,
  ...plane(-70, 0),
  roll: -180,
  pole: [-0.5, -0.8, 0] as V3,
};

/** 薙ぎ返しの途中（体の前を通る最高速）: 左から前を通って右へ。踏み込んだ足の上に腰が沈む */
const RETURN_PASS = {
  hips: { yaw: 0, pitch: 6, z: 0.04, y: -0.2 },
  chest: { yaw: 2, pitch: 8 },
  head: { yaw: 0 },
  grip: [-4, 4, 0.44] as V3,
  ...plane(0, 0),
  roll: -180,
  pole: [-0.4, -0.9, 0] as V3,
};

/** 払い切り: 剣は右へ水平に抜け、体は右へひねり切る */
const RETURN_END = {
  hips: { yaw: 18, pitch: 8, z: 0.03, y: -0.18 },
  chest: { yaw: 34, pitch: 10 },
  head: { yaw: 12 },
  grip: [8, 6, 0.38] as V3,
  ...plane(70, 0),
  roll: -180,
  pole: [-0.55, -0.8, 0.05] as V3,
};

/**
 * 薙ぎ返し（突き払いの受付で攻撃）: 左へ払い切った剣を、そのまま左から右へ薙ぎ返す。突く → 払う → 返すの 3 連目（手数を重ねる、広い薙ぎ）。
 * 突き払いの受付（GS_LUNGE_SWEEP_HOLD_T。払い切った姿勢を保っている間）から続けて始まる（continueFrom）。
 * 0 → 0.14 左へ引き込んで沈む / 0.14 → 0.24 薙ぎ返す（0.24 に前を通る最高速。右足は 0.24 に着地）/ 0.24 → 0.36 右へ払い切る / 0.36 → 0.48 保つ / 0.48 → 0.9 戻り。
 * ルートは 0.08 から 0.4 までに 0.5 m 前へ。足は世界に固定（突き払いの終わりは左足が前、右足が後ろ）。
 */
export const GS_RETURN_SWEEP: AuthoredAttack = {
  name: 'gsReturnSweep',
  duration: 0.9,
  twoHanded: GS_TWO_HAND,
  continueFrom: { attack: GS_LUNGE_SWEEP, t: GS_LUNGE_SWEEP_HOLD_T },
  keys: [
    // ---- 下半身: 後ろにいた右足が前へ踏み抜ける。左足は残って、あとで引きつける ----
    { t: 0.08, ease: 'lin', rootZ: 0 },
    { t: 0.24, ease: 'in', rootZ: 0.2 },
    { t: 0.4, ease: 'out', rootZ: 0.5 },
    { t: 0.08, ease: 'lin', footR: { arc: 0 } },
    { t: 0.24, ease: 'io', footR: { z: 0.5, arc: 0.16 } },
    { t: 0.5, ease: 'lin', footR: { z: 0.5 } },
    { t: 0.9, ease: 'io', footR: { z: 0.5, arc: 0.03 } },
    { t: 0.26, ease: 'lin', footL: { arc: 0 } },
    { t: 0.4, ease: 'out', footL: { z: 0.28, arc: 0.06 } },
    { t: 0.5, ease: 'lin', footL: { z: 0.28 } },
    { t: 0.9, ease: 'io', footL: { z: 0.5, arc: 0.1 } },
    // ---- 引き込む → 薙ぎ返す → 払い切る → 保つ → 戻る ----
    ...pose(0.14, 'io', RETURN_COIL),
    ...pose(0.24, 'in', RETURN_PASS),
    ...pose(0.36, 'out', RETURN_END),
    ...pose(0.48, 'lin', RETURN_END),
    ...pose(0.9, 'io', GS_READY),
  ],
};
