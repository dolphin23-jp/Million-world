import type { AuthoredAttack, LeftHold } from '../authoring';
import { OFFHAND } from './offhand';
import { pose } from './stagger';

/**
 * ガードの手付けクリップ（ADR-012 の仕組み、ADR-020 のガード）。座標の約束は combo1.ts と同じ（胸の座標系。右 = −X、上 = +Y、前 = +Z）。
 * 構えは「保持」なので、どのクリップも終端が同じ構えの姿勢（*_HOLD）で止まる（Player が離すまで保つ。クリップは終端で止まる）。
 * 受け（*_HIT）・パリィ（SHIELD_PARRY）は構えの終端から始まり、構えの姿勢に戻って終わる（continueFrom）。
 * ガードは足を動かさない（Player はその場から動かない）ので、ルートの前進（rootZ）は使わない。
 *
 * 盾の構えは左前腕に盾を付けて前へ向ける。盾の面は肘の曲げの外側（前腕を立てると前）を向く（src/game/shield.ts の shieldMount）。
 */

/**
 * 盾を持つ側の左腕（攻撃・回避のあいだ、盾を体の左前に構えたまま保つ）。AuthoredSampler の leftHold として、
 * 全クリップを焼き直した盾版（'@shield'）に使う。体の左側に置くのは、剣の斬りが体の前を通っても盾に当たらないため。
 * left = 左肩から手首への [方位°（正面から右へ。負が左）, 仰角°, 距離 m]、leftPole = 肘が向く側（offhand.ts と同じ）
 */
export const SHIELD_CARRY: LeftHold = {
  left: [-38, 2, 0.36],
  leftPole: [0.55, -0.85, -0.1],
};

type V3 = [number, number, number];

/**
 * 盾を持つときの待機（息づかいだけの繰り返し。名前は盾版の待機として探される 'idle@shield'。SHIELD_CARRY で左腕を固定して焼く）。
 * Meshy の待機は腕を下ろすので、盾を付けると面が後ろを向いてしまう（肘の曲げの外側が、腕を下ろしたときは後ろ）。
 * 左腕を盾の持ち位置に固定した待機にして、盾が体の左前で前を向く。攻撃・回避の盾版も同じ左腕なので、攻撃に入るとき左腕が動かない。
 * 周期 2.8 秒で腰と胸がわずかに沈んで戻る（始まりと終わりが同じ姿勢なので、つなぎ目なく繰り返せる）。
 */
export const SHIELD_IDLE: AuthoredAttack = {
  name: 'idle@shield',
  duration: 2.8,
  keys: [
    { t: 1.4, ease: 'io', hips: { y: -0.006 }, chest: { pitch: 1.2 }, head: { pitch: -0.6 } },
    { t: 2.8, ease: 'io', hips: { y: 0 }, chest: { pitch: 0 }, head: { pitch: 0 } },
  ],
};

// ---------------------------------------------------------------- 盾

/**
 * 盾の構え（保持）: 左足を前に、盾を顔の前〜胸の高さに立てて敵へ向ける。腰を落として少し前傾し、右手の剣は腰の右前に低く構える。
 * 腰・胸は左へひねり（左肩が前）、頭は正面を向く。
 */
const SHIELD_HOLD = {
  hips: { yaw: -10, pitch: 7, z: 0.05, y: -0.13 },
  chest: { yaw: -14, pitch: 7 },
  head: { yaw: 8 },
  grip: [26, -34, 0.4] as V3,
  blade: [-0.2, 0.12, 1] as V3,
  face: [0, 1, 0] as V3,
  roll: 0,
  pole: [-0.5, -0.8, 0.1] as V3,
  left: [14, 10, 0.34] as V3,
  leftPole: [0.35, -1, 0.1] as V3,
};

/** 盾の突き出し（パリィの受付の動き）: 盾を前へ突き出す。肘は曲げたまま手首を前上へ送り、前腕を立てて盾の面を前へ向ける（腕を伸ばしきると前腕が水平になって盾が上を向く） */
const SHIELD_PUSH = {
  hips: { yaw: -8, pitch: 11, z: 0.08, y: -0.1 },
  chest: { yaw: -20, pitch: 11 },
  head: { yaw: 12 },
  grip: [26, -34, 0.4] as V3,
  blade: [-0.2, 0.12, 1] as V3,
  face: [0, 1, 0] as V3,
  roll: 0,
  pole: [-0.5, -0.8, 0.1] as V3,
  left: [8, 30, 0.4] as V3,
  leftPole: [0.2, -1, 0] as V3,
};

/**
 * 盾の構えに入る: 0 → 0.07 盾を突き出す（パリィの受付はこの動きから始まる。Player 側の受付は 10f = 0.167s）→ 0.07 → 0.22 構えの姿勢へ戻って止まる。
 * 左足は 0.1 までに腰の 0.2m 前へ、右足は 0.1m 後ろへ（足を動かすのはこの 1 回だけ）。
 */
export const SHIELD_GUARD: AuthoredAttack = {
  name: 'guardShield',
  duration: 0.22,
  keys: [
    ...pose(0.07, 'out', SHIELD_PUSH),
    ...pose(0.22, 'io', SHIELD_HOLD),
    { t: 0.0, ease: 'lin', footL: { z: 0, lift: 0 }, footR: { z: 0, lift: 0 } },
    { t: 0.1, ease: 'io', footL: { z: 0.2, arc: 0.06 }, footR: { z: -0.1, arc: 0.04 } },
  ],
};

/**
 * 盾で受けた反動: 構えから、体が少し後ろへ反って盾が引き込まれ（0.05）、構えへ戻る（0.2）。体の反動だけで足は動かさない
 * （後ろへ押される動きは Player のノックバックが作る）。
 */
export const SHIELD_GUARD_HIT: AuthoredAttack = {
  name: 'guardShieldHit',
  duration: 0.2,
  continueFrom: { attack: SHIELD_GUARD, t: SHIELD_GUARD.duration },
  keys: [
    ...pose(0.05, 'out', {
      ...SHIELD_HOLD,
      hips: { yaw: -8, pitch: -2, z: -0.03, y: -0.08 },
      chest: { yaw: -12, pitch: -4 },
      left: [14, 8, 0.29],
    }),
    ...pose(0.2, 'io', SHIELD_HOLD),
  ],
};

/**
 * パリィ成功: 構えから盾を一気に前へ弾き出し（0.05）、構えへ戻る（0.22）。体も前へひねって、受け流した勢いが見える。
 */
export const SHIELD_PARRY: AuthoredAttack = {
  name: 'guardShieldParry',
  duration: 0.22,
  continueFrom: { attack: SHIELD_GUARD, t: SHIELD_GUARD.duration },
  keys: [
    ...pose(0.05, 'out', {
      ...SHIELD_PUSH,
      hips: { yaw: -16, pitch: 12, z: 0.09, y: -0.1 },
      chest: { yaw: -28, pitch: 12 },
      left: [6, 32, 0.43],
    }),
    ...pose(0.22, 'io', SHIELD_HOLD),
  ],
};

// ---------------------------------------------------------------- 剣（素手の標準）

/**
 * 剣の構え（保持）: 右手の剣を体の前で斜めに構えて受ける。柄は胸の前、刃は左上へ（体を斜めに横切る）、面を敵へ向ける。
 * 右足を前に出した半身（右肩が前）になり、左手は構え手（offhand.ts）。パリィはない（盾のガードより軽減が小さく、弾けない）。
 * 刃を真上に立てると頭の上へ突き出して旗のように見えるので、体の前を横切らせる。
 */
const SWORD_HOLD = {
  hips: { yaw: -10, pitch: 4, z: 0.03, y: -0.1 },
  chest: { yaw: -14, pitch: 4 },
  head: { yaw: 8 },
  grip: [4, -4, 0.4] as V3,
  blade: [0.92, 0.34, 0.22] as V3,
  face: [0, 0, 1] as V3,
  roll: 0,
  pole: [-0.5, -0.8, 0.1] as V3,
  ...OFFHAND.guard,
};

/** 剣の構えに入る: 0 → 0.14 剣を体の前へ構え、右足を前に出して半身になる。終端で止まる */
export const SWORD_GUARD: AuthoredAttack = {
  name: 'guardSword',
  duration: 0.14,
  keys: [
    ...pose(0.14, 'out', SWORD_HOLD),
    { t: 0.0, ease: 'lin', footL: { z: 0, lift: 0 }, footR: { z: 0, lift: 0 } },
    { t: 0.1, ease: 'io', footL: { z: -0.1, arc: 0.04 }, footR: { z: 0.16, arc: 0.05 } },
  ],
};

/** 剣で受けた反動: 剣が押し込まれて体が少し反り（0.05）、構えへ戻る（0.2） */
export const SWORD_GUARD_HIT: AuthoredAttack = {
  name: 'guardSwordHit',
  duration: 0.2,
  continueFrom: { attack: SWORD_GUARD, t: SWORD_GUARD.duration },
  keys: [
    ...pose(0.05, 'out', {
      ...SWORD_HOLD,
      hips: { yaw: -8, pitch: -3, z: -0.04, y: -0.07 },
      chest: { yaw: -10, pitch: -5 },
      grip: [4, -8, 0.34],
    }),
    ...pose(0.2, 'io', SWORD_HOLD),
  ],
};
